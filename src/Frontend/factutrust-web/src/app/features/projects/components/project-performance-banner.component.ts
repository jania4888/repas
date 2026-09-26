import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectPerformanceSummary } from '../project-api.service';

@Component({
  selector: 'app-project-performance-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (summary) {
      <section class="proj-dash-performance" aria-label="Résumé de performance" i18n-aria-label="Résumé de performance">
        <div class="proj-dash-performance__content">
          <div class="proj-dash-performance__title-row">
            <i class="fa-solid fa-trophy proj-dash-performance__icon" aria-hidden="true"></i>
            <h3 class="proj-dash-performance__title">{{ summary.title }}</h3>
          </div>
          <div class="proj-dash-performance__stats">
            @for (s of summary.stats; track s.label) {
              <div class="proj-dash-performance__stat">
                <i
                  class="fa-solid"
                  [class.fa-arrow-trend-up]="s.isPositive"
                  [class.fa-arrow-trend-down]="!s.isPositive"
                  aria-hidden="true"></i>
                <span [class.positive]="s.isPositive" [class.negative]="!s.isPositive">
                  {{ s.isPositive ? '+' : '−' }}{{ s.changePercent }} %
                </span>
                <span>{{ s.label }}</span>
              </div>
            }
          </div>
        </div>
        <div class="proj-dash-performance__illus" aria-hidden="true">
          <i class="fa-solid fa-chart-column"></i>
        </div>
      </section>
    }
  `
})
export class ProjectPerformanceBannerComponent {
  @Input() summary: ProjectPerformanceSummary | null | undefined = null;
}
