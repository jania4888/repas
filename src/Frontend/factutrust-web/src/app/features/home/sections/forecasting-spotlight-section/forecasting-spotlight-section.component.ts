import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * Spotlight prévisions (plan A.4.10) : points clés + graphique SVG purement illustratif
 * (sans libellés chiffrés ; légende fournie par `chartCaption` / `illustrativeNote`).
 * Textes : `t().home.forecasting`.
 */
@Component({
  selector: 'app-forecasting-spotlight-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="forecasting" class="forecasting-section" tabindex="-1" aria-labelledby="forecasting-title">
      <div class="section-container">
        <div class="forecasting-grid">
          <div class="forecasting-visual" aria-hidden="true">
            <div class="chart-card">
              <svg class="chart-svg" viewBox="0 0 480 200" preserveAspectRatio="none" focusable="false">
                <defs>
                  <linearGradient id="forecast-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.4"></stop>
                    <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"></stop>
                  </linearGradient>
                  <linearGradient id="actual-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.5"></stop>
                    <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"></stop>
                  </linearGradient>
                </defs>

                <!-- Grille -->
                <line x1="0" y1="50" x2="480" y2="50" stroke="#e2e8f0" stroke-dasharray="4 4" stroke-width="1"></line>
                <line x1="0" y1="100" x2="480" y2="100" stroke="#e2e8f0" stroke-dasharray="4 4" stroke-width="1"></line>
                <line x1="0" y1="150" x2="480" y2="150" stroke="#e2e8f0" stroke-dasharray="4 4" stroke-width="1"></line>

                <!-- Aire réalisée -->
                <path d="M 0,150 L 60,140 L 120,120 L 180,110 L 240,90 L 240,200 L 0,200 Z" fill="url(#actual-gradient)"></path>
                <polyline points="0,150 60,140 120,120 180,110 240,90"
                          fill="none" stroke="#3b82f6" stroke-width="2.5"
                          stroke-linecap="round" stroke-linejoin="round"></polyline>

                <!-- Aire prévision -->
                <path d="M 240,90 L 300,75 L 360,60 L 420,50 L 480,35 L 480,200 L 240,200 Z" fill="url(#forecast-gradient)"></path>
                <polyline points="240,90 300,75 360,60 420,50 480,35"
                          fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="6 4"
                          stroke-linecap="round" stroke-linejoin="round"></polyline>

                <!-- Repère « aujourd'hui » -->
                <line x1="240" y1="20" x2="240" y2="180" stroke="#94a3b8" stroke-dasharray="3 3" stroke-width="1"></line>

                <!-- Points -->
                <circle cx="0" cy="150" r="4" fill="#3b82f6"></circle>
                <circle cx="60" cy="140" r="4" fill="#3b82f6"></circle>
                <circle cx="120" cy="120" r="4" fill="#3b82f6"></circle>
                <circle cx="180" cy="110" r="4" fill="#3b82f6"></circle>
                <circle cx="240" cy="90" r="6" fill="#3b82f6" stroke="white" stroke-width="2"></circle>
                <circle cx="300" cy="75" r="4" fill="#f59e0b"></circle>
                <circle cx="360" cy="60" r="4" fill="#f59e0b"></circle>
                <circle cx="420" cy="50" r="4" fill="#f59e0b"></circle>
                <circle cx="480" cy="35" r="6" fill="#f59e0b" stroke="white" stroke-width="2"></circle>
              </svg>
              <p class="chart-caption">{{ t().home.forecasting.chartCaption }}</p>
            </div>
            <p class="illustrative-note">{{ t().home.forecasting.illustrativeNote }}</p>
          </div>

          <div class="forecasting-content">
            <span class="eyebrow">
              <i class="pi pi-chart-line" aria-hidden="true"></i>
              {{ t().home.forecasting.kicker }}
            </span>
            <h2 id="forecasting-title" class="forecasting-title">{{ t().home.forecasting.title }}</h2>
            <p class="forecasting-description">
              <app-landing-rich [segments]="rich(t().home.forecasting.subtitle)" />
            </p>

            <ul class="features-list">
              @for (point of t().home.forecasting.points; track point) {
                <li>
                  <i class="pi pi-check-circle" aria-hidden="true"></i>
                  <span><app-landing-rich [segments]="rich(point)" /></span>
                </li>
              }
            </ul>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .forecasting-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: linear-gradient(180deg, #fffbeb 0%, white 100%);
      position: relative;
    }

    .forecasting-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 1280px;
      margin: 0 auto;
    }

    .forecasting-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-12);
      align-items: center;
    }

    .forecasting-visual {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .chart-card {
      background: white;
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      box-shadow: 0 12px 40px rgba(245, 158, 11, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04);
      border: 1px solid #fde68a;
    }

    .chart-svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .chart-caption {
      margin: var(--spacing-3) 0 0 0;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-500);
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .illustrative-note {
      margin: 0;
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      text-align: center;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      background: #fef3c7;
      color: #b45309;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: var(--spacing-4);
    }

    .forecasting-title {
      font-size: clamp(1.875rem, 4vw, 2.5rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .forecasting-description {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0 0 var(--spacing-8) 0;
    }

    .features-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);

      li {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-3);
        font-size: var(--font-size-base);
        color: var(--color-neutral-700);
        line-height: var(--line-height-relaxed);

        i {
          color: var(--color-success-600);
          font-size: 1.15rem;
          margin-top: 0.15rem;
          flex-shrink: 0;
        }
      }
    }

    @media (max-width: 1024px) {
      .forecasting-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .forecasting-section {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class ForecastingSpotlightSectionComponent extends LandingCopyBase {


}
