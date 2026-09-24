import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from './content/landing-copy.service';
import { LandingCtaComponent } from './shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from './shared/landing-rich/landing-rich.component';
import { cabinetsPath, homePath } from './i18n/landing-locale.util';
import { LANDING_FACTS } from './content/landing-facts';
import { LANDING_PRICING } from './content/landing-pricing';

import { PromoBannerComponent } from './sections/promo-banner/promo-banner.component';
import { PublicHeaderComponent } from './public-header/public-header.component';
import { PublicFooterComponent } from './public-footer/public-footer.component';
import { ContactRequestSectionComponent } from './contact/contact-request-section.component';
import { ProblemSolutionSectionComponent } from './sections/problem-solution-section/problem-solution-section.component';
import { ModuleShowcaseSectionComponent } from './sections/module-showcase-section/module-showcase-section.component';
import { FeaturesSectionComponent } from './sections/features-section/features-section.component';
import { AiSpotlightSectionComponent } from './sections/ai-spotlight-section/ai-spotlight-section.component';
import { ForecastingSpotlightSectionComponent } from './sections/forecasting-spotlight-section/forecasting-spotlight-section.component';
import { NewFeaturesSectionComponent } from './sections/new-features-section/new-features-section.component';
import { CabinetTeaserSectionComponent } from './sections/cabinet-teaser-section/cabinet-teaser-section.component';
import { PricingSectionComponent } from './sections/pricing-section/pricing-section.component';
import { UseCasesSectionComponent } from './sections/use-cases-section/use-cases-section.component';
import { ComparisonSectionComponent } from './sections/comparison-section/comparison-section.component';
import { ComplianceSectionComponent } from './sections/compliance-section/compliance-section.component';
import { SecuritySectionComponent } from './sections/security-section/security-section.component';
import { IntegrationsSectionComponent } from './sections/integrations-section/integrations-section.component';
import { StatsSectionComponent } from './sections/stats-section/stats-section.component';
import { TrustSectionComponent } from './sections/trust-section/trust-section.component';
import { FaqSectionComponent } from './sections/faq-section/faq-section.component';
import { CtaSectionComponent } from './sections/cta-section/cta-section.component';

/**
 * Page d'accueil publique (plan § 5.2 / A.3.2).
 * Ordre : promo → header → hero #top → trust strip → (rue virtuelle) → problème/solution →
 * modules → fonctionnalités → IA → forecasting → nouveautés → teaser cabinets → tarifs →
 * cas d'usage → comparaison → conformité (eager, e2e) → sécurité → intégrations → stats →
 * confiance → FAQ → CTA final → contact (TB7) → footer.
 * Le thème Chain, la langue et le SEO sont gérés par `LandingShellComponent` (route parente) ;
 * les ancres défilent via `LandingScrollService` (offset header 80px).
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RouterModule,
    LandingCtaComponent,
    LandingRichComponent,
    PublicHeaderComponent,
    PublicFooterComponent,
    PromoBannerComponent,
    ProblemSolutionSectionComponent,
    ModuleShowcaseSectionComponent,
    FeaturesSectionComponent,
    AiSpotlightSectionComponent,
    ForecastingSpotlightSectionComponent,
    NewFeaturesSectionComponent,
    CabinetTeaserSectionComponent,
    PricingSectionComponent,
    UseCasesSectionComponent,
    ComparisonSectionComponent,
    ComplianceSectionComponent,
    SecuritySectionComponent,
    IntegrationsSectionComponent,
    StatsSectionComponent,
    TrustSectionComponent,
    FaqSectionComponent,
    CtaSectionComponent,
    ContactRequestSectionComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chain-theme-root">
      <app-promo-banner />
      <app-public-header />

      <!-- Hero (A.4.1) : H1 unique, CTA dynamique, liens Cabinet + modules -->
      <section id="top" class="hero" aria-labelledby="hero-title">
        <div class="hero-inner">
          <div class="hero-content">
            <p class="hero-kicker">
              <i class="pi pi-verified" aria-hidden="true"></i>
              {{ t().home.hero.kicker }}
            </p>
            <h1 id="hero-title" class="hero-title">{{ t().home.hero.title }}</h1>
            <p class="hero-subtitle">
              <app-landing-rich [segments]="rich(t().home.hero.subtitle)" />
            </p>
            <div class="hero-actions">
              <app-landing-cta audience="company" cssClass="hero-primary" />
              <a class="hero-secondary" [routerLink]="cabinetsUrl()">
                {{ t().home.hero.secondaryCta }}
                <i class="pi pi-arrow-right" aria-hidden="true"></i>
              </a>
            </div>
            <p class="hero-note">{{ ctaNote() }}</p>
            <a class="hero-modules-link" [routerLink]="homeUrl()" fragment="modules">
              {{ modulesLink() }}
              <i class="pi pi-arrow-down" aria-hidden="true"></i>
            </a>
          </div>
          <div class="hero-visual">
            <img
              src="assets/theme/chain/assets/images/slider-dec.svg"
              width="710"
              height="500"
              fetchpriority="high"
              [alt]="t().home.hero.imageAlt" />
          </div>
        </div>
      </section>

      <!-- Bandeau de preuves (A.4.2) : chiffres vérifiables + badges -->
      <div class="trust-strip">
        <div class="trust-strip-inner">
          <p class="trust-strip-stats">
            <span>{{ fillModules(t().home.trustStrip.modules) }}</span>
            <span class="sep" aria-hidden="true">·</span>
            <span>{{ fillRoles(t().home.trustStrip.roles) }}</span>
            <span class="sep" aria-hidden="true">·</span>
            <span>{{ fillTools(t().home.trustStrip.aiTools) }}</span>
          </p>
          <p class="trust-strip-badges">
            @for (badge of t().home.trustStrip.badges; track badge) {
              <span><i class="pi pi-check-circle" aria-hidden="true"></i> {{ badge }}</span>
            }
          </p>
        </div>
      </div>

      @if (storefrontEnabled) {
        <!-- h2 (et non h3) : l'ordre des titres ne saute pas de niveau (a11y Lighthouse). -->
        <section class="section virtual-street-cta" aria-labelledby="virtual-street-heading">
          <div class="container">
            <div class="row align-items-center gy-4">
              <div class="col-lg-5 order-lg-2 text-center">
                <div class="street-preview" role="img" [attr.aria-label]="t().shared.virtualTour.text">
                  <span class="facade f1" aria-hidden="true"></span>
                  <span class="facade f2" aria-hidden="true"></span>
                  <span class="facade f3" aria-hidden="true"></span>
                </div>
              </div>
              <div class="col-lg-7 order-lg-1">
                <h2 id="virtual-street-heading">{{ t().shared.virtualTour.title }}</h2>
                <p>{{ t().shared.virtualTour.text }}</p>
                <a class="virtual-street-link" routerLink="/visite-virtuelle">
                  {{ t().shared.virtualTour.link }}
                  <i class="pi pi-cube" aria-hidden="true"></i>
                </a>
              </div>
            </div>
          </div>
        </section>
      }

      <app-problem-solution-section />
      <app-module-showcase-section />
      <app-features-section />
      <app-ai-spotlight-section />
      <app-forecasting-spotlight-section />
      <app-new-features-section />
      <app-cabinet-teaser-section />
      <app-pricing-section />
      <app-use-cases-section />

      @defer (on idle) {
        <app-comparison-section />
      }

      <!-- #conformite et #cas-usage reste chargé à l'affichage (contrat e2e) -->
      <app-compliance-section />

      @defer (on idle) {
        <app-security-section />
        <!-- Alias d'ancre historique : les liens #securite pointent vers la sécurité détaillée -->
        <span id="securite" class="anchor-alias" aria-hidden="true"></span>
        <app-integrations-section />
      }

      <app-stats-section />

      @defer (on idle) {
        <app-trust-section />
        <app-faq-section />
        <app-cta-section />
      }

      <app-contact-request-section defaultSubject="acces-entreprise" />

      <app-public-footer />
    </div>
  `,
  styles: [`
    .chain-theme-root {
      min-height: 100vh;
    }

    .anchor-alias {
      position: relative;
      top: -80px;
      display: block;
      height: 0;
    }

    /* ---------------------------------------------------------- Hero */
    .hero {
      padding: var(--spacing-16) var(--spacing-6) var(--spacing-20);
      background: linear-gradient(180deg, var(--color-primary-50) 0%, #ffffff 100%);
      overflow: hidden;
    }

    .hero-inner {
      max-width: 1280px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      gap: var(--spacing-10);
      align-items: center;
    }

    .hero-kicker {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      background: white;
      border: 1px solid var(--color-primary-200);
      color: var(--color-primary-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.04em;
      margin: 0 0 var(--spacing-5) 0;
    }

    .hero-title {
      font-size: clamp(2rem, 4.5vw, 3rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-5) 0;
    }

    .hero-subtitle {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0 0 var(--spacing-8) 0;
      max-width: 56ch;
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      flex-wrap: wrap;
      margin-bottom: var(--spacing-3);
    }

    .hero-actions ::ng-deep .landing-cta.hero-primary {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4) var(--spacing-8);
      background: linear-gradient(105deg, #5b68eb 0%, #28e1fd 100%);
      color: #ffffff;
      border-radius: var(--radius-full);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-bold);
      text-decoration: none;
      box-shadow: var(--shadow-lg);
      transition: transform var(--transition-normal), box-shadow var(--transition-normal);
    }

    .hero-actions ::ng-deep .landing-cta.hero-primary:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-xl);
    }

    .hero-actions ::ng-deep .landing-cta.hero-primary:focus-visible,
    .hero-secondary:focus-visible,
    .hero-modules-link:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 3px;
    }

    .hero-secondary {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4) var(--spacing-6);
      background: white;
      border: 1px solid var(--color-neutral-300);
      color: var(--color-neutral-800);
      border-radius: var(--radius-full);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      text-decoration: none;
      transition: border-color var(--transition-normal), color var(--transition-normal);
    }

    .hero-secondary:hover {
      border-color: var(--color-primary-400);
      color: var(--color-primary-700);
    }

    .hero-note {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      margin: 0 0 var(--spacing-4) 0;
    }

    .hero-modules-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      color: var(--color-primary-700);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      text-decoration: none;
    }

    .hero-modules-link:hover {
      text-decoration: underline;
    }

    .hero-visual {
      display: flex;
      justify-content: center;
    }

    .hero-visual img {
      max-width: 100%;
      height: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      .hero-actions ::ng-deep .landing-cta.hero-primary,
      .hero-secondary {
        transition: none;
      }
      .hero-actions ::ng-deep .landing-cta.hero-primary:hover {
        transform: none;
      }
    }

    @media (max-width: 992px) {
      .hero {
        padding: var(--spacing-12) var(--spacing-4) var(--spacing-16);
      }

      .hero-inner {
        grid-template-columns: 1fr;
        gap: var(--spacing-8);
      }

      .hero-visual {
        order: -1;
      }

      .hero-visual img {
        max-width: 320px;
      }
    }

    /* ---------------------------------------------------- Trust strip */
    .trust-strip {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      padding: 1rem 1.25rem;
    }

    .trust-strip-inner {
      max-width: 1180px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: center;
      text-align: center;
    }

    .trust-strip-stats,
    .trust-strip-badges {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.4rem 1rem;
      color: #334155;
      font-size: 0.95rem;
      margin: 0;
    }

    .trust-strip-stats {
      font-weight: 600;
      color: #0f172a;
    }

    .trust-strip-stats .sep {
      color: #94a3b8;
    }

    .trust-strip-badges i {
      color: var(--color-success-600);
      margin-inline-end: 0.3rem;
    }

    @media (max-width: 600px) {
      .trust-strip-stats,
      .trust-strip-badges {
        gap: 0.3rem 0.7rem;
        font-size: 0.85rem;
      }
      .trust-strip-stats .sep {
        display: none;
      }
    }

    /* ------------------------------------------------- Rue virtuelle */
    .virtual-street-cta {
      padding: 2.5rem 0;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); /* rtl-ok */
      border-top: 1px solid #bae6fd;
      border-bottom: 1px solid #bae6fd;
    }

    .virtual-street-cta h2 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #0c4a6e;
    }

    .virtual-street-cta p {
      color: #334155;
      line-height: 1.55;
    }

    .virtual-street-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding: 0.75rem 1.5rem;
      background: #0369a1; /* contraste AA avec texte blanc (Lighthouse color-contrast) */
      color: #ffffff;
      border-radius: 999px;
      font-weight: 600;
      text-decoration: none;
      transition: background var(--transition-normal);
    }

    .virtual-street-link:hover {
      background: #075985;
    }

    .virtual-street-link:focus-visible {
      outline: 3px solid #7dd3fc;
      outline-offset: 2px;
    }

    .street-preview {
      display: inline-flex;
      align-items: flex-end;
      justify-content: center;
      gap: 0.65rem;
      padding: 1.25rem 1.5rem 0.75rem;
      border-radius: 1rem;
      background: linear-gradient(180deg, #e0f2fe 0%, #bae6fd 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
    }

    .street-preview .facade {
      display: block;
      width: 3.25rem;
      border-radius: 0.35rem 0.35rem 0 0;
      transform: skewX(-8deg); /* rtl-ok */
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12);
      animation: facade-float 3.2s ease-in-out infinite;
    }

    .street-preview .f1 {
      height: 4.5rem;
      background: linear-gradient(180deg, #38bdf8, #0284c7);
      animation-delay: 0s;
    }

    .street-preview .f2 {
      height: 5.75rem;
      background: linear-gradient(180deg, #a78bfa, #6366f1);
      animation-delay: 0.2s;
    }

    .street-preview .f3 {
      height: 4rem;
      background: linear-gradient(180deg, #34d399, #059669);
      animation-delay: 0.4s;
    }

    @keyframes facade-float {
      0%,
      100% {
        transform: skewX(-8deg) translateY(0); /* rtl-ok */
      }
      50% {
        transform: skewX(-8deg) translateY(-6px); /* rtl-ok */
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .street-preview .facade {
        animation: none;
      }
    }
  `]
})
export class HomeComponent {
  private readonly copy = inject(LandingCopyService);
  private readonly status = inject(PublicRegistrationStatusService);
  private readonly localeService = inject(LandingLocaleService);

  protected readonly t = this.copy.t;
  protected readonly storefrontEnabled = environment.storefrontEnabled;
  protected readonly homeUrl = computed(() => homePath(this.localeService.locale()));
  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));

  /** Note sous le CTA : quotas gratuits si ouvert, mention « sur invitation » sinon. */
  protected readonly ctaNote = computed(() => {
    const hero = this.t().home.hero;
    if (this.status.companyOpen() || this.status.firmOpen()) {
      return this.copy.format(hero.ctaOpenNote, { count: LANDING_PRICING.free.maxInvoicesPerMonth });
    }
    return hero.ctaClosedNote;
  });

  protected readonly modulesLink = computed(() =>
    this.copy.format(this.t().home.hero.modulesLink, { count: LANDING_FACTS.modulesCount })
  );

  constructor() {
    this.status.ensureLoaded();
  }

  protected rich(text: string) {
    return this.copy.rich(text);
  }

  protected fillModules(text: string): string {
    return this.copy.format(text, { count: LANDING_FACTS.modulesCount });
  }

  protected fillRoles(text: string): string {
    return this.copy.format(text, { count: LANDING_FACTS.rolesCount });
  }

  protected fillTools(text: string): string {
    return this.copy.format(text, { count: LANDING_FACTS.aiToolsCount });
  }
}
