import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * Intégrations (plan A.4.18) : 8 canaux/formats réellement disponibles.
 * Textes : `t().home.integrations`.
 */
@Component({
  selector: 'app-integrations-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="integrations" class="integrations-section" tabindex="-1" aria-labelledby="integrations-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ t().home.integrations.kicker }}</span>
          <h2 id="integrations-title" class="section-title">{{ t().home.integrations.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.integrations.subtitle)" />
          </p>
        </div>

        <div class="integrations-grid">
          @for (item of t().home.integrations.items; track item.title) {
            <article class="integration-card">
              <div class="item-icon" aria-hidden="true">
                <i [class]="'pi ' + item.icon"></i>
              </div>
              <h3 class="item-title">{{ item.title }}</h3>
              <p class="item-text">
                <app-landing-rich [segments]="rich(item.text)" />
              </p>
            </article>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .integrations-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: white;
    }

    .integrations-section:focus {
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

    .integrations-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--spacing-5);
    }

    .integration-card {
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal), border-color var(--transition-normal);
    }

    .integration-card:hover {
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
      border-color: var(--color-primary-200);
    }

    @media (prefers-reduced-motion: reduce) {
      .integration-card {
        transition: none;
      }
      .integration-card:hover {
        transform: none;
      }
    }

    .item-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: white;
      border: 1px solid var(--color-neutral-200);
      color: var(--color-primary-600);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--spacing-3);

      i {
        font-size: 1.2rem;
      }
    }

    .item-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-1) 0;
    }

    .item-text {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    @media (max-width: 1024px) {
      .integrations-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .integrations-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .integrations-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class IntegrationsSectionComponent extends LandingCopyBase {


}
