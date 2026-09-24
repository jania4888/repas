import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LANDING_FACTS } from '../../content/landing-facts';

/**
 * Comparatif (plan A.4.15) : 8 critères où InstaFact coche face aux outils séparés.
 * Textes : `t().home.comparison` (`{count}` → nombre de rôles).
 */
@Component({
  selector: 'app-comparison-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="comparaison" class="comparison-section" tabindex="-1" aria-labelledby="comparison-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.comparison.kicker }}</span>
          <h2 id="comparison-title" class="section-title">{{ t().home.comparison.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.comparison.subtitle)" />
          </p>
        </div>

        <div class="comparison-table-wrapper">
          <table class="comparison-table">
            <caption class="sr-only">{{ t().home.comparison.title }}</caption>
            <thead>
              <tr>
                <th scope="col" class="th-criterion">{{ t().home.comparison.kicker }}</th>
                <th scope="col" class="th-product th-ours">{{ t().home.comparison.ourLabel }}</th>
                <th scope="col" class="th-product">{{ t().home.comparison.otherLabel }}</th>
              </tr>
            </thead>
            <tbody>
              @for (criterion of t().home.comparison.criteria; track criterion) {
                <tr>
                  <th scope="row" class="td-criterion">
                    <app-landing-rich [segments]="rich(fillCounts(criterion))" />
                  </th>
                  <td class="td-cell td-ours">
                    <i class="pi pi-check-circle" aria-hidden="true"></i>
                  </td>
                  <td class="td-cell td-other">
                    <i class="pi pi-times-circle" aria-hidden="true"></i>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .comparison-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: var(--color-neutral-50);
    }

    .comparison-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 960px;
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

    .comparison-table-wrapper {
      overflow-x: auto;
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-md);
    }

    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      font-size: var(--font-size-sm);

      th,
      td {
        padding: var(--spacing-3) var(--spacing-4);
        text-align: start;
        vertical-align: middle;
      }

      thead th {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-bold);
        color: var(--color-neutral-900);
        border-bottom: 2px solid var(--color-neutral-200);
        padding: var(--spacing-4);
      }

      .th-product {
        text-align: center;
        width: 22%;
      }

      .th-ours {
        color: var(--color-primary-700);
        background: var(--color-primary-50);
      }

      .td-criterion {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-700);
        border-bottom: 1px solid var(--color-neutral-100);
      }

      .td-cell {
        text-align: center;
        border-bottom: 1px solid var(--color-neutral-100);

        i {
          font-size: 1.15rem;
        }
      }

      .td-ours {
        background: var(--color-primary-50);

        i {
          color: var(--color-success-600);
        }
      }

      .td-other i {
        color: var(--color-neutral-300);
      }

      tbody tr:last-child .td-criterion,
      tbody tr:last-child .td-cell {
        border-bottom: none;
      }
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 768px) {
      .comparison-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .comparison-table {
        font-size: var(--font-size-xs);

        th,
        td {
          padding: var(--spacing-2) var(--spacing-3);
        }
      }
    }
  `]
})
export class ComparisonSectionComponent {
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
