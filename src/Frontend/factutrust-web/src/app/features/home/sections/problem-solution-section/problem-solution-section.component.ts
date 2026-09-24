import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LandingCtaComponent } from '../../shared/landing-cta/landing-cta.component';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';

/**
 * « Le problème → la réponse » (plan A.4.6) : 3 irritants appariés à 3 réponses.
 * Textes : `t().home.problemSolution`. CTA dynamique vers l'inscription ou le formulaire.
 */
@Component({
  selector: 'app-problem-solution-section',
  standalone: true,
  imports: [LandingCtaComponent, LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="problem-solution-section">
      <div class="section-container">
        <div class="section-header">
          <h2 class="section-title">{{ t().home.problemSolution.title }}</h2>
        </div>

        <div class="pairs">
          @for (item of t().home.problemSolution.items; track item.problem) {
            <article class="pair">
              <div class="pair-problem">
                <i class="pi pi-times-circle" aria-hidden="true"></i>
                <p><app-landing-rich [segments]="rich(item.problem)" /></p>
              </div>
              <div class="pair-arrow" aria-hidden="true">
                <i class="pi pi-arrow-right"></i>
              </div>
              <div class="pair-answer">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                <p><app-landing-rich [segments]="rich(item.answer)" /></p>
              </div>
            </article>
          }
        </div>

        <div class="solution-cta">
          <app-landing-cta audience="company" cssClass="cta-button" />
        </div>
      </div>
    </section>
  `,
  styles: [`
    .problem-solution-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: rgba(255, 255, 255, 0.85);
      position: relative;
    }

    .section-container {
      max-width: 1080px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-12);
    }

    .section-title {
      font-size: clamp(1.875rem, 4vw, 2.5rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: var(--line-height-tight);
      margin: 0;
    }

    .pairs {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-5);
      margin-bottom: var(--spacing-12);
    }

    .pair {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: var(--spacing-4);
      align-items: stretch;
    }

    .pair-problem,
    .pair-answer {
      display: flex;
      gap: var(--spacing-3);
      align-items: flex-start;
      padding: var(--spacing-5);
      border-radius: var(--radius-xl);

      i {
        font-size: 1.25rem;
        flex-shrink: 0;
        margin-top: var(--spacing-1);
      }

      p {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        margin: 0;
      }
    }

    .pair-problem {
      background: var(--color-error-50);
      border: 1px solid var(--color-error-100);

      i {
        color: var(--color-error-600);
      }

      p {
        color: var(--color-neutral-700);
      }
    }

    .pair-answer {
      background: var(--color-success-50);
      border: 1px solid var(--color-success-100);

      i {
        color: var(--color-success-600);
      }

      p {
        color: var(--color-neutral-800);
      }
    }

    .pair-arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-primary-600);
      font-size: 1.25rem;
    }

    .solution-cta {
      text-align: center;
    }

    /* Bouton du CTA dynamique (le <a> est rendu par app-landing-cta). */
    .solution-cta ::ng-deep .landing-cta.cta-button {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-3);
      background: var(--color-primary-600);
      color: white;
      text-decoration: none;
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-base);
      padding: var(--spacing-4) var(--spacing-8);
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-md);
      transition: background var(--transition-normal), transform var(--transition-normal), box-shadow var(--transition-normal);
    }

    .solution-cta ::ng-deep .landing-cta.cta-button:hover {
      background: var(--color-primary-700);
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }

    .solution-cta ::ng-deep .landing-cta.cta-button:focus-visible {
      outline: 3px solid var(--color-primary-300);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .solution-cta ::ng-deep .landing-cta.cta-button {
        transition: none;
      }
      .solution-cta ::ng-deep .landing-cta.cta-button:hover {
        transform: none;
      }
    }

    @media (max-width: 900px) {
      .pair {
        grid-template-columns: 1fr;
        gap: var(--spacing-2);
      }

      .pair-arrow {
        transform: rotate(90deg);
        min-height: 1.5rem;
      }
    }

    @media (max-width: 768px) {
      .problem-solution-section {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class ProblemSolutionSectionComponent {
  private readonly copy = inject(LandingCopyService);

  protected readonly t = this.copy.t;

  protected rich(text: string) {
    return this.copy.rich(text);
  }
}
