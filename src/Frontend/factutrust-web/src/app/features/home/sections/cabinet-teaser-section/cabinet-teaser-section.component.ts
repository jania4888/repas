import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { cabinetsPath } from '../../i18n/landing-locale.util';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * Teaser « version Cabinet comptable » sur l'accueil (plan TB4, maquette cabinet-teaser-variant-a) :
 * bandeau navy sombre entre #nouveautes et #tarifs. Textes : `t().home.cabinetTeaser`.
 */
@Component({
  selector: 'app-cabinet-teaser-section',
  standalone: true,
  imports: [RouterModule, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="cabinets" class="cabinet-teaser" tabindex="-1" aria-labelledby="cabinet-teaser-title">
      <div class="teaser-blob" aria-hidden="true"></div>
      <div class="section-container teaser-layout">
        <div class="teaser-content">
          <p class="teaser-kicker">{{ t().home.cabinetTeaser.kicker }}</p>
          <h2 id="cabinet-teaser-title" class="teaser-title">{{ t().home.cabinetTeaser.title }}</h2>
          <p class="teaser-lead">
            <app-landing-rich [segments]="rich(t().home.cabinetTeaser.subtitle)" />
          </p>
          <ul class="check-list">
            @for (bullet of t().home.cabinetTeaser.bullets; track bullet) {
              <li>
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                <span><app-landing-rich [segments]="rich(bullet)" /></span>
              </li>
            }
          </ul>
        </div>

        <div class="teaser-cta-box">
          <a class="teaser-cta" [routerLink]="cabinetsUrl()">
            {{ t().home.cabinetTeaser.cta }}
            <i class="pi pi-arrow-right" aria-hidden="true"></i>
          </a>
          <a class="teaser-demo-link" [routerLink]="cabinetsUrl()" [queryParams]="{ objet: 'demo-cabinet' }" fragment="contact">
            {{ t().home.cabinetTeaser.demoLink }}
            <i class="pi pi-arrow-right" aria-hidden="true"></i>
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .cabinet-teaser {
      position: relative;
      overflow: hidden;
      background: linear-gradient(120deg, #0f172a 0%, #1e3a8a 100%);
      color: var(--color-neutral-300);
      padding: var(--spacing-20) var(--spacing-6);
    }

    .cabinet-teaser:focus {
      outline: none;
    }

    .teaser-blob {
      position: absolute;
      inset-block-start: -10rem;
      inset-inline-end: -12rem;
      width: 36rem;
      height: 30rem;
      border-radius: 48% 52% 55% 45% / 55% 45% 55% 45%;
      background: linear-gradient(105deg, rgba(91, 104, 235, 1) 0%, rgba(40, 225, 253, 1) 100%);
      opacity: 0.28;
      filter: blur(10px);
      pointer-events: none;
    }

    .section-container {
      max-width: 1200px;
      margin: 0 auto;
      position: relative;
    }

    .teaser-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr);
      gap: var(--spacing-16, 4rem);
      align-items: center;
    }

    .teaser-kicker {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-3);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7dd3fc;
      margin: 0 0 var(--spacing-4) 0;
    }

    .teaser-kicker::before {
      content: '';
      width: 1.75rem;
      height: 0.25rem;
      border-radius: var(--radius-full);
      background: linear-gradient(105deg, rgba(91, 104, 235, 1) 0%, rgba(40, 225, 253, 1) 100%);
    }

    .teaser-title {
      color: white;
      font-size: clamp(1.875rem, 3.2vw, 2.75rem);
      font-weight: var(--font-weight-bold);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .teaser-lead {
      color: var(--color-neutral-200);
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      max-width: 36rem;
      margin: 0;
    }

    .check-list {
      list-style: none;
      padding: 0;
      margin: var(--spacing-6) 0 0 0;
      display: grid;
      gap: var(--spacing-3);

      li {
        display: flex;
        gap: var(--spacing-3);
        align-items: flex-start;
        color: white;
        font-weight: var(--font-weight-medium);
        line-height: var(--line-height-relaxed);

        i {
          color: #4ade80;
          margin-top: 0.2rem;
          flex-shrink: 0;
        }
      }
    }

    .teaser-cta-box {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      display: grid;
      gap: var(--spacing-4);
      justify-items: start;
    }

    .teaser-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      width: 100%;
      padding: var(--spacing-3) var(--spacing-6);
      background: white;
      color: var(--color-neutral-900);
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-base);
      border-radius: var(--radius-full);
      text-decoration: none;
      transition: background var(--transition-normal), color var(--transition-normal);
    }

    .teaser-cta:hover {
      background: var(--color-primary-50);
      color: var(--color-primary-900);
    }

    .teaser-cta:focus-visible {
      outline: 3px solid #7dd3fc;
      outline-offset: 2px;
    }

    .teaser-demo-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      color: #bae6fd;
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-sm);
      text-decoration: none;
    }

    .teaser-demo-link:hover {
      text-decoration: underline;
    }

    .teaser-demo-link:focus-visible {
      outline: 3px solid #7dd3fc;
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }

    @media (max-width: 992px) {
      .teaser-layout {
        grid-template-columns: 1fr;
        gap: var(--spacing-10);
      }

      .teaser-blob {
        width: 24rem;
        height: 20rem;
        inset-inline-end: -10rem;
      }
    }

    @media (max-width: 640px) {
      .cabinet-teaser {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class CabinetTeaserSectionComponent extends LandingCopyBase {
  private readonly localeService = inject(LandingLocaleService);

  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));

}
