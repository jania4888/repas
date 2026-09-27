import { Component, signal, inject, computed, effect, untracked, OnInit, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { HeaderComponent } from '../header/header.component';
import { SecondaryNavComponent } from '../secondary-nav/secondary-nav.component';
import { WorkspaceTabBarComponent } from '../workspace-tab-bar/workspace-tab-bar.component';
import { ChatPanelComponent } from '../../../features/ai-assistant/components/chat-panel/chat-panel.component';
import { AuthService } from '../../services/auth.service';
import { BreadcrumbService } from '../../services/breadcrumb.service';
import { AiChatSessionService } from '../../../features/ai-assistant/services/ai-chat-session.service';
import { AiAssistantShellService } from '../../../features/ai-assistant/services/ai-assistant-shell.service';
import { resolveScopeFromUrl } from '../../../features/ai-assistant/config/agent-scopes.config';
import { canUseAiAssistant } from '../../../features/ai-assistant/utils/ai-access.util';
import { AI_ASSISTANT_MARK_SRC } from '@core/constants/ai-assistant-brand';
import { FirmContextService } from '../../services/firm-context.service';
import { LayoutRouteService } from '../layout-route.service';
import { DrawerOverlayService } from '../../services/drawer-overlay.service';
import { AppNavService } from '../../services/app-nav.service';
import { ProductTourHostComponent } from '../../onboarding/product-tour-host.component';
import { ProductTourLayoutBridge } from '../../onboarding/product-tour-layout.bridge';
import { ProductOnboardingApiService } from '../../onboarding/product-onboarding.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SidebarComponent,
    HeaderComponent,
    SecondaryNavComponent,
    WorkspaceTabBarComponent,
    ChatPanelComponent,
    ProductTourHostComponent
  ],
  template: `
    <div class="full_container">
      <div
        class="inner_container"
        [class.layout-has-secondary-nav]="appNav.hasSecondaryNav() && !layoutFlags().hideLayout"
        [class.layout--firm-delegated]="isFirmDelegatedLayout()">
        <app-sidebar
          [collapsed]="sidebarCollapsed()"
          (toggleCollapse)="toggleSidebar()"
          (requestExpand)="expandSidebar()">
        </app-sidebar>
        <div id="content">
          @if (!layoutFlags().hideLayout) {
            <app-header
              [sidebarCollapsed]="sidebarCollapsed()"
              (toggleSidebar)="toggleSidebar()">
            </app-header>
            @if (appNav.hasSecondaryNav()) {
              <app-secondary-nav />
            }
          }
          @if (showWorkspaceTabBar()) {
            <app-workspace-tab-bar
              [workTitle]="aiAssistantShell.workTabTitle()"
              [activePane]="aiAssistantShell.activePane()"
              (selectPane)="onWorkspacePaneSelected($event)"
              (closeAi)="onWorkspaceAiTabClose()" />
          }
          <div
            class="midde_cont"
            [class.layout-full-width]="layoutFlags().fullWidth"
            [class.layout-distraction-free]="layoutFlags().hideLayout"
            [class.midde_cont--workspace]="showWorkspaceTabBar()">
            @if (isAiAssistantRoute()) {
              <main
                id="main-content"
                [class.layout-full-width]="layoutFlags().fullWidth">
                <router-outlet></router-outlet>
              </main>
              @if (hasAiAccess()) {
                <app-chat-panel
                  [isOpen]="true"
                  [embedded]="true"
                  [workspaceTab]="false"
                  [agentScope]="routeAgentScope()"
                  (close)="onAiPanelClose()"
                />
              }
            } @else {
              <div
                #workPane
                id="workspace-panel-work"
                class="workspace-pane workspace-pane--work"
                role="tabpanel"
                aria-labelledby="workspace-tab-work"
                [hidden]="aiAssistantShell.activePane() === 'ai' && aiAssistantShell.aiTabOpen()"
                [attr.inert]="aiAssistantShell.activePane() === 'ai' && aiAssistantShell.aiTabOpen() ? '' : null">
                <main
                  id="main-content"
                  [class.layout-full-width]="layoutFlags().fullWidth">
                  <router-outlet></router-outlet>
                </main>
              </div>
              @if (hasAiAccess() && aiAssistantShell.aiTabOpen()) {
                <div
                  id="workspace-panel-ai"
                  class="workspace-pane workspace-pane--ai"
                  role="tabpanel"
                  aria-labelledby="workspace-tab-ai"
                  [hidden]="aiAssistantShell.activePane() !== 'ai'"
                  [attr.inert]="aiAssistantShell.activePane() !== 'ai' ? '' : null">
                  <app-chat-panel
                    [isOpen]="true"
                    [embedded]="true"
                    [workspaceTab]="true"
                    [agentScope]="aiAssistantShell.workspaceTabScope()"
                    (close)="onWorkspaceAiTabClose()"
                  />
                </div>
              }
            }
          </div>
        </div>
      </div>
      <app-product-tour-host />
    </div>

    @if (showAiFab()) {
      <button
        class="ai-fab"
        data-tour="ai-fab"
        type="button"
        (click)="openAiWorkspaceTab()"
        [hidden]="tourRunning()"
        [attr.inert]="tourRunning() ? '' : null"
        title="Assistant IA" i18n-title="@@core.layout.main-layout.main-layout.assistant.ia.94f6f208">
        <img
          [src]="aiMarkSrc"
          alt=""
          class="ai-fab-mark"
          aria-hidden="true" />
      </button>
    }
  `,
  styles: [`
    .full_container {
      --shell-main-max-width: none;
      --shell-content-padding-inline: var(--spacing-4);

      display: flex;
      width: 100%;
      height: 100vh;
      overflow: hidden;
      background-color: var(--color-neutral-50);
    }

    .inner_container {
      display: flex;
      width: 100%;
      height: 100%;
    }

    #content {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .midde_cont {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-6) var(--shell-content-padding-inline);
      background-color: #fff;
      border-top-left-radius: 16px;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
    }

    .midde_cont--workspace {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding-bottom: 0;
    }

    .workspace-pane {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .workspace-pane--work {
      overflow-y: auto;
      padding-bottom: var(--spacing-6);
    }

    .workspace-pane--ai {
      overflow: hidden;
      padding: 0 var(--shell-content-padding-inline) var(--spacing-4);
    }

    .workspace-pane--ai > app-chat-panel {
      flex: 1 1 auto;
      min-height: 0;
      height: 100%;
    }

    .workspace-pane[hidden] {
      display: none !important;
    }

    main#main-content {
      max-width: var(--shell-main-max-width);
      margin-inline: 0;
      width: 100%;
    }

    .midde_cont.layout-full-width {
      padding: 0;
      border-top-left-radius: 0;
      box-shadow: none;
    }

    .midde_cont.layout-distraction-free {
      overflow: hidden;
    }

    main#main-content.layout-full-width {
      max-width: none;
      height: 100%;
    }

    .ai-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 52px;
      height: 52px;
      border-radius: 16px;
      border: none;
      background: linear-gradient(135deg, #7c3aed, #c026d3);
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
      transition: all 0.2s;
      z-index: var(--z-fab);
    }

    .ai-fab:hover {
      background: linear-gradient(135deg, #6d28d9, #a21caf);
      transform: scale(1.05);
    }

    .ai-fab[hidden] {
      display: none !important;
    }

    .ai-fab-mark {
      width: 34px;
      height: 34px;
      object-fit: contain;
      border-radius: 50%;
      flex-shrink: 0;
      image-rendering: auto;
    }

    @media (max-width: 768px) {
      .midde_cont {
        padding: var(--spacing-4);
        border-radius: 0;
      }

      .midde_cont.layout-full-width {
        padding: 0;
      }

      .workspace-pane--ai {
        padding: 0 var(--spacing-4) var(--spacing-4);
      }

      .ai-fab {
        bottom: 16px;
        right: 16px;
        width: 48px;
        height: 48px;
      }

      .ai-fab-mark {
        width: 31px;
        height: 31px;
      }
    }
  `]
})
export class MainLayoutComponent implements OnInit {
  readonly aiMarkSrc = AI_ASSISTANT_MARK_SRC;
  private readonly sidebar = viewChild(SidebarComponent);
  private readonly workPane = viewChild<ElementRef<HTMLElement>>('workPane');
  private readonly tourLayout = inject(ProductTourLayoutBridge);

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly aiSession = inject(AiChatSessionService);
  readonly aiAssistantShell = inject(AiAssistantShellService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly layoutRoute = inject(LayoutRouteService);
  private readonly firmContext = inject(FirmContextService);
  readonly appNav = inject(AppNavService);
  readonly drawerOverlay = inject(DrawerOverlayService);
  private readonly productOnboarding = inject(ProductOnboardingApiService);
  readonly tourRunning = this.productOnboarding.isTourRunning;

  readonly layoutFlags = this.layoutRoute.flags;

  readonly isFirmDelegatedLayout = computed(
    () => this.auth.isAccountingFirm() && this.auth.isDelegatedMode()
  );

  readonly routerUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly isAiAssistantRoute = computed(() => this.aiAssistantShell.isAiAssistantRoute(this.routerUrl()));

  readonly routeAgentScope = computed(() =>
    resolveScopeFromUrl(this.routerUrl(), {
      firmDelegated: this.auth.isAccountingFirm() && this.auth.isDelegatedMode()
    })
  );

  readonly showWorkspaceTabBar = computed(
    () =>
      this.hasAiAccess() &&
      this.aiAssistantShell.aiTabOpen() &&
      !this.isAiAssistantRoute() &&
      !this.layoutFlags().hideLayout
  );

  readonly showAiFab = computed(
    () =>
      this.hasAiAccess() &&
      !this.isAiAssistantRoute() &&
      !this.layoutFlags().hideLayout &&
      !this.drawerOverlay.isOpen() &&
      (!this.aiAssistantShell.aiTabOpen() || this.aiAssistantShell.activePane() !== 'ai')
  );

  sidebarCollapsed = signal(false);

  constructor() {
    this.tourLayout.expandSidebar = () => this.expandSidebar();
    this.tourLayout.closeAiPanel = () => {
      this.aiAssistantShell.closeAiTab();
    };
    this.tourLayout.expandNavSection = tourId => this.sidebar()?.expandSectionForTour(tourId) ?? null;
    this.tourLayout.restoreNavSection = label => this.sidebar()?.restoreSectionAfterTour(label);
    this.tourLayout.hasNavItems = () => this.appNav.navItems().length > 0;

    effect(() => {
      if (this.isAiAssistantRoute()) {
        this.aiAssistantShell.resetWorkspaceTabForDedicatedRoute();
      }
    });

    // Sync layout context only when openPanelTick increments (not on navigation after close).
    effect(() => {
      const tick = this.aiAssistantShell.openPanelTick();
      if (tick <= 0) {
        return;
      }
      untracked(() => {
        if (!this.hasAiAccess() || this.isAiAssistantRoute()) {
          return;
        }
        this.aiAssistantShell.openAiGeneralTab({
          url: this.routerUrl(),
          firmDelegated: this.isFirmDelegatedLayout()
        });
      });
    });

    effect(() => {
      const url = this.routerUrl();
      if (this.isAiAssistantRoute()) {
        return;
      }
      this.aiAssistantShell.syncSuggestedScopeFromUrl(url, this.isFirmDelegatedLayout());
      this.updateWorkTabTitle();
      if (!this.isAiAssistantRoute()) {
        this.aiAssistantShell.activateWorkPane();
      }
    });

    effect(() => {
      const pane = this.aiAssistantShell.activePane();
      if (pane === 'work' && this.aiAssistantShell.aiTabOpen()) {
        queueMicrotask(() => this.notifyWorkPaneResize());
      }
    });
  }

  ngOnInit(): void {
    this.firmContext.syncFromUser();
    if (this.hasAiAccess()) {
      this.aiSession.initialize();
    }
    this.updateWorkTabTitle();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  expandSidebar(): void {
    this.sidebarCollapsed.set(false);
  }

  openAiWorkspaceTab(): void {
    this.aiAssistantShell.requestOpenPanel({
      url: this.routerUrl(),
      firmDelegated: this.isFirmDelegatedLayout()
    });
  }

  onWorkspacePaneSelected(pane: 'work' | 'ai'): void {
    if (pane === 'work') {
      this.aiAssistantShell.activateWorkPane();
    } else {
      this.aiAssistantShell.activateAiPane();
    }
  }

  onWorkspaceAiTabClose(): void {
    this.aiAssistantShell.closeAiTab();
  }

  onAiPanelClose(): void {
    if (this.isAiAssistantRoute()) {
      void this.router.navigate(['/dashboard']);
    } else {
      this.onWorkspaceAiTabClose();
    }
  }

  hasAiAccess(): boolean {
    return canUseAiAssistant(this.auth);
  }

  private updateWorkTabTitle(): void {
    const items = this.breadcrumb.items();
    const last = items.length > 0 ? items[items.length - 1]?.label : $localize`:@@core.main-layout.ts.accueil.a8ff8fd2:Accueil`;
    this.aiAssistantShell.setWorkTabTitle(last ?? $localize`:@@ui.tern.accueil.a8ff8f:Accueil`);
  }

  private notifyWorkPaneResize(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('resize'));
    }
  }
}
