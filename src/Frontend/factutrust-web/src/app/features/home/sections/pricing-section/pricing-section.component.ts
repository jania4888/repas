import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingCtaComponent } from '../../shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { ANNUAL_SAVING_PERCENT, ANNUAL_SAVING_TND, LANDING_PRICING } from '../../content/landing-pricing';
import { cabinetsPath } from '../../i18n/landing-locale.util';

type PlanKey = 'free' | 'monthly' | 'annual';

/**
 * Tarifs (plan A.4.13 / TA7) : 3 plans dont les montants viennent de `LANDING_PRICING`
 * (jamais en dur dans le template), bloc « Version Cabinet — sur devis », bannière
 * Entreprise (CTA contact forcé, objet `entreprise`) et FAQ tarifaire (4 Q/R).
 * Les montants sont rendus dans des `span[dir="ltr"]` pour rester lisibles en RTL.
 */
@Component({
  selector: 'app-pricing-section',
  standalone: true,
  imports: [RouterModule, LandingCtaComponent, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="tarifs" class="pricing-section" tabindex="-1" aria-labelledby="tarifs-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.pricing.kicker }}</span>
          <h2 id="tarifs-title" class="section-title">{{ t().home.pricing.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.pricing.subtitle)" />
          </p>
          <p class="section-reassurance">{{ t().home.pricing.reassurance }}</p>
        </div>

        <div class="pricing-grid">
          @for (key of planKeys; track key) {
            <article class="pricing-card" [class.featured]="key === 'annual'">
              @if (key === 'annual') {
                <div class="pricing-badge-featured">{{ t().home.pricing.plans.annual.badge }}</div>
              }
              <div class="pricing-header">
                <h3 class="pricing-name">{{ t().home.pricing.plans[key].name }}</h3>
                @if (key !== 'annual' && t().home.pricing.plans[key].badge) {
                  <div class="pricing-badge">{{ t().home.pricing.plans[key].badge }}</div>
                }
                @if (key === 'annual') {
                  <div class="pricing-badge savings">{{ format(t().home.pricing.savingsBadge, { percent: savingPercent }) }}</div>
                }
                <div class="pricing-price">
                  <span class="price-amount" dir="ltr">{{ priceOf(key) }}</span>
                  <span class="price-currency">{{ currency }}</span>
                  <span class="price-period">{{ t().shared.common.perMonth }}</span>
                </div>
                @if (key === 'annual') {
                  <div class="pricing-billing">
                    <app-landing-rich [segments]="richWithAmount(t().home.pricing.billedYearly, pricing.annual.priceAnnual + ' ' + currency)" />
                  </div>
                }
                @if (t().home.pricing.plans[key].highlight) {
                  <div class="pricing-highlight">
                    <app-landing-rich [segments]="rich(fillPlan(t().home.pricing.plans[key].highlight, key))" />
                  </div>
                }
              </div>
              <div class="pricing-body">
                <ul class="pricing-features">
                  @for (feature of t().home.pricing.plans[key].features; track feature; let i = $index) {
                    <li>
                      <i class="pi pi-check" aria-hidden="true"></i>
                      <span><app-landing-rich [segments]="rich(fillPlan(feature, key, i))" /></span>
                    </li>
                  }
                  @for (disabled of t().home.pricing.plans[key].disabledFeatures; track disabled) {
                    <li class="feature-disabled">
                      <i class="pi pi-times" aria-hidden="true"></i>
                      <span>{{ disabled }}</span>
                    </li>
                  }
                </ul>
                <app-landing-cta
                  audience="company"
                  [cssClass]="key === 'annual' ? 'pricing-button primary' : 'pricing-button'"
                  [openLabelOverride]="t().home.pricing.plans[key].cta" />
                @if (key === 'annual') {
                  <p class="pricing-note">
                    <app-landing-rich [segments]="richWithAmount(t().home.pricing.annualSaving, savingTnd + ' ' + currency)" />
                  </p>
                }
              </div>
            </article>
          }
        </div>

        <aside class="cabinet-block" aria-labelledby="cabinet-block-title">
          <div class="cabinet-block-text">
            <h3 id="cabinet-block-title">{{ t().home.pricing.cabinet.title }}</h3>
            <p>
              <app-landing-rich [segments]="rich(t().home.pricing.cabinet.text)" />
            </p>
          </div>
          <div class="cabinet-block-actions">
            <app-landing-cta
              audience="firm"
              [forceContact]="true"
              subjectOverride="demo-cabinet"
              cssClass="cabinet-cta"
              [closedLabelOverride]="t().home.pricing.cabinet.cta" />
            <a class="cabinet-link" [routerLink]="cabinetsUrl()">
              {{ t().home.pricing.cabinet.link }}
              <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </a>
          </div>
        </aside>

        <div class="enterprise-banner">
          <div class="enterprise-content">
            <div class="enterprise-icon" aria-hidden="true">
              <i class="pi pi-building"></i>
            </div>
            <div class="enterprise-text">
              <h3>{{ t().home.pricing.enterprise.title }}</h3>
              <p>
                <app-landing-rich [segments]="rich(t().home.pricing.enterprise.text)" />
              </p>
            </div>
            <app-landing-cta
              [forceContact]="true"
              subjectOverride="entreprise"
              cssClass="enterprise-cta"
              [closedLabelOverride]="t().home.pricing.enterprise.cta" />
          </div>
        </div>

        <div class="pricing-faq">
          <h3 class="faq-title">{{ t().home.pricing.faqTitle }}</h3>
          <div class="faq-grid">
            @for (item of t().home.pricing.faq; track item.question) {
              <div class="faq-item">
                <h4>{{ item.question }}</h4>
                <p><app-landing-rich [segments]="rich(item.answer)" /></p>
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pricing-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: rgba(255, 255, 255, 0.85);
      position: relative;
    }

    .pricing-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 1280px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-16);
      max-width: 720px;
      margin-inline: auto;
    }

    .eyebrow {
      display: inline-block;
      padding: var(--spacing-2) var(--spacing-4);
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: var(--spacing-4);
    }

    .section-title {
      font-size: clamp(1.875rem, 4vw, 2.5rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .section-description {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    .section-reassurance {
      margin: var(--spacing-4) 0 0 0;
      display: inline-block;
      padding: 0.45rem 1rem;
      background: var(--color-success-50);
      color: var(--color-success-700);
      border-radius: var(--radius-full);
      font-size: 0.9rem;
      font-weight: var(--font-weight-semibold);
      border: 1px solid var(--color-success-200);
    }

    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-6);
      margin-bottom: var(--spacing-12);
    }

    .pricing-card {
      background: white;
      border: 2px solid var(--color-neutral-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      position: relative;
      transition: border-color var(--transition-normal), box-shadow var(--transition-normal), transform var(--transition-normal);
      display: flex;
      flex-direction: column;

      &:hover {
        border-color: var(--color-primary-300);
        box-shadow: var(--shadow-lg);
        transform: translateY(-4px);
      }

      &.featured {
        border-color: var(--color-primary-600);
        box-shadow: var(--shadow-xl);
        transform: scale(1.05);

        &:hover {
          transform: scale(1.05) translateY(-4px);
        }

        @media (max-width: 1024px) {
          transform: scale(1);

          &:hover {
            transform: translateY(-4px);
          }
        }
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .pricing-card,
      .pricing-card:hover,
      .pricing-card.featured,
      .pricing-card.featured:hover {
        transition: none;
        transform: none;
      }
    }

    .pricing-badge-featured {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-primary-600);
      color: white;
      padding: var(--spacing-2) var(--spacing-4);
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
    }

    .pricing-header {
      text-align: center;
      padding-bottom: var(--spacing-6);
      border-bottom: 1px solid var(--color-neutral-200);
      margin-bottom: var(--spacing-6);
    }

    .pricing-name {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-3) 0;
    }

    .pricing-badge {
      display: inline-block;
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-success-50);
      color: var(--color-success-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      margin-bottom: var(--spacing-3);

      &.savings {
        background: var(--color-primary-50);
        color: var(--color-primary-700);
      }
    }

    .pricing-price {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: var(--spacing-1);
      margin-top: var(--spacing-4);
    }

    .price-amount {
      font-size: 3rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: 1;
    }

    .price-currency {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-600);
    }

    .price-period {
      font-size: var(--font-size-base);
      color: var(--color-neutral-500);
    }

    .pricing-billing {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      margin-top: var(--spacing-2);
    }

    .pricing-highlight {
      font-size: var(--font-size-base);
      color: var(--color-primary-700);
      font-weight: var(--font-weight-semibold);
      margin-top: var(--spacing-3);
      padding: var(--spacing-2) var(--spacing-4);
      background: var(--color-primary-50);
      border-radius: var(--radius-md);
      display: inline-block;
    }

    .pricing-body {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .pricing-features {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--spacing-6) 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);

      li {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-2);
        font-size: var(--font-size-base);
        color: var(--color-neutral-700);
        line-height: var(--line-height-relaxed);

        > i {
          color: var(--color-success-600);
          font-size: 1rem;
          margin-top: 2px;
          flex-shrink: 0;
        }

        &.feature-disabled {
          color: var(--color-neutral-500);

          > i {
            color: var(--color-error-600);
          }
        }
      }
    }

    /* Boutons des plans (le <a> est rendu par app-landing-cta). */
    .pricing-card ::ng-deep .landing-cta.pricing-button {
      display: block;
      text-align: center;
      padding: var(--spacing-4) var(--spacing-6);
      border-radius: var(--radius-lg);
      text-decoration: none;
      font-weight: var(--font-weight-semibold);
      transition: background var(--transition-normal), box-shadow var(--transition-normal), transform var(--transition-normal);
      margin-bottom: var(--spacing-3);
      background: var(--color-neutral-100);
      color: var(--color-neutral-700);
      border: 2px solid var(--color-neutral-300);
    }

    .pricing-card ::ng-deep .landing-cta.pricing-button:hover {
      background: var(--color-neutral-200);
      border-color: var(--color-neutral-400);
    }

    .pricing-card ::ng-deep .landing-cta.pricing-button.primary {
      background: var(--color-primary-600);
      color: white;
      border-color: var(--color-primary-600);
      box-shadow: var(--shadow-md);
    }

    .pricing-card ::ng-deep .landing-cta.pricing-button.primary:hover {
      background: var(--color-primary-700);
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
    }

    .pricing-card ::ng-deep .landing-cta.pricing-button:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 2px;
    }

    .pricing-card ::ng-deep .landing-cta.pricing-button.landing-cta--skeleton {
      display: block;
      min-inline-size: 100%;
    }

    .pricing-note {
      text-align: center;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      margin: 0;
    }

    /* Bloc Version Cabinet — sur devis */
    .cabinet-block {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--spacing-8);
      align-items: center;
      background: var(--color-primary-50);
      border: 1px solid var(--color-primary-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-8);
      margin-bottom: var(--spacing-12);
    }

    .cabinet-block-text {
      h3 {
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-neutral-900);
        margin: 0 0 var(--spacing-2) 0;
      }

      p {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        color: var(--color-neutral-600);
        margin: 0;
      }
    }

    .cabinet-block-actions {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--spacing-3);
      min-width: 240px;
    }

    .cabinet-block-actions ::ng-deep .landing-cta.cabinet-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-3) var(--spacing-6);
      background: var(--color-primary-600);
      color: white;
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-semibold);
      text-decoration: none;
      transition: background var(--transition-normal);
    }

    .cabinet-block-actions ::ng-deep .landing-cta.cabinet-cta:hover {
      background: var(--color-primary-700);
    }

    .cabinet-block-actions ::ng-deep .landing-cta.cabinet-cta:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 2px;
    }

    .cabinet-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      color: var(--color-primary-700);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    /* Bannière Entreprise */
    .enterprise-banner {
      background: linear-gradient(135deg, var(--color-neutral-900) 0%, #1e3a8a 100%);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-10);
      color: white;
      box-shadow: var(--shadow-xl);
      position: relative;
      overflow: hidden;
    }

    .enterprise-banner::before {
      content: '';
      position: absolute;
      top: -50%;
      inset-inline-end: -10%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .enterprise-content {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: var(--spacing-8);
      align-items: center;
      position: relative;
      z-index: 1;
    }

    .enterprise-icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      border-radius: var(--radius-xl);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      i {
        font-size: 2.5rem;
        color: white;
      }
    }

    .enterprise-text {
      h3 {
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: white;
        margin: 0 0 var(--spacing-3) 0;
      }

      p {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        color: rgba(255, 255, 255, 0.85);
        margin: 0;
      }
    }

    .enterprise-content ::ng-deep .landing-cta.enterprise-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4) var(--spacing-6);
      background: white;
      color: var(--color-neutral-900);
      text-decoration: none;
      font-weight: var(--font-weight-semibold);
      border-radius: var(--radius-lg);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal);
      flex-shrink: 0;
      white-space: nowrap;
    }

    .enterprise-content ::ng-deep .landing-cta.enterprise-cta:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }

    .enterprise-content ::ng-deep .landing-cta.enterprise-cta:focus-visible {
      outline: 3px solid #7dd3fc;
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .enterprise-content ::ng-deep .landing-cta.enterprise-cta {
        transition: none;
      }
      .enterprise-content ::ng-deep .landing-cta.enterprise-cta:hover {
        transform: none;
      }
    }

    .pricing-faq {
      margin-top: var(--spacing-16);
      padding-top: var(--spacing-16);
      border-top: 1px solid var(--color-neutral-200);
    }

    .faq-title {
      text-align: center;
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-8) 0;
    }

    .faq-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-6);
    }

    .faq-item {
      padding: var(--spacing-5);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-neutral-200);

      h4 {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
        margin: 0 0 var(--spacing-2) 0;
      }

      p {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        color: var(--color-neutral-600);
        margin: 0;
      }
    }

    @media (max-width: 1024px) {
      .pricing-grid {
        grid-template-columns: 1fr;
        max-width: 500px;
        margin-inline: auto;
      }

      .cabinet-block {
        grid-template-columns: 1fr;
      }

      .cabinet-block-actions {
        min-width: 0;
      }

      .enterprise-content {
        grid-template-columns: 1fr;
        text-align: center;
      }

      .enterprise-icon {
        margin-inline: auto;
      }

      .enterprise-content ::ng-deep .landing-cta.enterprise-cta {
        margin-inline: auto;
      }

      .faq-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .pricing-section {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class PricingSectionComponent {
  private readonly copy = inject(LandingCopyService);
  private readonly localeService = inject(LandingLocaleService);

  protected readonly t = this.copy.t;
  protected readonly pricing = LANDING_PRICING;
  protected readonly currency = LANDING_PRICING.currency;
  protected readonly savingPercent = ANNUAL_SAVING_PERCENT;
  protected readonly savingTnd = ANNUAL_SAVING_TND;
  protected readonly planKeys: readonly PlanKey[] = ['free', 'monthly', 'annual'];
  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));

  /** Valeurs `{count}` du plan gratuit, dans l'ordre des lignes `features` du dictionnaire. */
  private readonly freeFeatureCounts: readonly number[] = [
    LANDING_PRICING.free.maxInvoicesPerMonth,
    LANDING_PRICING.free.maxQuotesPerMonth,
    LANDING_PRICING.free.maxClients,
    LANDING_PRICING.free.maxProducts,
    LANDING_PRICING.free.maxInvoicesPerMonth, // ligne « {amount} de stockage » — {count} inutilisé
    LANDING_PRICING.free.maxUsers
  ];

  protected priceOf(key: PlanKey): number {
    return key === 'free'
      ? LANDING_PRICING.free.priceMonthly
      : key === 'monthly'
        ? LANDING_PRICING.monthly.priceMonthly
        : LANDING_PRICING.annual.priceMonthly;
  }

  protected rich(text: string) {
    return this.copy.rich(text);
  }

  protected format(template: string, params: Record<string, string | number>): string {
    return this.copy.format(template, params);
  }

  /** Formate `{amount}` puis l'isole en LTR (`[[…]]` → `rich()` → `span[dir="ltr"]`). */
  protected richWithAmount(template: string, amount: string) {
    return this.copy.rich(this.copy.format(template, { amount: `[[${amount}]]` }));
  }

  /**
   * Injecte les valeurs du plan dans `{count}` / `{amount}` (+ jetons nommés
   * `{invoices}` `{quotes}` `{clients}` `{products}` `{users}` si le dictionnaire les utilise).
   */
  protected fillPlan(text: string, key: PlanKey, featureIndex = 0): string {
    const storage =
      key === 'free'
        ? LANDING_PRICING.free.storageLabel
        : key === 'monthly'
          ? LANDING_PRICING.monthly.storageLabel
          : LANDING_PRICING.annual.storageLabel;
    return this.copy.format(text, {
      count: key === 'free' ? (this.freeFeatureCounts[featureIndex] ?? LANDING_PRICING.free.maxInvoicesPerMonth) : 0,
      amount: `[[${storage}]]`,
      invoices: LANDING_PRICING.free.maxInvoicesPerMonth,
      quotes: LANDING_PRICING.free.maxQuotesPerMonth,
      clients: LANDING_PRICING.free.maxClients,
      products: LANDING_PRICING.free.maxProducts,
      users: LANDING_PRICING.free.maxUsers
    });
  }
}
