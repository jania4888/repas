import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';

/**
 * Confiance (plan A.4.19) : 6 cartes d'engagements vérifiables.
 * Textes : `t().home.trust`.
 */
@Component({
  selector: 'app-trust-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="confiance" class="trust-section" tabindex="-1" aria-labelledby="confiance-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.trust.kicker }}</span>
          <h2 id="confiance-title" class="section-title">{{ t().home.trust.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.trust.subtitle)" />
          </p>
        </div>

        <div class="trust-grid">
          @for (card of t().home.trust.cards; track card.title) {
            <article class="trust-card">
              <div class="trust-icon" aria-hidden="true">
                <i [class]="'pi ' + card.icon"></i>
              </div>
              <h3 class="trust-title">{{ card.title }}</h3>
              <p class="trust-description">
                <app-landing-rich [segments]="rich(card.text)" />
              </p>
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .trust-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: var(--color-neutral-50);
    }

    .trust-section:focus {
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

    .trust-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--spacing-6);
    }

    .trust-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal), border-color var(--transition-normal);
    }

    .trust-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
      border-color: var(--color-primary-200);
    }

    @media (prefers-reduced-motion: reduce) {
      .trust-card {
        transition: none;
      }
      .trust-card:hover {
        transform: none;
      }
    }

    .trust-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-lg);
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--spacing-4);

      i {
        font-size: 1.35rem;
      }
    }

    .trust-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2) 0;
    }

    .trust-description {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    @media (max-width: 1024px) {
      .trust-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .trust-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .trust-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class TrustSectionComponent {
  private readonly copy = inject(LandingCopyService);

  protected readonly t = this.copy.t;

  protected rich(text: string) {
    return this.copy.rich(text);
  }
}
