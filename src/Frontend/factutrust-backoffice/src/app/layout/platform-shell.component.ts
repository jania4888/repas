import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MenuItem } from 'primeng/api';
import { PlatformAuthService } from '@core/services/platform-auth.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformPreferencesService } from '@core/services/platform-preferences.service';
import { FtOverlayCleanupService } from '@core/services/ft-overlay-cleanup.service';
import { PlatformPermission } from '@core/models/platform.models';
import { PlatformCompanySupportBadgeService } from '@core/services/platform-company-support-badge.service';
import { FtAvatarComponent } from '@core/ui/avatar/ft-avatar.component';
import { FtUserMenuComponent } from '@core/ui/user-menu/ft-user-menu.component';
import { FtKeyboardShortcutsDialogComponent } from '@core/ui/keyboard-shortcuts/ft-keyboard-shortcuts-dialog.component';
import { t } from '@core/i18n/fr';

const DOCS_URL = 'https://docs.instafact.tn/admin';

@Component({
  selector: 'app-platform-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    ToastModule,
    TooltipModule,
    FtAvatarComponent,
    FtUserMenuComponent,
    FtKeyboardShortcutsDialogComponent
  ],
  template: `
    <p-toast position="top-right" />
    <header class="shell-header">
      <div class="brand-block">
        <img src="assets/branding/instafact-lockup.png" alt="InstaFact" class="brand-logo-img" />
        <span class="brand-badge">{{ t('app.brand.suffix') }}</span>
      </div>
      <nav class="shell-nav" aria-label="Navigation principale">
        <a routerLink="/tenants" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: false }">
          <i class="pi pi-building" aria-hidden="true"></i>
          {{ t('nav.tenants') }}
        </a>
        <a routerLink="/migrations" routerLinkActive="active">
          <i class="pi pi-database" aria-hidden="true"></i>
          {{ t('nav.migrations') }}
        </a>
        <a routerLink="/storefronts" routerLinkActive="active">
          <i class="pi pi-shop" aria-hidden="true"></i>
          {{ t('nav.storefronts') }}
        </a>
        @if (canSeeAdmins()) {
          <a routerLink="/admins" routerLinkActive="active">
            <i class="pi pi-users" aria-hidden="true"></i>
            {{ t('nav.admins') }}
          </a>
        }
        @if (canSeePlans()) {
          <a routerLink="/plans" routerLinkActive="active">
            <i class="pi pi-tags" aria-hidden="true"></i>
            Plans
          </a>
        }
        @if (canSeeSectorRules()) {
          <a routerLink="/sector-rules" routerLinkActive="active">
            <i class="pi pi-sitemap" aria-hidden="true"></i>
            {{ t('nav.sectorRules') }}
          </a>
        }
        @if (canSeeCoupons()) {
          <a routerLink="/coupons" routerLinkActive="active">
            <i class="pi pi-tag" aria-hidden="true"></i>
            Coupons
          </a>
        }
        @if (canSeeCredits()) {
          <a routerLink="/credits" routerLinkActive="active">
            <i class="pi pi-wallet" aria-hidden="true"></i>
            Crédits
          </a>
        }
        @if (canSeeInvoices()) {
          <a routerLink="/invoices" routerLinkActive="active">
            <i class="pi pi-file" aria-hidden="true"></i>
            Factures
          </a>
        }
        @if (canSeePaymentProviders()) {
          <a routerLink="/payments/providers" routerLinkActive="active">
            <i class="pi pi-credit-card" aria-hidden="true"></i>
            Paiements
          </a>
        }
        @if (canSeeDunning()) {
          <a routerLink="/dunning" routerLinkActive="active">
            <i class="pi pi-megaphone" aria-hidden="true"></i>
            Dunning
          </a>
        }
        @if (canSeeAudit()) {
          <a routerLink="/audit" routerLinkActive="active">
            <i class="pi pi-history" aria-hidden="true"></i>
            Audit
          </a>
        }
        @if (canSeeAudit()) {
          <a routerLink="/emails" routerLinkActive="active">
            <i class="pi pi-envelope" aria-hidden="true"></i>
            Emails
          </a>
        }
        @if (canSeeSecurity()) {
          <a routerLink="/security" routerLinkActive="active">
            <i class="pi pi-lock" aria-hidden="true"></i>
            Sécurité
          </a>
        }
        @if (canSeeCompanySupport()) {
          <a routerLink="/company-support" routerLinkActive="active">
            <i class="pi pi-comments" aria-hidden="true"></i>
            Assistance
            @if (supportUnread() > 0) {
              <span class="nav-badge">{{ supportUnread() }}</span>
            }
          </a>
        }
        @if (canSeeAiConfig()) {
          <a
            routerLink="/ai-settings"
            routerLinkActive="active"
            pTooltip="Endpoint Modal et modèles par défaut (plateforme)."
            tooltipPosition="bottom"
          >
            <i class="pi pi-microchip-ai" aria-hidden="true"></i>
            Configuration IA
          </a>
        }
      </nav>
      <div class="user-block">
        <button
          type="button"
          class="icon-btn"
          aria-label="Recherche globale (⌘K) — bientôt"
          pTooltip="Recherche globale (⌘K) — bientôt"
          tooltipPosition="bottom"
          disabled
        >
          <i class="pi pi-search" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Notifications — bientôt"
          pTooltip="Notifications — bientôt"
          tooltipPosition="bottom"
          disabled
        >
          <i class="pi pi-bell" aria-hidden="true"></i>
        </button>
        @if (auth.user(); as u) {
          <ft-user-menu
            #userMenu
            [items]="userMenuItems()"
            [ariaLabel]="'Menu de ' + u.firstName + ' ' + u.lastName"
          >
            <ft-avatar [name]="u.firstName + ' ' + u.lastName" [seed]="u.id" size="sm" />
            <span class="user-meta">
              <span class="user-name">{{ u.firstName }} {{ u.lastName }}</span>
              <span class="user-role">{{ t('app.role.platformAdmin') }}</span>
            </span>
            <i class="pi pi-chevron-down user-chevron" aria-hidden="true"></i>
          </ft-user-menu>
        }
      </div>
    </header>
    <main class="shell-main">
      <div class="shell-inner">
        <router-outlet />
      </div>
    </main>
    <ft-keyboard-shortcuts-dialog
      [visible]="shortcutsVisible()"
      (visibleChange)="shortcutsVisible.set($event)"
    />
  `,
  styles: [
    `
      .shell-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem 1.5rem;
        padding: 0.85rem 1.5rem;
        border-bottom: 1px solid var(--ft-border, #30363d);
        background: var(--ft-surface, #161b22);
        position: sticky;
        top: 0;
        z-index: var(--z-sticky, 100);
      }
      .brand-block {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .brand-logo-img {
        max-height: 32px;
        max-width: 140px;
        width: auto;
        object-fit: contain;
      }
      .brand-badge {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 0.2rem 0.45rem;
        border-radius: 6px;
        background: var(--ft-accent-muted, rgba(88, 166, 255, 0.15));
        color: var(--ft-accent, #58a6ff);
      }
      .shell-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        flex: 1;
        justify-content: center;
      }
      .shell-nav a {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--ft-text-muted, #8b949e);
        text-decoration: none;
        padding: 0.45rem 0.75rem;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 500;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .shell-nav a:hover {
        color: var(--ft-text, #e6edf3);
        background: var(--ft-hover-surface);
      }
      .shell-nav a.active {
        background: var(--ft-accent-muted, rgba(88, 166, 255, 0.18));
        color: var(--ft-accent, #58a6ff);
      }
      .shell-nav a:focus-visible {
        outline: 2px solid var(--ft-accent, #58a6ff);
        outline-offset: 2px;
      }
      .user-block {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.1rem;
        height: 2.1rem;
        border: 1px solid transparent;
        background: transparent;
        color: var(--ft-text-muted);
        border-radius: var(--ft-radius);
        cursor: pointer;
      }
      .icon-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .user-meta {
        display: flex;
        flex-direction: column;
        gap: 0.05rem;
        text-align: left;
        line-height: 1.15;
      }
      .user-name {
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--ft-text);
      }
      .user-role {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ft-text-muted);
      }
      .user-chevron {
        font-size: 0.7rem;
        color: var(--ft-text-subtle);
      }
      .nav-badge {
        margin-left: 0.35rem;
        background: #c2410c;
        color: #fff;
        border-radius: 999px;
        padding: 0 0.4rem;
        font-size: 0.7rem;
      }
      .shell-main {
        min-height: calc(100vh - 4rem);
        padding: 1.5rem 1.25rem 2.5rem;
      }
      .shell-inner {
        max-width: 1400px;
        margin: 0 auto;
      }
      @media (max-width: 640px) {
        .user-meta {
          display: none;
        }
      }
    `
  ]
})
export class PlatformShellComponent implements OnInit, OnDestroy {
  readonly auth = inject(PlatformAuthService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly prefs = inject(PlatformPreferencesService);
  private readonly overlayCleanup = inject(FtOverlayCleanupService);
  private readonly supportBadge = inject(PlatformCompanySupportBadgeService);
  private supportTimer: ReturnType<typeof setInterval> | null = null;

  @ViewChild('userMenu') userMenu?: FtUserMenuComponent;

  readonly shortcutsVisible = signal(false);
  readonly t = t;

  readonly canSeeAdmins = computed(() => this.permissions.has(PlatformPermission.AdminsRead));
  readonly canSeeSecurity = computed(() => this.permissions.has(PlatformPermission.SecurityRead));
  readonly canSeePlans = computed(() => this.permissions.has(PlatformPermission.PlansManage));
  readonly canSeeSectorRules = computed(() =>
    this.permissions.has(PlatformPermission.SectorRulesRead)
  );
  readonly canSeeCoupons = computed(() => this.permissions.has(PlatformPermission.CouponsManage));
  readonly canSeeCredits = computed(() => this.permissions.has(PlatformPermission.CreditsManage));
  readonly canSeeInvoices = computed(() => this.permissions.has(PlatformPermission.InvoiceRead));
  readonly canSeePaymentProviders = computed(() =>
    this.permissions.has(PlatformPermission.ProvidersConfigure)
  );
  readonly canSeeDunning = computed(() => this.permissions.has(PlatformPermission.InvoiceIssue));
  readonly canSeeAudit = computed(() => this.permissions.has(PlatformPermission.AuditRead));
  readonly canSeeAiConfig = computed(() => this.permissions.has(PlatformPermission.AiManage));
  readonly canSeeCompanySupport = computed(() => this.permissions.has(PlatformPermission.CompanySupportRead));
  readonly supportUnread = this.supportBadge.unreadCount;

  ngOnInit(): void {
    document.documentElement.dataset['tableDensity'] = this.prefs.tableDensity();
    if (!this.permissions.isLoaded() && this.auth.isAuthenticated()) {
      this.permissions.load().subscribe({ error: () => {} });
    }
    this.supportBadge.refresh();
    this.supportTimer = setInterval(() => this.supportBadge.refresh(), 20_000);
  }

  ngOnDestroy(): void {
    if (this.supportTimer) clearInterval(this.supportTimer);
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === '?' && !this.isTypingInInput(event)) {
      event.preventDefault();
      this.shortcutsVisible.set(true);
    }
  }

  readonly userMenuItems = computed<MenuItem[]>(() => {
    const u = this.auth.user();
    return [
      {
        label: u ? `${u.firstName} ${u.lastName}` : '—',
        styleClass: 'mu-header',
        disabled: true
      },
      {
        label: u?.email ?? '',
        styleClass: 'mu-email',
        disabled: true
      },
      { separator: true },
      {
        label: t('user.menu.profile'),
        icon: 'pi pi-user',
        command: () => this.userMenu?.navigateAndClose('/me')
      },
      {
        label: t('user.menu.preferences'),
        icon: 'pi pi-cog',
        command: () => this.userMenu?.navigateAndClose('/preferences')
      },
      {
        label: 'Authentification 2FA',
        icon: 'pi pi-shield',
        command: () => this.userMenu?.navigateAndClose('/me/2fa')
      },
      {
        label: 'Santé du système',
        icon: 'pi pi-heart',
        visible: this.canSeeSecurity(),
        command: () => this.userMenu?.navigateAndClose('/ops/health')
      },
      {
        label: t('user.menu.audit'),
        icon: 'pi pi-history',
        command: () => this.userMenu?.navigateAndClose('/me/audit')
      },
      {
        label: t('user.menu.docs'),
        icon: 'pi pi-book',
        command: () =>
          this.userMenu?.runAndClose(() => window.open(DOCS_URL, '_blank', 'noopener,noreferrer'))
      },
      {
        label: t('user.menu.shortcuts'),
        icon: 'pi pi-key',
        command: () => this.userMenu?.runAndClose(() => this.shortcutsVisible.set(true))
      },
      { separator: true },
      {
        label: t('user.menu.logout'),
        icon: 'pi pi-sign-out',
        styleClass: 'mu-danger',
        command: () => this.userMenu?.runAndClose(() => this.onLogout())
      }
    ];
  });

  onLogout(): void {
    const doLogout = (): void => {
      this.overlayCleanup.clearOrphanOverlays();
      this.permissions.clear();
      this.auth.logoutAndNavigate();
    };

    if (this.prefs.confirmLogout()) {
      if (window.confirm('Voulez-vous vraiment vous déconnecter ?')) {
        doLogout();
      }
    } else {
      doLogout();
    }
  }

  private isTypingInInput(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
}
