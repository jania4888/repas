import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LANDING_FACTS } from '../../content/landing-facts';

/**
 * Sécurité détaillée (plan A.4.17) : 5 points vérifiables (2FA, rôles, isolation, rate limiting, exports).
 * Textes : `t().home.security` (`{count}` → nombre de rôles).
 */
@Component({
  selector: 'app-security-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="securite-detail" class="security-section" tabindex="-1" aria-labelledby="securite-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">
            <i class="pi pi-shield" aria-hidden="true"></i>
            {{ t().home.security.kicker }}
          </span>
          <h2 id="securite-title" class="section-title">{{ t().home.security.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.security.subtitle)" />
          </p>
        </div>

        <div class="security-grid">
          @for (point of t().home.security.points; track point.title) {
            <article class="security-card">
              <h3 class="security-title">{{ point.title }}</h3>
              <p class="security-description">
                <app-landing-rich [segments]="rich(fillCounts(point.text))" />
              </p>
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .security-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: var(--color-neutral-50);
    }

    .security-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 1080px;
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

    .security-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--spacing-5);
    }

    .security-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      border-inline-start: 4px solid var(--color-primary-500);
    }

    .security-card:last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }

    .security-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2) 0;
    }

    .security-description {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    @media (max-width: 768px) {
      .security-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .security-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class SecuritySectionComponent {
  private readonly copy = inject(LandingCopyService);

  protected readonly t = this.copy.t;

  protected rich(text: string) {
    return this.copy.rich(text);
  }

  /** `{count}` / `{rolesCount}` → nombre de rôles. */
  protected fillCounts(text: string): string {
    return this.copy.format(text, {
      count: LANDING_FACTS.rolesCount,
      rolesCount: LANDING_FACTS.rolesCount
    });
  }
}
