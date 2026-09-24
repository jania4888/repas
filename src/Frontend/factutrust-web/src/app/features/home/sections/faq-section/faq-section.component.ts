import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCtaComponent } from '../../shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { cabinetsPath } from '../../i18n/landing-locale.util';
import { LANDING_FACTS } from '../../content/landing-facts';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * FAQ (plan A.4.20) : 10 Q/R en `<details>` natifs. La réponse « inscription » bascule sur
 * `answerWhenOpen` quand les inscriptions sont ouvertes. La question « expert-comptable »
 * ajoute un lien vers la page Cabinets comptables. RouterModule est importé (liens réels).
 */
@Component({
  selector: 'app-faq-section',
  standalone: true,
  imports: [RouterModule, LandingCtaComponent, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="faq" class="faq-section" tabindex="-1" aria-labelledby="faq-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.faq.kicker }}</span>
          <h2 id="faq-title" class="section-title">{{ t().home.faq.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.faq.subtitle)" />
          </p>
        </div>

        <div class="faq-list">
          @for (item of t().home.faq.items; track item.question; let i = $index) {
            <details class="faq-item">
              <summary class="faq-question">
                <span class="question-text">{{ item.question }}</span>
                <span class="question-icon" aria-hidden="true">
                  <i class="pi pi-plus"></i>
                  <i class="pi pi-minus"></i>
                </span>
              </summary>
              <div class="faq-answer">
                <p>
                  <app-landing-rich [segments]="rich(fillCounts(answerFor(item.answer, item.answerWhenOpen)))" />
                </p>
                @if (i === cabinetsQuestionIndex()) {
                  <a class="faq-link" [routerLink]="cabinetsUrl()">
                    {{ t().home.cabinetTeaser.cta }}
                    <i class="pi pi-arrow-right" aria-hidden="true"></i>
                  </a>
                }
              </div>
            </details>
          }
        </div>

        <div class="faq-cta-row">
          <app-landing-cta audience="company" cssClass="faq-cta" />
        </div>
      </div>
    </section>
  `,
  styles: [`
    .faq-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: white;
    }

    .faq-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 800px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-12);
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

    .faq-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .faq-item {
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      overflow: hidden;

      &[open] {
        background: white;
        border-color: var(--color-primary-200);
        box-shadow: var(--shadow-md);

        .question-icon .pi-plus {
          display: none;
        }
      }

      &:not([open]) {
        .question-icon .pi-minus {
          display: none;
        }
      }
    }

    .faq-question {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-4) var(--spacing-5);
      cursor: pointer;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      list-style: none;
      transition: color var(--transition-normal);

      &::-webkit-details-marker {
        display: none;
      }

      &:hover {
        color: var(--color-primary-700);
      }

      &:focus-visible {
        outline: 3px solid var(--color-primary-300);
        outline-offset: -3px;
      }
    }

    .question-text {
      flex: 1;
    }

    .question-icon {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      border-radius: var(--radius-full);
      font-size: 0.75rem;
    }

    .faq-answer {
      padding: 0 var(--spacing-5) var(--spacing-5);

      p {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        color: var(--color-neutral-600);
        margin: 0;
      }
    }

    .faq-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-3);
      color: var(--color-primary-700);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
        border-radius: var(--radius-sm);
      }
    }

    .faq-cta-row {
      text-align: center;
      margin-top: var(--spacing-10);
    }

    .faq-cta-row ::ng-deep .landing-cta.faq-cta {
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-3) var(--spacing-6);
      background: var(--color-primary-600);
      color: white;
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-semibold);
      text-decoration: none;
      transition: background var(--transition-normal);
    }

    .faq-cta-row ::ng-deep .landing-cta.faq-cta:hover {
      background: var(--color-primary-700);
    }

    .faq-cta-row ::ng-deep .landing-cta.faq-cta:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 2px;
    }

    @media (max-width: 768px) {
      .faq-section {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class FaqSectionComponent extends LandingCopyBase {
  private readonly status = inject(PublicRegistrationStatusService);
  private readonly localeService = inject(LandingLocaleService);

  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));

  /** Question « expert-comptable / cabinet » → lien vers la page Cabinets comptables. */
  protected readonly cabinetsQuestionIndex = computed(() =>
    this.t().home.faq.items.findIndex(item => /cabinet|expert-comptable/i.test(`${item.question} ${item.answer}`))
  );

  constructor() {
    super();
    this.status.ensureLoaded();
  }

  /** Réponse « inscription » : variante selon l'ouverture effective des inscriptions. */
  protected answerFor(answer: string, answerWhenOpen?: string): string {
    if (answerWhenOpen && (this.status.companyOpen() || this.status.firmOpen())) {
      return answerWhenOpen;
    }
    return answer;
  }


  /** `{rolesCount}` / `{count}` → nombre de rôles (question « utilisateurs et rôles »). */
  protected fillCounts(text: string): string {
    return this.copy.format(text, {
      count: LANDING_FACTS.rolesCount,
      rolesCount: LANDING_FACTS.rolesCount
    });
  }
}
