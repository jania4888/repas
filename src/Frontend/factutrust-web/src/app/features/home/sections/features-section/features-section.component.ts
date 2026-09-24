import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LANDING_FACTS } from '../../content/landing-facts';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * Grille des 9 fonctionnalités (plan A.4.7). Textes : `t().home.features`
 * (`{count}` → constantes de `landing-facts.ts`).
 */
@Component({
  selector: 'app-features-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="fonctionnalites" class="features-section" tabindex="-1" aria-labelledby="fonctionnalites-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.features.kicker }}</span>
          <h2 id="fonctionnalites-title" class="section-title">{{ t().home.features.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.features.subtitle)" />
          </p>
        </div>

        <div class="features-grid">
          @for (item of t().home.features.items; track item.title) {
            <article class="feature-card">
              <div class="feature-icon" aria-hidden="true">
                <i [class]="'pi ' + item.icon"></i>
              </div>
              <h3 class="feature-title">{{ fillCounts(item.title) }}</h3>
              <p class="feature-description">
                <app-landing-rich [segments]="rich(fillCounts(item.text))" />
              </p>
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .features-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: var(--color-neutral-50);
    }

    .features-section:focus {
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

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--spacing-6);
    }

    .feature-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal), border-color var(--transition-normal);
    }

    .feature-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
      border-color: var(--color-primary-200);
    }

    @media (prefers-reduced-motion: reduce) {
      .feature-card {
        transition: none;
      }
      .feature-card:hover {
        transform: none;
      }
    }

    .feature-icon {
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

    .feature-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2) 0;
    }

    .feature-description {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    @media (max-width: 1024px) {
      .features-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .features-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .features-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class FeaturesSectionComponent extends LandingCopyBase {



  /** Remplace `{count}` (rôles ou outils IA) par les constantes vérifiables. */
  /** `{count}`/`{rolesCount}` → rôles, `{toolsCount}` → outils IA. */
  protected fillCounts(text: string): string {
    return this.copy.format(text, {
      count: LANDING_FACTS.rolesCount,
      rolesCount: LANDING_FACTS.rolesCount,
      toolsCount: LANDING_FACTS.aiToolsCount
    });
  }
}
