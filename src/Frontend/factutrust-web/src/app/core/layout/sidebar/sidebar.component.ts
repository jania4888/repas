import {
  Component,
  inject,
  effect,
  OnInit,
  input,
  output,
  computed
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import {
  NavItem,
  NavSubItem
} from '@core/config/app-navigation.registry';
import { FirmContextService } from '@core/services/firm-context.service';
import { BRAND } from '@core/constants/brand';
import { AppNavService } from '@core/services/app-nav.service';
import { isNavChildActive, isNavSubItemActive } from '@core/utils/nav-path-match';
import { getNavIconKey } from '@core/utils/nav-icon-key.util';
import { AiAssistantShellService } from '@features/ai-assistant/services/ai-assistant-shell.service';
import { canUseAiAssistant } from '@features/ai-assistant/utils/ai-access.util';
import { resolveNavLabel, resolveSubNavLabel } from '@core/i18n/erp-nav-label.util';
import { getNavId, NAV_ID } from '@core/config/nav-item-ids';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit {
  readonly collapsed = input(false);
  readonly toggleCollapse = output<void>();
  readonly requestExpand = output<void>();

  readonly brand = BRAND;

  readonly sidebarExpandTitle = $localize`:@@core.header.expandSidebar:Agrandir le menu latéral`;
  readonly sidebarCollapseTitle = $localize`:@@core.header.collapseSidebar:Réduire le menu latéral`;

  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly firmContext = inject(FirmContextService);
  private readonly appNav = inject(AppNavService);
  private readonly aiShell = inject(AiAssistantShellService);
  navLabel(item: NavItem): string {
    return resolveNavLabel(item);
  }

  subNavLabel(item: NavSubItem): string {
    return resolveSubNavLabel(item);
  }

  brandDashboardAriaLabel(): string {
    return $localize`:@@core.sidebar.brandDashboardAria:${this.brand.name}:brand: — Tableau de bord`;
  }

  pendingBadgeAriaLabel(count: number | undefined): string {
    const n = count ?? 0;
    return $localize`:@@core.sidebar.badgePending:${n}:count: en attente`;
  }

  readonly dashboardHomeLink = this.appNav.dashboardHomeLink;
  readonly navItems = this.appNav.navItems;
  readonly delegatedFooterNav = this.appNav.delegatedFooterNav;

  readonly isFirmDelegatedSkin = computed(
    () => this.auth.isAccountingFirm() && this.auth.isDelegatedMode()
  );

  /** At most one parent section with its submenu open; closed after each navigation. */
  expandedParentId: string | null = null;

  /** Inline expansion for footer items (Contrôle & Audit). */
  expandedFooterLabel: string | null = null;

  constructor() {
    effect(() => {
      if (this.collapsed()) {
        this.expandedParentId = null;
        this.expandedFooterLabel = null;
      }
    });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.collapseSubmenuPanel();
        this.expandedFooterLabel = null;
      });

    effect(() => {
      const items = this.navItems();
      if (this.expandedParentId !== null) {
        const parent = items.find(i => getNavId(i) === this.expandedParentId);
        if (!parent?.children?.length) {
          this.expandedParentId = null;
        }
      }
    });

    effect(() => {
      if (this.auth.isAccountingFirm() && !this.auth.isDelegatedMode()) {
        this.appNav.ensureFirmNavDataLoaded();
      }
    });
  }

  ngOnInit(): void {
    this.appNav.ensureFirmNavDataLoaded();
  }

  private collapseSubmenuPanel(): void {
    this.expandedParentId = null;
  }

  isExpanded(item: NavItem): boolean {
    return this.expandedParentId === getNavId(item);
  }

  isFooterExpanded(item: NavItem): boolean {
    return this.expandedFooterLabel === item.label;
  }

  toggleSubmenu(item: NavItem): void {
    if (!item.children?.length) {
      return;
    }
    this.expandedFooterLabel = null;
    if (this.collapsed()) {
      this.requestExpand.emit();
      this.expandedParentId = getNavId(item);
      return;
    }
    const id = getNavId(item);
    this.expandedParentId = this.expandedParentId === id ? null : id;
  }

  /**
   * Opens the rail section that matches a product-tour id. Returns the previous
   * expanded section id so the tour can restore it afterwards.
   */
  expandSectionForTour(tourId: string): string | null {
    const previous = this.expandedParentId;
    const item = this.navItems().find(i => i.tourId === tourId);
    if (!item?.children?.length) {
      return previous;
    }
    this.expandedFooterLabel = null;
    this.expandedParentId = getNavId(item);
    return previous;
  }

  restoreSectionAfterTour(sectionId: string | null): void {
    this.expandedParentId = sectionId;
  }

  toggleFooterSubmenu(item: NavItem): void {
    if (!item.children?.length) {
      return;
    }
    this.expandedParentId = null;
    this.expandedFooterLabel =
      this.expandedFooterLabel === item.label ? null : item.label;
  }

  onSubmenuToggleKeydown(event: KeyboardEvent, item: NavItem): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleSubmenu(item);
    }
  }

  onFooterToggleKeydown(event: KeyboardEvent, item: NavItem): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleFooterSubmenu(item);
    }
  }

  /** True if this parent owns the current URL (longest child match within parent). */
  isChildActive(item: NavItem): boolean {
    return isNavChildActive(this.router.url, item);
  }

  /** True when this submenu child is the single longest-matching sibling for the current URL. */
  isSubmenuChildActive(parent: NavItem, child: NavSubItem): boolean {
    return isNavSubItemActive(this.router.url, parent, child);
  }

  /**
   * Strong rail highlight: current URL matches a child of this section (only one such section at a time).
   */
  isRailParentActive(item: NavItem): boolean {
    if (!item.children?.length) {
      return false;
    }
    return this.isChildActive(item);
  }

  isFooterParentActive(item: NavItem): boolean {
    if (!item.children?.length) {
      return false;
    }
    return this.isChildActive(item);
  }

  /**
   * Submenu is open for this section but the current route is outside it — discrete styling, not `.active`.
   */
  isRailSectionExpandedOnly(item: NavItem): boolean {
    if (!item.children?.length) {
      return false;
    }
    return this.expandedParentId === getNavId(item) && !this.isChildActive(item);
  }

  isDossierContextItem(item: NavItem): boolean {
    return item.label.startsWith('Dossier :');
  }

  isFooterAuditItem(item: NavItem): boolean {
    return getNavId(item) === NAV_ID.firmDelegatedAudit;
  }

  /** Font Awesome suffix for pastel icon-box styling (e.g. fa-bag-shopping). */
  getIconKey(icon?: string): string | null {
    return getNavIconKey(icon);
  }

  async onNavSubItemAction(child: NavSubItem): Promise<void> {
    if (child.action === 'returnToFirm') {
      await this.firmContext.returnToFirmHome();
      return;
    }
    if (child.action === 'changeDossier') {
      await this.firmContext.navigateToClientList();
    }
  }

  onRouteNavClick(route: string | undefined, event: Event): void {
    if (!route || !canUseAiAssistant(this.auth) || !this.aiShell.isWorkspaceAiRoute(route)) {
      return;
    }
    event.preventDefault();
    this.aiShell.openAiGeneralTabFromRoute(route, {
      firmDelegated: this.isFirmDelegatedSkin()
    });
  }
}
