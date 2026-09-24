import { Component, AfterViewInit, ElementRef, ViewChild, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { LandingCopyService } from '../../content/landing-copy.service';
import { LANDING_FACTS } from '../../content/landing-facts';

interface StatItem {
  value: number;
  suffix: string;
  label: string;
}

/**
 * Bandeau de chiffres (plan A.4.16) : valeurs depuis `landing-facts.ts` (jamais en dur),
 * libellés depuis `t().home.stats`. Compteurs animés à l'entrée dans le viewport
 * (désactivés si prefers-reduced-motion).
 */
@Component({
  selector: 'app-stats-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="stats-section">
      <div class="stats-container" #statsContainer>
        <div class="stats-grid">
          @for (stat of stats(); track stat.label) {
            <div class="stat-item">
              <div class="stat-number" dir="ltr" [attr.data-count]="stat.value" [attr.data-suffix]="stat.suffix">0{{ stat.suffix }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .stats-section {
      padding: var(--spacing-16) var(--spacing-6);
      background: linear-gradient(135deg, var(--color-primary-700) 0%, var(--color-primary-800) 100%);
      color: white;
      position: relative;
      overflow: hidden;
    }

    .stats-section::before {
      content: '';
      position: absolute;
      top: -50%;
      inset-inline-end: -10%;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .stats-section::after {
      content: '';
      position: absolute;
      bottom: -50%;
      inset-inline-start: -10%;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.06) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .stats-container {
      max-width: 1280px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--spacing-8);
      text-align: center;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
    }

    .stat-number {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: var(--font-weight-bold);
      line-height: 1;
      color: white;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .stat-label {
      font-size: var(--font-size-base);
      color: rgba(255, 255, 255, 0.9);
      font-weight: var(--font-weight-medium);
    }

    @media (max-width: 1024px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-12);
      }
    }

    @media (max-width: 768px) {
      .stats-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .stats-grid {
        grid-template-columns: 1fr;
        gap: var(--spacing-8);
      }
    }
  `]
})
export class StatsSectionComponent implements AfterViewInit {
  private readonly copy = inject(LandingCopyService);

  @ViewChild('statsContainer') statsContainer?: ElementRef<HTMLElement>;
  private countersAnimated = false;

  protected readonly stats = computed<StatItem[]>(() => {
    const labels = this.copy.t().home.stats;
    return [
      { value: LANDING_FACTS.modulesCount, suffix: '', label: labels.modules },
      { value: LANDING_FACTS.rolesCount, suffix: '', label: labels.roles },
      { value: LANDING_FACTS.aiToolsCount, suffix: LANDING_FACTS.aiToolsSuffix, label: labels.aiTools },
      { value: 1, suffix: '', label: labels.dedicatedDb }
    ];
  });

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.setupCounterAnimation();
  }

  private setupCounterAnimation(): void {
    if (!this.statsContainer) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setFinalValues();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.countersAnimated) {
          this.animateCounters();
          this.countersAnimated = true;
          observer.disconnect();
        }
      });
    }, { threshold: 0.4 });
    observer.observe(this.statsContainer.nativeElement);
  }

  private animateCounters(): void {
    const counters = this.statsContainer?.nativeElement.querySelectorAll<HTMLElement>('.stat-number');
    if (!counters) return;

    counters.forEach(counter => {
      const target = parseInt(counter.getAttribute('data-count') || '0', 10);
      const suffix = counter.getAttribute('data-suffix') || '';
      const duration = 1800;
      const step = target / (duration / 16);
      let current = 0;

      const updateCounter = () => {
        current += step;
        if (current < target) {
          counter.textContent = Math.floor(current).toString() + suffix;
          requestAnimationFrame(updateCounter);
        } else {
          counter.textContent = target.toString() + suffix;
        }
      };

      updateCounter();
    });
  }

  private setFinalValues(): void {
    const counters = this.statsContainer?.nativeElement.querySelectorAll<HTMLElement>('.stat-number');
    counters?.forEach(counter => {
      counter.textContent = (counter.getAttribute('data-count') || '0') + (counter.getAttribute('data-suffix') || '');
    });
  }
}
