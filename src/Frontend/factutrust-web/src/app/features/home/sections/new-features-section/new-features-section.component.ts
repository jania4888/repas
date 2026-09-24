import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';

/**
 * Section « Nouveautés » (plan A.5.10, maquette home-nouveautes-variant-b) :
 * 13 modules livrés récemment, chacun localisé « dans l'app ». Textes : `t().home.newFeatures`.
 * Les icônes restent dans le composant (visuel, indexé par position dans la liste).
 */
@Component({
  selector: 'app-new-features-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="nouveautes" class="new-features-section" tabindex="-1" aria-labelledby="nouveautes-title">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ format(t().home.newFeatures.kicker, { year: currentYear }) }}</span>
          <h2 id="nouveautes-title" class="section-title">{{ t().home.newFeatures.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.newFeatures.subtitle)" />
          </p>
        </div>

        <div class="news-grid">
          @for (item of t().home.newFeatures.items; track item.title; let i = $index) {
            <article class="news-card" [class.news-card-featured]="i === 0">
              <div class="card-icon" aria-hidden="true">
                <i [class]="'pi ' + icons[i % icons.length]"></i>
              </div>
              <h3 class="card-title">{{ item.title }}</h3>
              <p class="card-text">
                <app-landing-rich [segments]="rich(item.text)" />
              </p>
              <p class="card-location">
                <i class="pi pi-map-marker" aria-hidden="true"></i>
                <span class="sr-only">{{ t().home.newFeatures.inAppLabel }} : </span>
                <span>{{ item.location }}</span>
              </p>
            </article>
          }
        </div>

        <p class="news-note">
          <app-landing-rich [segments]="rich(t().home.newFeatures.footnote)" />
        </p>
      </div>
    </section>
  `,
  styles: [`
    .new-features-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: var(--color-neutral-50);
    }

    .new-features-section:focus {
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

    .news-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--spacing-6);
    }

    .news-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--transition-normal), transform var(--transition-normal), border-color var(--transition-normal);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .news-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
      border-color: var(--color-primary-200);
    }

    @media (prefers-reduced-motion: reduce) {
      .news-card {
        transition: none;
      }
      .news-card:hover {
        transform: none;
      }
    }

    .news-card-featured {
      grid-column: span 2;
      background: linear-gradient(135deg, white 0%, var(--color-primary-50) 100%);
      border-color: var(--color-primary-200);
    }

    .news-card-featured .card-icon {
      background: linear-gradient(105deg, var(--color-primary-500) 0%, var(--color-primary-400) 100%);
      color: white;
      box-shadow: var(--shadow-md);
    }

    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-xl);
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      display: inline-flex;
      align-items: center;
      justify-content: center;

      i {
        font-size: 1.35rem;
      }
    }

    .card-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      line-height: var(--line-height-tight);
      color: var(--color-neutral-900);
      margin: 0;
    }

    .card-text {
      color: var(--color-neutral-600);
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      margin: 0;
      flex: 1;
    }

    .card-location {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: var(--spacing-1) 0 0 0;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-500);

      i {
        color: var(--color-primary-500);
        font-size: 0.85rem;
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

    .news-note {
      margin: var(--spacing-6) auto 0;
      max-width: 720px;
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      text-align: center;
      line-height: var(--line-height-relaxed);
    }

    @media (max-width: 1024px) {
      .news-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .new-features-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .news-grid {
        grid-template-columns: 1fr;
      }

      .news-card-featured {
        grid-column: span 1;
      }
    }
  `]
})
export class NewFeaturesSectionComponent {
  private readonly copy = inject(LandingCopyService);

  protected readonly t = this.copy.t;
  protected readonly currentYear = new Date().getFullYear();

  /** Icônes PrimeIcons par position (visuel uniquement, pas de texte). */
  protected readonly icons = [
    'pi-id-card',
    'pi-building',
    'pi-book',
    'pi-calendar-clock',
    'pi-replay',
    'pi-clock',
    'pi-shopping-bag',
    'pi-tag',
    'pi-globe',
    'pi-bolt',
    'pi-shield',
    'pi-arrow-right-arrow-left',
    'pi-building-columns'
  ] as const;

  protected rich(text: string) {
    return this.copy.rich(text);
  }

  protected format(template: string, params: Record<string, string | number>): string {
    return this.copy.format(template, params);
  }
}
