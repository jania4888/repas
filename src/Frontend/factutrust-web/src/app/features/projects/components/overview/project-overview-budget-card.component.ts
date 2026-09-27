import { Component, EventEmitter, Input, Output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { ProjectBudget, ProjectDetail } from '../../project-api.service';
import { budgetUsedPercent, buildBudgetDonutSlices } from '../../project-detail.vm';

@Component({
  selector: 'app-project-overview-budget-card',
  standalone: true,
  imports: [CommonModule, ChartModule],
  template: `
    @if (project) {
      <section class="proj-detail-card">
        <h3 class="proj-detail-card__title" i18n="@@projects.components.budget.du.projet.0be885e3">Budget du projet</h3>
        @if (budget && budget.budgetHt > 0) {
          <div class="proj-detail-budget">
            <div class="proj-detail-budget__chart">
              <p-chart type="doughnut" [data]="chartData()" [options]="chartOptions" [style]="{ height: '180px' }" />
              <div class="proj-detail-budget__center" aria-hidden="true">
                <strong>{{ usedPercent }} %</strong>
                <span i18n="@@projects.components.consomme.a30080c3">Consommé</span>
              </div>
            </div>
            <ul class="proj-detail-budget__legend">
              <li i18n="@@projects.components.budget.total.57d6a2c9"><span class="dot" style="background:#2563eb"></span> Budget total <strong>{{ budget.budgetHt | number:'1.3-3' }} {{ project.currency }}</strong></li>
              <li i18n="@@projects.components.couts.realises.0f4b76be"><span class="dot" style="background:#7c3aed"></span> Coûts réalisés <strong>{{ budget.actualCostHt | number:'1.3-3' }}</strong></li>
              <li i18n="@@projects.components.cout.temps.28111c8c"><span class="dot" style="background:#d97706"></span> Coût temps <strong>{{ budget.timeCostHt | number:'1.3-3' }}</strong></li>
              <li i18n="@@projects.components.reste.c5822c3d"><span class="dot" style="background:#e2e8f0"></span> Reste <strong>{{ budget.remainingHt | number:'1.3-3' }}</strong></li>
            </ul>
          </div>
          <button type="button" class="proj-detail-link" (click)="viewBudget.emit()" i18n="@@projects.components.voir.le.detail.du.budget.52c64769">Voir le détail du budget →</button>
        } @else {
          <p class="proj-detail-card__desc proj-detail-card__desc--muted">
            <ng-container i18n="@@projects.components.budget.ht.0de1b507"> Budget HT : </ng-container> <strong>{{ project.budgetHt | number:'1.3-3' }} {{ project.currency }}</strong>
          </p>
        }
      </section>
    }
  `
})
export class ProjectOverviewBudgetCardComponent {
  @Input() project: ProjectDetail | null = null;
  @Input() budget: ProjectBudget | null = null;
  @Output() viewBudget = new EventEmitter<void>();

  readonly chartOptions = {
    cutout: '72%',
    plugins: { legend: { display: false } },
    maintainAspectRatio: false
  };

  get usedPercent(): number {
    return budgetUsedPercent(this.budget, this.project?.budgetHt ?? 0);
  }

  readonly chartData = computed(() => {
    const b = this.budget;
    if (!b || b.budgetHt <= 0) {
      return { labels: [], datasets: [{ data: [] }] };
    }
    const slices = buildBudgetDonutSlices(b, this.project?.currency ?? 'TND');
    const consumed = Math.max(0, b.actualCostHt);
    const remainder = Math.max(0, b.budgetHt - consumed);
    return {
      labels: ['Consommé', 'Reste'],
      datasets: [{
        data: [consumed, remainder],
        backgroundColor: ['#2563eb', '#e2e8f0'],
        borderWidth: 0
      }]
    };
  });
}
