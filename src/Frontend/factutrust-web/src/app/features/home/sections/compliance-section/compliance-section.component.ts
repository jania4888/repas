import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';

/**
 * Conformité (plan A.4.16) : 6 cartes « ce qui existe dans l'application ».
 * Textes : `t().home.compliance`. `#conformite` est chargé à l'affichage (e2e).
 */
@Component({
  selector: 'app-compliance-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="conformite" class="compliance-section" tabindex="-1" aria-labelledby="compliance-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">
            <i class="pi pi-verified" aria-hidden="true"></i>
            {{ t().home.compliance.kicker }}
          </span>
          <h2 id="compliance-title" class="section-title">{{ t().home.compliance.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.compliance.subtitle)" />
          </p>
        </div>

        <div class="compliance-grid">
          @for (card of t().home.compliance.cards; track card.title) {
            <article class="compliance-card">
              <div class="card-icon" aria-hidden="true">
                <i [class]="'pi ' + card.icon"></i>
              </div>
              <h3 class="card-title">{{ card.title }}</h3>
              <p class="card-description">
                <app-landing-rich [segments]="rich(card.text)" />
              </p>
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .compliance-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: white;
    }

    .compliance-section:focus {
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
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      background: var(--color-success-50);
      color: var(--color-success-700);
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

    .compliance-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--spacing-6);
    }

    .compliance-card {
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal), border-color var(--transition-normal);
    }

    .compliance-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
      border-color: var(--color-success-200);
    }

    @media (prefers-reduced-motion: reduce) {
      .compliance-card {
        transition: none;
      }
      .compliance-card:hover {
        transform: none;
      }
    }

    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-lg);
      background: var(--color-success-50);
      color: var(--color-success-600);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--spacing-4);

      i {
        font-size: 1.35rem;
      }
    }

    .card-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2) 0;
    }

    .card-description {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    @media (max-width: 1024px) {
      .compliance-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .compliance-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .compliance-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ComplianceSectionComponent {
  private readonly copy = inject(LandingCopyService);

  protected readonly t = this.copy.t;

  protected rich(text: string) {
    return this.copy.rich(text);
  }
}
