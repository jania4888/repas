import { Component, HostListener, signal, inject, OnInit, OnDestroy, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subject, takeUntil } from 'rxjs';
import { BRAND } from '@core/constants/brand';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from '../content/landing-copy.service';
import { LandingCtaComponent } from '../shared/landing-cta/landing-cta.component';
import { LandingLangSwitcherComponent } from '../shared/landing-lang-switcher/landing-lang-switcher.component';
import { cabinetsPath, homePath, isLandingHome } from '../i18n/landing-locale.util';

interface NavAnchor {
  label: string;
  fragment: string;
}

/**
 * En-tête public (plan A.3.3 / TA4 + TB2) : logo, 7 entrées de navigation issues du
 * dictionnaire (`t().shared.nav`), CTA dynamique `<app-landing-cta>`, « Se connecter » en dernier.
 * Les ancres naviguent avec `fragment` : le `LandingShellComponent` fait défiler avec l'offset header.
 * Tiroir mobile : vrai `<button>`, `aria-expanded`, Échap, piège à focus, restauration du focus.
 */
@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [CommonModule, RouterModule, LandingCtaComponent, LandingLangSwitcherComponent],
  template: `
    <header
      class="header-area header-sticky"
      [class.background-header]="isScrolled()"
      role="banner">
      <div class="container">
        <div class="row">
          <div class="col-12">
            <nav class="main-nav" [attr.aria-label]="t().shared.nav.menuLabel">
              <a [routerLink]="homeUrl()" class="logo" [attr.aria-current]="isHomePage() ? 'page' : null">
                <img [src]="brand.logoLockup" [alt]="t().shared.brand.logoAlt" width="1984" height="793">
              </a>
              <ul class="nav">
                @for (link of navAnchors(); track link.fragment) {
                  <li class="scroll-to-section">
                    <a [routerLink]="homeUrl()" [fragment]="link.fragment">{{ link.label }}</a>
                  </li>
                  @if (link.fragment === 'tarifs') {
                    <li>
                      <a [routerLink]="cabinetsUrl()" routerLinkActive="active">{{ t().shared.nav.cabinets }}</a>
                    </li>
                  }
                }
                <li class="landing-header-cta-item">
                  <app-landing-cta audience="company" cssClass="gradient-button secondary" />
                </li>
                <li class="landing-lang-slot">
                  <app-landing-lang-switcher />
                </li>
                <li>
                  <div class="gradient-button">
                    <a routerLink="/auth/login"><i class="fa fa-sign-in-alt" aria-hidden="true"></i> {{ t().shared.nav.login }}</a>
                  </div>
                </li>
              </ul>
              <button
                #menuTrigger
                type="button"
                class="menu-trigger"
                [class.active]="mobileMenuOpen()"
                (click)="toggleMobileMenu()"
                [attr.aria-expanded]="mobileMenuOpen()"
                aria-controls="mobile-menu"
                [attr.aria-label]="mobileMenuOpen() ? t().shared.nav.menuClose : t().shared.nav.menuOpen">
                <span aria-hidden="true"></span>
              </button>
            </nav>
          </div>
        </div>
      </div>

      <!-- Tiroir mobile (piloté par Angular, compatible Chain) -->
      <nav
        id="mobile-menu"
        class="mobile-menu chain-mobile-nav"
        [class.open]="mobileMenuOpen()"
        [attr.aria-label]="t().shared.nav.menuLabel"
        (keydown)="onDrawerKeydown($event)">
        <div class="mobile-menu-overlay" (click)="closeMobileMenu()"></div>
        <div class="mobile-menu-content" #drawerContent>
          <div class="drawer-lang">
            <app-landing-lang-switcher />
          </div>
          @for (link of navAnchors(); track link.fragment) {
            <a [routerLink]="homeUrl()" [fragment]="link.fragment" class="mobile-nav-link" (click)="closeMobileMenu()">{{ link.label }}</a>
            @if (link.fragment === 'tarifs') {
              <a [routerLink]="cabinetsUrl()" routerLinkActive="active" class="mobile-nav-link" (click)="closeMobileMenu()">{{ t().shared.nav.cabinets }}</a>
            }
          }
          <div class="drawer-ctas">
            <app-landing-cta audience="company" cssClass="mobile-nav-link primary" />
            <a routerLink="/auth/login" class="mobile-nav-link" (click)="closeMobileMenu()">{{ t().shared.nav.login }}</a>
          </div>
        </div>
      </nav>
    </header>
  `,
  styles: [`
    /* Header logo: transparent background (no inherited or hover/focus background) */
    .main-nav .logo {
      background: transparent;
      background-color: transparent;
    }
    .main-nav .logo:hover,
    .main-nav .logo:focus,
    .main-nav .logo:focus-visible {
      background: transparent;
      background-color: transparent;
    }
    /* Header logo: horizontal lockup, preserve aspect ratio */
    .main-nav .logo img {
      background: transparent;
      background-color: transparent;
      max-height: 56px;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    :host-context(.chain-theme-root) .header-area {
      height: 90px;
    }
    :host-context(.chain-theme-root) .header-area .main-nav {
      min-height: 70px;
    }
    :host-context(.chain-theme-root) .header-area .main-nav .logo {
      line-height: 90px;
      width: auto;
      max-width: 280px;
      overflow: visible;
    }
    :host-context(.chain-theme-root) .header-area.background-header .main-nav .logo {
      line-height: 70px;
    }
    :host-context(.chain-theme-root) .main-nav .logo img {
      max-height: 56px;
      width: auto;
      transform: none;
    }

    /* 9 entrées au lieu des 6 prévues par Chain : resserrer les espacements. */
    :host-context(.chain-theme-root) .header-area .main-nav .nav li,
    :host-context(.chain-theme-root) .background-header .main-nav .nav li {
      padding-inline: 10px;
    }
    /* La règle Chain li:nth-child(6) visait le bouton contact de la maquette :
       neutralisée pour que « Sécurité » reste un lien standard. */
    :host-context(.chain-theme-root) .header-area .main-nav .nav li:nth-child(6),
    :host-context(.chain-theme-root) .background-header .main-nav .nav li:nth-child(6) {
      padding-inline: 10px;
    }
    :host-context(.chain-theme-root) .header-area .main-nav .nav li:nth-child(6) a,
    :host-context(.chain-theme-root) .background-header .main-nav .nav li:nth-child(6) a {
      padding: 0 !important;
      font-weight: 500;
    }
    :host-context(.chain-theme-root) .header-area .main-nav .nav li:nth-child(6) a:hover,
    :host-context(.chain-theme-root) .background-header .main-nav .nav li:nth-child(6) a:hover,
    :host-context(.chain-theme-root) .header-area .main-nav .nav li:nth-child(6) a.active,
    :host-context(.chain-theme-root) .background-header .main-nav .nav li:nth-child(6) a.active {
      color: #4b8ef1 !important;
    }

    /* CTA dynamique : la classe « gradient-button » est portée par le <a> lui-même
       (les styles Chain ciblent « .gradient-button a » en descendant) → réplique locale. */
    :host-context(.chain-theme-root) .header-area .main-nav .nav li a.landing-cta.gradient-button {
      display: inline-block !important;
      padding: 10px 20px !important;
      color: #fff !important;
      text-transform: capitalize;
      font-size: 15px;
      font-weight: 500 !important;
      background: linear-gradient(105deg, rgba(91, 104, 235, 1) 0%, rgba(40, 225, 253, 1) 100%);
      border-radius: 23px;
      letter-spacing: 0.3px !important;
      height: auto;
      line-height: 1.4;
      text-decoration: none;
    }
    :host-context(.chain-theme-root) .header-area .main-nav .nav li a.landing-cta.gradient-button:hover {
      color: #fff !important;
      opacity: 0.92;
    }
    .landing-header-cta-item .landing-cta--skeleton {
      min-inline-size: 9rem;
      min-block-size: 2.4rem;
      vertical-align: middle;
    }

    /* Le CTA tient à partir de 1400px ; en dessous on garde la nav + login. */
    @media (min-width: 992px) and (max-width: 1399px) {
      :host-context(.chain-theme-root) .header-area .main-nav .nav li.landing-header-cta-item {
        display: none;
      }
    }
    @media (min-width: 992px) and (max-width: 1200px) {
      :host-context(.chain-theme-root) .header-area .main-nav .nav li,
      :host-context(.chain-theme-root) .header-area .main-nav .nav li:nth-child(6),
      :host-context(.chain-theme-root) .background-header .main-nav .nav li,
      :host-context(.chain-theme-root) .background-header .main-nav .nav li:nth-child(6) {
        padding-inline: 6px;
      }
      :host-context(.chain-theme-root) .header-area .main-nav .nav li a {
        letter-spacing: 0;
      }
      :host-context(.chain-theme-root) .header-area .main-nav .logo {
        max-width: 190px;
      }
    }

    @media (max-width: 767px) {
      :host-context(.chain-theme-root) .main-nav .logo {
        max-width: calc(100vw - 100px);
      }
      :host-context(.chain-theme-root) .main-nav .logo img {
        max-height: 44px;
        transform: none;
      }
    }

    /* Bouton hamburger (Chain stylise .menu-trigger quel que soit le tag) */
    .main-nav .menu-trigger {
      background: transparent;
      border: none;
      padding: 0;
      font: inherit;
    }

    /* Mobile menu only – header styled by Chain theme */
    .chain-mobile-nav {
      display: none;
      position: fixed;
      inset-block: 0;
      inset-inline: 0;
      z-index: 9999;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s, visibility 0.3s;
    }
    .chain-mobile-nav.open {
      display: block;
      opacity: 1;
      visibility: visible;
    }
    .chain-mobile-nav .mobile-menu-overlay {
      position: absolute;
      inset-block: 0;
      inset-inline: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .chain-mobile-nav .mobile-menu-content {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      width: 280px;
      max-width: 100%;
      background: #fff;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transform: translateX(100%); /* rtl-ok : inversé sous .landing-rtl */
      transition: transform 0.3s;
      box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1); /* rtl-ok : ombre décorative */
      overflow-y: auto;
    }
    :host-context(body.landing-rtl) .chain-mobile-nav .mobile-menu-content {
      transform: translateX(-100%);
    }
    .chain-mobile-nav.open .mobile-menu-content,
    :host-context(body.landing-rtl) .chain-mobile-nav.open .mobile-menu-content {
      transform: translateX(0);
    }
    .chain-mobile-nav .mobile-nav-link {
      display: block;
      padding: 0.75rem 1rem;
      color: #334155;
      text-decoration: none;
      border-radius: 0.375rem;
    }
    .chain-mobile-nav .mobile-nav-link:hover {
      background: #f1f5f9;
    }
    .chain-mobile-nav .drawer-ctas {
      display: grid;
      gap: 0.5rem;
      padding-top: 0.75rem;
      margin-top: 0.5rem;
      border-top: 1px solid #e2e8f0;
    }
    .chain-mobile-nav .mobile-nav-link.primary,
    .chain-mobile-nav a.landing-cta.mobile-nav-link.primary {
      background: linear-gradient(105deg, rgba(91, 104, 235, 1) 0%, rgba(40, 225, 253, 1) 100%);
      color: #fff;
      text-align: center;
      font-weight: 600;
    }
    .chain-mobile-nav .mobile-nav-link.primary:hover,
    .chain-mobile-nav a.landing-cta.mobile-nav-link.primary:hover {
      opacity: 0.92;
      background: linear-gradient(105deg, rgba(91, 104, 235, 1) 0%, rgba(40, 225, 253, 1) 100%);
    }
    @media (min-width: 992px) {
      .chain-mobile-nav { display: none !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      .chain-mobile-nav,
      .chain-mobile-nav .mobile-menu-content {
        transition: none;
      }
    }
  `]
})
export class PublicHeaderComponent implements OnInit, OnDestroy {
  readonly brand = BRAND;

  private readonly router = inject(Router);
  private readonly copy = inject(LandingCopyService);
  private readonly localeService = inject(LandingLocaleService);
  private readonly destroy$ = new Subject<void>();

  @ViewChild('menuTrigger') private menuTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('drawerContent') private drawerContent?: ElementRef<HTMLElement>;

  protected readonly t = this.copy.t;
  protected readonly mobileMenuOpen = signal(false);
  protected readonly isScrolled = signal(false);
  private readonly currentRoute = signal<string>('');

  protected readonly homeUrl = computed(() => homePath(this.localeService.locale()));
  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));

  protected readonly navAnchors = computed<NavAnchor[]>(() => {
    const nav = this.t().shared.nav;
    return [
      { label: nav.home, fragment: 'top' },
      { label: nav.modules, fragment: 'modules' },
      { label: nav.newFeatures, fragment: 'nouveautes' },
      { label: nav.pricing, fragment: 'tarifs' },
      { label: nav.security, fragment: 'securite-detail' },
      { label: nav.faq, fragment: 'faq' }
    ];
  });

  ngOnInit() {
    this.currentRoute.set(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event: NavigationEnd) => {
        this.currentRoute.set(event.url);
        this.closeMobileMenu();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    document.body.style.overflow = '';
  }

  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled.set(window.scrollY > 10);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.mobileMenuOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMobileMenu(true);
    }
  }

  toggleMobileMenu() {
    if (this.mobileMenuOpen()) {
      this.closeMobileMenu(true);
    } else {
      this.openMobileMenu();
    }
  }

  openMobileMenu() {
    this.mobileMenuOpen.set(true);
    document.body.style.overflow = 'hidden';
    // Focus le premier lien du tiroir une fois affiché.
    requestAnimationFrame(() => {
      const firstLink = this.drawerContent?.nativeElement.querySelector<HTMLElement>('a[href]');
      firstLink?.focus();
    });
  }

  closeMobileMenu(restoreFocus = false) {
    if (!this.mobileMenuOpen()) return;
    this.mobileMenuOpen.set(false);
    document.body.style.overflow = '';
    if (restoreFocus) {
      this.menuTrigger?.nativeElement.focus();
    }
  }

  /** Piège à focus : Tab / Maj+Tab restent dans le tiroir ouvert. */
  onDrawerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !this.mobileMenuOpen()) return;
    const root = this.drawerContent?.nativeElement;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter(
      el => el.getClientRects().length > 0
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  isHomePage(): boolean {
    return isLandingHome(this.currentRoute() || this.router.url);
  }
}
