import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCtaComponent } from '../../shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { cabinetsPath } from '../../i18n/landing-locale.util';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/** Emoji par persona (visuel uniquement), indexé par `persona.cssClass` (classes conservées pour l'e2e). */
const PERSONA_EMOJI: Record<string, string> = {
  'persona-services': '🏢',
  'persona-retail': '🛒',
  'persona-distrib': '📦',
  'persona-accountant': '📊'
};

/**
 * Cas d'usage (plan A.4.14) : 4 personas. Les 3 profils entreprise → `<app-landing-cta>` ;
 * le persona cabinet (`persona-accountant`) → page « Cabinets comptables ».
 */
@Component({
  selector: 'app-use-cases-section',
  standalone: true,
  imports: [RouterModule, LandingCtaComponent, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="cas-usage" class="usecases-section" tabindex="-1" aria-labelledby="usecases-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.useCases.kicker }}</span>
          <h2 id="usecases-title" class="section-title">{{ t().home.useCases.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.useCases.subtitle)" />
          </p>
        </div>

        <div class="usecases-grid">
          @for (persona of t().home.useCases.personas; track persona.cssClass) {
            <article class="usecase-card" [class]="'usecase-card ' + persona.cssClass">
              <div class="usecase-emoji" aria-hidden="true">{{ emoji(persona.cssClass) }}</div>
              <h3 class="usecase-title">{{ persona.title }}</h3>
              <p class="usecase-description">
                <app-landing-rich [segments]="rich(persona.text)" />
              </p>
              @if (persona.cssClass === 'persona-accountant') {
                <a class="usecase-cta" [routerLink]="cabinetsUrl()">
                  {{ persona.cta }}
                  <i class="pi pi-arrow-right" aria-hidden="true"></i>
                </a>
              } @else {
                <app-landing-cta audience="company" cssClass="usecase-cta" [openLabelOverride]="persona.cta" />
              }
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .usecases-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: white;
      position: relative;
    }

    .usecases-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 1280px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-12);
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

    .usecases-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--spacing-5);
    }

    .usecase-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      transition: all var(--transition-normal);
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        top: 0;
        inset-inline: 0;
        height: 4px;
        background: linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600)); /* rtl-ok : dégradé décoratif */
        transform: scaleX(0);
        transform-origin: left; /* rtl-ok : barre de survol décorative */
        transition: transform var(--transition-normal);
      }

      &:hover {
        border-color: var(--color-primary-300);
        box-shadow: 0 16px 40px rgba(37, 99, 235, 0.12);
        transform: translateY(-6px);

        &::before {
          transform: scaleX(1);
        }

        .usecase-emoji {
          transform: scale(1.15) rotate(-5deg);
        }
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .usecase-card,
      .usecase-card::before,
      .usecase-emoji {
        transition: none;
      }
      .usecase-card:hover,
      .usecase-card:hover .usecase-emoji {
        transform: none;
      }
    }

    .persona-retail::before {
      background: linear-gradient(90deg, #f59e0b, #d97706); /* rtl-ok : dégradé décoratif */
    }

    .persona-distrib::before {
      background: linear-gradient(90deg, #8b5cf6, #6d28d9); /* rtl-ok : dégradé décoratif */
    }

    .persona-accountant::before {
      background: linear-gradient(90deg, #ec4899, #be185d); /* rtl-ok : dégradé décoratif */
    }

    .usecase-emoji {
      font-size: 3rem;
      line-height: 1;
      transition: transform var(--transition-normal);
    }

    .usecase-title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      margin: 0;
    }

    .usecase-description {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0 0 var(--spacing-2) 0;
      flex: 1;
    }

    .usecase-cta,
    .usecase-card ::ng-deep .landing-cta.usecase-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4);
      background: white;
      color: var(--color-primary-700);
      border: 1px solid var(--color-primary-300);
      border-radius: var(--radius-lg);
      text-decoration: none;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      transition: all var(--transition-normal);
    }

    .usecase-cta:hover,
    .usecase-card:hover ::ng-deep .landing-cta.usecase-cta,
    .usecase-card ::ng-deep .landing-cta.usecase-cta:hover {
      background: var(--color-primary-600);
      color: white;
      border-color: var(--color-primary-600);
    }

    .usecase-cta:focus-visible,
    .usecase-card ::ng-deep .landing-cta.usecase-cta:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 2px;
    }

    .usecase-card ::ng-deep .landing-cta.usecase-cta.landing-cta--skeleton {
      min-inline-size: 8rem;
      min-block-size: 2.4rem;
    }

    @media (max-width: 1024px) {
      .usecases-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .usecases-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .usecases-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class UseCasesSectionComponent extends LandingCopyBase {
  private readonly localeService = inject(LandingLocaleService);

  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));


  protected emoji(cssClass: string): string {
    return PERSONA_EMOJI[cssClass] ?? '🏢';
  }
}
