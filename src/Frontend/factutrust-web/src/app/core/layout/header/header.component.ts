import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { AuthService } from '../../services/auth.service';
import {
  AppNotification,
  NotificationService,
  isStudioWorkflowNotification
} from '../../services/notification.service';
import { StudioApprovalsBadgeService } from '@features/studio/approvals/studio-approvals-badge.service';
import { WarehouseContextService } from '../../services/warehouse-context.service';
import { FirmContextService } from '../../services/firm-context.service';
import { BreadcrumbService } from '../../services/breadcrumb.service';
import { QuickAccessMenuComponent } from './quick-access-menu/quick-access-menu.component';
import { GlobalSearchComponent } from '../global-search/global-search.component';
import { GlobalSearchService } from '../../services/global-search.service';
import {
  isProductOnboardingUiEnabled,
  ProductOnboardingApiService
} from '../../onboarding/product-onboarding.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule, NgbDropdownModule, QuickAccessMenuComponent, GlobalSearchComponent],
  template: `
    <div class="topbar main-header">
      <nav class="navbar navbar-expand-lg">
        <div class="header-content">
          <!-- Toggle button for mobile/sidebar -->
          <button
            type="button"
            class="sidebar_toggle"
            (click)="toggleSidebar.emit()"
            [attr.aria-expanded]="!sidebarCollapsed"
            [attr.aria-label]="sidebarCollapsed ? 'Agrandir le menu latéral' : 'Réduire le menu latéral'">
            <i class="fa fa-bars"></i>
          </button>

          <div class="header-left-actions" data-tour="header-quick-access">
            <app-quick-access-menu />
          </div>

          <!-- Global Search -->
          <div data-tour="header-search">
            <app-global-search mode="header" />
          </div>

          <!-- Right Side -->
          <div class="right_topbar">
            @if (authService.isDelegatedMode() && firmContext.activeClient(); as client) {
              <div class="main-header__firm-context">
                <span>Dossier : <strong>{{ client.companyName }}</strong></span>
                <button type="button" class="btn-link" (click)="returnToFirm()">Retour au cabinet</button>
              </div>
            }
            @if (globalSearch.isEnabled()) {
              <button
                type="button"
                class="header-mobile-search"
                (click)="globalSearch.openPalette()"
                aria-label="Rechercher">
                <i class="fa-solid fa-magnifying-glass"></i>
              </button>
            }
            <!-- Warehouse Badge -->
            @if (warehouseContext.resolvedWarehouse(); as wh) {
              <div
                class="main-header__warehouse"
                data-tour="header-warehouse"
                role="status"
                [attr.title]="'Entrepôt : ' + wh.name"
                [attr.aria-label]="'Entrepôt actif : ' + wh.name">
                <i class="fa-solid fa-warehouse" aria-hidden="true"></i>
                <span class="main-header__warehouse-name">{{ wh.name }}</span>
              </div>
            }

            <div class="icon_info main-header__icon-actions">
              <ul class="main-header__toolbar-icons">
                @if (authService.canAccessPlatformSettings()) {
                  <li>
                    <a routerLink="/settings" aria-label="Paramètres" data-tour="header-settings">
                      <i class="fa-solid fa-gear"></i>
                    </a>
                  </li>
                } @else if (authService.isAccountingFirm() && !authService.isDelegatedMode()) {
                  <li>
                    <a routerLink="/firm/settings" aria-label="Paramètres cabinet" data-tour="header-settings">
                      <i class="fa-solid fa-gear"></i>
                    </a>
                  </li>
                }
                <li>
                  <a href="#" (click)="$event.preventDefault()" aria-label="Partager">
                    <i class="fa-solid fa-share-nodes"></i>
                  </a>
                </li>
                <li
                  ngbDropdown
                  placement="bottom-end"
                  container="body"
                  display="dynamic"
                  (openChange)="onNotificationsOpenChange($event)"
                  class="main-header__dropdown-host">
                  <button
                    type="button"
                    ngbDropdownToggle
                    id="notificationsDropdown"
                    class="notif-bell"
                    data-tour="header-notifications"
                    aria-label="Notifications"
                    aria-haspopup="menu">
                    <i class="fa-regular fa-bell"></i>
                    @if (notifications.unreadCount() > 0) {
                      <span class="badge">{{ notifications.unreadCount() > 99 ? '99+' : notifications.unreadCount() }}</span>
                    }
                  </button>
                  <div
                    ngbDropdownMenu
                    aria-labelledby="notificationsDropdown"
                    class="notif-menu dropdown-menu"
                    role="menu">
                    <div class="notif-menu__header">
                      <span class="notif-menu__title">Notifications</span>
                      @if (notifications.unreadCount() > 0) {
                        <button type="button" class="notif-menu__mark-all" (click)="markAllRead($event)">
                          Tout marquer comme lu
                        </button>
                      }
                    </div>
                    @if (notifications.latest().length === 0) {
                      <div class="notif-menu__empty">
                        <i class="fa-regular fa-bell-slash" aria-hidden="true"></i>
                        <p>Aucune notification</p>
                      </div>
                    } @else {
                      <div class="notif-menu__list">
                        @for (n of notifications.latest(); track n.id) {
                          <button
                            type="button"
                            class="notif-item"
                            [class.notif-item--unread]="!n.readAt"
                            (click)="openNotification(n)">
                            <span class="notif-item__dot" aria-hidden="true"></span>
                            <span class="notif-item__content">
                              <span class="notif-item__title">{{ n.title }}</span>
                              <span class="notif-item__body">{{ n.body }}</span>
                              <span class="notif-item__date">{{ n.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span>
                            </span>
                          </button>
                        }
                      </div>
                    }
                  </div>
                </li>
              </ul>
              <ul class="user_profile_dd">
                <li
                  ngbDropdown
                  placement="bottom-end"
                  container="body"
                  display="dynamic"
                  class="main-header__dropdown-host">
                  <button
                    type="button"
                    ngbDropdownToggle
                    class="dropdown-toggle main-header__user-trigger"
                    id="userDropdown"
                    aria-label="Menu utilisateur"
                    data-tour="header-profile"
                    aria-haspopup="menu">
                    <div class="user_avatar_image">
                      <img src="assets/theme/pluto/images/layout_img/user_img.jpg" alt="User avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                      <div class="user_avatar_circle" style="display: none;">{{ getInitials() }}</div>
                    </div>
                  </button>
                  <div
                    ngbDropdownMenu
                    aria-labelledby="userDropdown"
                    class="main-header__user-menu dropdown-menu"
                    role="menu">
                    <a ngbDropdownItem routerLink="/settings/profile">Mon profil</a>
                    @if (canReplayProductTour()) {
                      <button type="button" ngbDropdownItem (click)="replayProductTour()">
                        Relancer la visite guidée
                      </button>
                    }
                    @if (authService.canAccessPlatformSettings()) {
                      <a ngbDropdownItem routerLink="/settings">Paramètres</a>
                    } @else if (authService.isAccountingFirm() && !authService.isDelegatedMode()) {
                      <a ngbDropdownItem routerLink="/firm/settings">Paramètres cabinet</a>
                    }
                    <div ngbDropdownDivider></div>
                    <a ngbDropdownItem (click)="authService.logout()">
                      <span>Déconnexion</span>
                      <i class="fa-solid fa-arrow-right-from-bracket ms-2"></i>
                    </a>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </nav>
    </div>
  `,
  styles: [`
    /* Topbar — tokens (--topbar-*); Superieur = bleu uni via remap tokens */
    .topbar.main-header {
      background: linear-gradient(to right, var(--topbar-gradient-start), var(--topbar-gradient-end));
      border-bottom: none;
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.06);
    }

    :host-context(.theme-superieur) .topbar.main-header {
      background: var(--superieur-primary, #3862f5);
      box-shadow: 0 2px 8px rgba(56, 98, 245, 0.2);
    }

    .header-content {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: var(--topbar-height, 48px);
      padding: 4px 20px;
      gap: 0;
    }

    .sidebar_toggle {
      background: transparent;
      border: none;
      color: var(--topbar-fg);
      font-size: 20px;
      cursor: pointer;
      padding: 6px 12px;
      margin-right: 0;
      border-right: 1px solid var(--topbar-divider);
      border-radius: 0;
    }

    .sidebar_toggle:hover,
    .sidebar_toggle:focus-visible {
      background: var(--topbar-hover-bg);
      color: var(--topbar-fg);
      outline: none;
    }

    .header-left-actions {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      padding-left: 12px;
      margin-right: 12px;
      border-right: 1px solid var(--topbar-divider);
    }

    .header-mobile-search {
      display: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--topbar-fg);
      font-size: 18px;
      cursor: pointer;
    }

    .header-mobile-search:hover {
      background: var(--topbar-hover-bg);
      color: var(--topbar-fg);
    }

    .header-mobile-search:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
    }

    @media (max-width: 768px) {
      .header-mobile-search {
        display: inline-flex;
      }
    }

    .main-header__warehouse {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 999px;
      color: var(--topbar-fg);
      font-size: 12px;
      font-weight: 600;
    }

    .main-header__warehouse i {
      color: var(--topbar-fg);
    }

    .right_topbar {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-left: auto;
      padding-left: 16px;
      border-left: 1px solid var(--topbar-divider);
    }

    .main-header__icon-actions {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .main-header__toolbar-icons {
      display: flex;
      align-items: center;
      gap: 0;
      list-style: none;
      margin: 0;
      padding: 0;
      float: none;
      width: auto;

      /* Neutralise Pluto .icon_info ul li { 35×35 } */
      > li {
        display: flex;
        align-items: center;
        float: none;
        width: auto;
        height: auto;
        margin: 0;
        border-radius: 0;
        line-height: normal;
        overflow: visible;
        text-align: left;
        position: relative;
      }

      li + li {
        border-left: 1px solid var(--topbar-divider);
      }

      li a,
      li button.notif-bell {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 0;
        border: none;
        background: transparent;
        color: var(--topbar-fg);
        font-size: 16px;
        transition: background 0.2s;
        position: relative;
        cursor: pointer;
        padding: 0;

        &:hover {
          background: var(--topbar-hover-bg);
          color: var(--topbar-fg);
        }

        &:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
        }

        .badge {
          position: absolute;
          top: 6px;
          right: 6px;
          background: var(--topbar-badge);
          color: white;
          font-size: 10px;
          padding: 2px 5px;
          border-radius: 10px;
          line-height: 1;
          min-width: 16px;
          text-align: center;
        }
      }
    }

    .main-header__dropdown-host {
      position: relative;
    }

    .notif-bell::after {
      display: none;
    }

    /* Namespaced panel: works with body container (Ngb) and local menu. */
    .notif-menu.dropdown-menu {
      width: 360px;
      max-width: calc(100vw - 32px);
      margin: 0;
      padding: 0 !important;
      border: 1px solid var(--color-neutral-200);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
      overflow: hidden;
      z-index: 1000;
      background: var(--color-white, #fff);
    }

    .notif-menu__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-neutral-200);
      background: var(--color-neutral-50, #f8fafc);
    }

    .notif-menu__title {
      font-weight: 600;
      font-size: 14px;
      color: #1e293b;
    }

    .notif-menu__mark-all {
      border: none;
      background: none;
      padding: 0;
      font-size: 12px;
      color: var(--color-primary-600);
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }

    .notif-menu__empty {
      padding: 28px 16px;
      text-align: center;
      color: #94a3b8;

      i {
        font-size: 24px;
        margin-bottom: 8px;
      }

      p {
        margin: 0;
        font-size: 13px;
      }
    }

    .notif-menu__list {
      max-height: 380px;
      overflow-y: auto;
    }

    .notif-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      padding: 12px 16px;
      border: none;
      border-bottom: 1px solid var(--color-neutral-100, #f1f5f9);
      background: transparent;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s;

      &:hover {
        background: #f1f5f9;
      }

      &:last-child {
        border-bottom: none;
      }
    }

    .notif-item__dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 50%;
      background: transparent;
    }

    .notif-item--unread .notif-item__dot {
      background: var(--color-primary-600);
    }

    .notif-item__content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .notif-item__title {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
    }

    .notif-item--unread .notif-item__title {
      color: var(--color-primary-700);
    }

    .notif-item__body {
      font-size: 12px;
      color: #64748b;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .notif-item__date {
      font-size: 11px;
      color: #94a3b8;
    }

    .user_profile_dd {
      margin: 0;
      padding: 0;
      list-style: none;
      border-left: 1px solid var(--topbar-divider);
      margin-left: 0;
      float: none;
      width: auto;

      > li {
        float: none;
        width: auto;
        height: auto;
        margin: 0;
        padding: 4px 8px;
        border-radius: 0;
        background: transparent;
        line-height: normal;
        overflow: visible;
      }
    }

    /* Namespaced panel: cancels Pluto .user_profile_dd .dropdown-menu { width: 100% }. */
    .main-header__user-menu.dropdown-menu {
      width: auto;
      min-width: 12rem;
      max-width: calc(100vw - 32px);
      margin: 0;
      padding: 8px 0;
      z-index: 1000;
      float: none;
      background: var(--color-white, #fff);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-lg, 0 10px 25px rgba(15, 23, 42, 0.12));
    }

    .main-header__user-trigger {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 4px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.85);
      background: transparent;
      transition: all 0.2s;

      &::after {
        display: none;
      }

      &:hover {
        border-color: var(--topbar-fg);
        background: var(--topbar-hover-bg);
      }

      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
      }
    }

    .user_avatar_image {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      overflow: hidden;
      
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .user_avatar_circle {
      width: 100%;
      height: 100%;
      background: #3b82f6;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
    }

    @media (max-width: 768px) {
      .right_topbar { gap: 12px; }
      .main-header__toolbar-icons { gap: 0; }
    }

    .main-header__firm-context {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.35rem 0.75rem;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: var(--radius-lg);
      font-size: 0.875rem;
      color: var(--topbar-fg);
    }

    .main-header__firm-context .btn-link {
      border: none;
      background: none;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      text-decoration: underline;
      font-size: 0.875rem;
    }

    .main-header__firm-context .btn-link:hover {
      color: var(--topbar-fg);
    }
  `]
})
export class HeaderComponent {
  @Input() sidebarCollapsed = false;
  @Output() toggleSidebar = new EventEmitter<void>();

  readonly globalSearch = inject(GlobalSearchService);
  readonly authService = inject(AuthService);
  readonly firmContext = inject(FirmContextService);
  readonly notifications = inject(NotificationService);
  private readonly productOnboarding = inject(ProductOnboardingApiService);
  private readonly approvalsBadge = inject(StudioApprovalsBadgeService);
  private readonly router = inject(Router);
  warehouseContext = inject(WarehouseContextService);
  breadcrumbService = inject(BreadcrumbService);

  onNotificationsOpenChange(open: boolean): void {
    if (open) {
      this.notifications.refresh();
    }
  }

  openNotification(notification: AppNotification): void {
    if (!notification.readAt) {
      this.notifications.markRead(notification.id);
    }
    if (isStudioWorkflowNotification(notification.type)) {
      this.approvalsBadge.refresh(); // g1 : requête immédiate hors cadence
      if (!notification.linkUrl) {
        this.router.navigateByUrl('/studio/approvals');
        return;
      }
    }
    if (notification.linkUrl) {
      this.router.navigateByUrl(notification.linkUrl);
    }
  }

  markAllRead(event: Event): void {
    event.stopPropagation();
    this.notifications.markAllRead();
  }

  async returnToFirm(): Promise<void> {
    await this.firmContext.returnToFirmHome();
  }

  async clearFirmContext(): Promise<void> {
    await this.firmContext.navigateToClientList();
  }

  getInitials(): string {
    const user = this.authService.user();
    if (!user) return '?';
    if (user.firstName && user.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    return user.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';
  }

  canReplayProductTour(): boolean {
    return isProductOnboardingUiEnabled() && !this.authService.isDelegatedMode();
  }

  replayProductTour(): void {
    void this.router.navigateByUrl(
      this.authService.isAccountingFirm() ? '/firm/dashboard' : '/dashboard'
    );
    this.productOnboarding.requestReplay();
  }
}
