import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import { LandingCtaComponent } from '../../shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * CTA final (plan A.4.21) : titre adapté à l'état d'ouverture, CTA d'audience Entreprise,
 * lien « j'ai déjà un compte » vers /auth/login.
 */
@Component({
  selector: 'app-cta-section',
  standalone: true,
  imports: [RouterModule, LandingCtaComponent, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cta-section" aria-labelledby="final-cta-title">
      <div class="cta-container">
        <div class="cta-content">
          <h2 id="final-cta-title" class="cta-title">{{ title() }}</h2>
          <p class="cta-description">
            <app-landing-rich [segments]="rich(t().home.finalCta.subtitle)" />
          </p>
          <div class="cta-buttons">
            <app-landing-cta audience="company" cssClass="cta-button-primary" />
            <a routerLink="/auth/login" class="cta-button-secondary">
              {{ t().home.finalCta.loginLink }}
            </a>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .cta-section {
      padding: var(--spacing-24) var(--spacing-6);
      background: linear-gradient(135deg, var(--color-primary-600) 0%, var(--color-primary-700) 50%, var(--color-primary-800) 100%);
      color: white;
      position: relative;
      overflow: hidden;
      z-index: 1;
    }

    .cta-section::before {
      content: '';
      position: absolute;
      top: -50%;
      inset-inline-end: -20%;
      width: 800px;
      height: 800px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      animation: pulse 15s ease-in-out infinite;
    }

    .cta-section::after {
      content: '';
      position: absolute;
      bottom: -50%;
      inset-inline-start: -20%;
      width: 700px;
      height: 700px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
      border-radius: 50%;
      animation: pulse 20s ease-in-out infinite reverse;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.2);
        opacity: 0.8;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .cta-section::before,
      .cta-section::after {
        animation: none;
      }
    }

    .cta-container {
      max-width: 800px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .cta-content {
      text-align: center;
    }

    .cta-title {
      font-size: clamp(1.875rem, 4vw, 2.75rem);
      font-weight: var(--font-weight-bold);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .cta-description {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: rgba(255, 255, 255, 0.85);
      margin: 0 0 var(--spacing-8) 0;
    }

    .cta-buttons {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--spacing-4);
      flex-wrap: wrap;
    }

    .cta-buttons ::ng-deep .landing-cta.cta-button-primary {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4) var(--spacing-8);
      background: white;
      color: var(--color-primary-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-bold);
      text-decoration: none;
      box-shadow: var(--shadow-lg);
      transition: transform var(--transition-normal), box-shadow var(--transition-normal);
    }

    .cta-buttons ::ng-deep .landing-cta.cta-button-primary:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-xl);
    }

    @media (prefers-reduced-motion: reduce) {
      .cta-buttons ::ng-deep .landing-cta.cta-button-primary {
        transition: none;
      }
      .cta-buttons ::ng-deep .landing-cta.cta-button-primary:hover {
        transform: none;
      }
    }

    .cta-buttons ::ng-deep .landing-cta.cta-button-primary:focus-visible,
    .cta-button-secondary:focus-visible {
      outline: 3px solid rgba(255, 255, 255, 0.9);
      outline-offset: 3px;
    }

    .cta-button-secondary {
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-4) var(--spacing-8);
      background: rgba(255, 255, 255, 0.12);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: var(--radius-full);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      text-decoration: none;
      transition: background var(--transition-normal);
    }

    .cta-button-secondary:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    @media (max-width: 768px) {
      .cta-section {
        padding: var(--spacing-16) var(--spacing-4);
      }

      .cta-buttons {
        flex-direction: column;
        align-items: stretch;
      }
    }
  `]
})
export class CtaSectionComponent extends LandingCopyBase {
  private readonly status = inject(PublicRegistrationStatusService);


  /** Titre adapté à l'état d'ouverture des inscriptions. */
  protected readonly title = computed(() => {
    const open = this.status.companyOpen() || this.status.firmOpen();
    return open ? this.t().home.finalCta.titleOpen : this.t().home.finalCta.titleClosed;
  });

  constructor() {
    super();
    this.status.ensureLoaded();
  }
}
