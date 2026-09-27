import { Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ProgressBarModule } from 'primeng/progressbar';
import { ProjectBudget, ProjectDetail, ProjectTask } from '../project-api.service';
import {
  budgetUsedPercent,
  computeBillableHoursDenominator,
  computeProjectHealth,
  computeTaskProgressPercent,
  countOpenTasks,
  countOverdueTasks,
  countTotalTasksForProgress,
  formatPeriodSubtext
} from '../project-detail.vm';

@Component({
  selector: 'app-project-detail-kpi-strip',
  standalone: true,
  imports: [CommonModule, DatePipe, ProgressBarModule],
  template: `
    @if (project) {
      <div class="proj-detail-kpi-strip">
        <div class="proj-detail-kpi-card">
          <span class="proj-detail-kpi-icon"><i class="pi pi-calendar"></i></span>
          <div>
            <span class="proj-detail-kpi-label" i18n="@@projects.components.periode.de2110b7">Période</span>
            <strong class="proj-detail-kpi-value proj-detail-kpi-value--sm">
              {{ project.startDate ? (project.startDate | date:'shortDate') : '—' }}
              → {{ project.endDate ? (project.endDate | date:'shortDate') : '—' }}
            </strong>
            @if (periodSubtext) {
              <span class="proj-detail-kpi-sub">{{ periodSubtext }}</span>
            }
          </div>
        </div>

        <div class="proj-detail-kpi-card">
          <span class="proj-detail-kpi-icon"><i class="pi pi-wallet"></i></span>
          <div class="proj-detail-kpi-grow">
            <span class="proj-detail-kpi-label" i18n="@@projects.components.budget.total.b930ffdc">Budget total</span>
            <strong class="proj-detail-kpi-value">
              {{ (budget?.budgetHt ?? project.budgetHt) | number:'1.3-3' }} {{ project.currency }}
            </strong>
            @if (usedPercent > 0 || (budget?.budgetHt ?? project.budgetHt) > 0) {
              <p-progressBar [value]="usedPercent" [showValue]="false" styleClass="proj-detail-kpi-bar" />
              <span class="proj-detail-kpi-sub">{{ usedPercent }} % consommé</span>
            }
          </div>
        </div>

        <div class="proj-detail-kpi-card">
          <span class="proj-detail-kpi-icon"><i class="pi pi-clock"></i></span>
          <div>
            <span class="proj-detail-kpi-label" i18n="@@projects.components.heures.a.facturer.7757d0a3">Heures à facturer</span>
            <strong class="proj-detail-kpi-value">
              {{ budget?.billableUninvoicedHours ?? 0 | number:'1.0-1' }} / {{ hoursDenominator | number:'1.0-1' }} h
            </strong>
          </div>
        </div>

        <div class="proj-detail-kpi-card">
          <span class="proj-detail-kpi-icon"><i class="pi pi-check-square"></i></span>
          <div>
            <span class="proj-detail-kpi-label" i18n="@@projects.components.taches.ouvertes.639d6d23">Tâches ouvertes</span>
            <strong class="proj-detail-kpi-value">{{ openCount }} / {{ totalCount }}</strong>
          </div>
        </div>

        <div class="proj-detail-kpi-card" [class.proj-detail-kpi-card--danger]="overdueCount > 0">
          <span class="proj-detail-kpi-icon"><i class="pi pi-exclamation-triangle"></i></span>
          <div>
            <span class="proj-detail-kpi-label" i18n="@@projects.components.en.retard.40c1dde3">En retard</span>
            <strong class="proj-detail-kpi-value">{{ overdueCount }}</strong>
          </div>
        </div>

        <div class="proj-detail-kpi-card proj-detail-kpi-card--gauge">
          <span class="proj-detail-kpi-label" i18n="@@projects.components.avancement.global.5f0ee62d">Avancement global</span>
          <div class="proj-detail-gauge" [style.background]="gaugeBackground">
            <div class="proj-detail-gauge__inner">
              <strong>{{ progressPercent }} %</strong>
              <span [class]="loc_ui_tern_proj_detail_health_proj_detail_health_990a19 + health.tone">{{ health.text }}</span>
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class ProjectDetailKpiStripComponent {
  readonly loc_ui_tern_proj_detail_health_proj_detail_health_990a19 = "proj-detail-health proj-detail-health--";
  @Input() project: ProjectDetail | null = null;
  @Input() budget: ProjectBudget | null = null;
  @Input() tasks: ProjectTask[] = [];

  get periodSubtext(): string | null {
    return formatPeriodSubtext(this.project?.endDate);
  }

  get usedPercent(): number {
    return budgetUsedPercent(this.budget, this.project?.budgetHt ?? 0);
  }

  get hoursDenominator(): number {
    return computeBillableHoursDenominator(this.tasks, this.budget?.loggedHours ?? 0);
  }

  get openCount(): number {
    return countOpenTasks(this.tasks);
  }

  get totalCount(): number {
    return countTotalTasksForProgress(this.tasks);
  }

  get overdueCount(): number {
    return countOverdueTasks(this.tasks);
  }

  get progressPercent(): number {
    return computeTaskProgressPercent(this.tasks);
  }

  get health() {
    return computeProjectHealth(this.tasks, this.project);
  }

  get gaugeBackground(): string {
    const pct = this.progressPercent;
    return `conic-gradient(var(--color-primary-500, #3b82f6) ${pct * 3.6}deg, var(--surface-ground, #f1f5f9) 0)`;
  }
}
