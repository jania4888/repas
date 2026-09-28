import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ProjectDashboardExtended } from '../project-api.service';
import { ProjectListProgressRingComponent } from './project-list-progress-ring.component';

@Component({
  selector: 'app-project-list-kpi-row',
  standalone: true,
  imports: [CommonModule, StatCardComponent, ProjectListProgressRingComponent],
  template: `
    @if (extended) {
      <div class="proj-list-kpi-row">
        <app-stat-card
          label="Projets actifs" i18n-label="@@projects.components.projets.actifs.9a6cf9d6"
          [value]="String(extended.activeProjects)"
          icon="fa-solid fa-folder-open"
          variant="primary"
          tone="primary"
          appearance="default"
          [change]="extended.kpiTrends?.activeProjectsChangePercent ?? undefined"
          changeSuffix="vs mois dernier" />
        <app-stat-card
          label="Tâches ouvertes" i18n-label="@@projects.components.taches.ouvertes.639d6d23"
          [value]="String(extended.openTasks)"
          icon="fa-solid fa-list-check"
          variant="success"
          tone="emerald"
          appearance="default"
          [change]="extended.kpiTrends?.openTasksChangePercent ?? undefined"
          changeSuffix="vs mois dernier"
          [sparkline]="pendingSparkline()" />
        <app-stat-card
          label="En retard" i18n-label="@@projects.components.en.retard.40c1dde3"
          [value]="String(extended.overdueTasks)"
          icon="fa-solid fa-clock"
          [variant]="extended.overdueTasks > 0 ? 'error' : 'success'"
          [tone]="extended.overdueTasks > 0 ? 'rose' : 'emerald'"
          appearance="default"
          [change]="extended.kpiTrends?.overdueTasksChangePercent ?? undefined"
          changeSuffix="vs mois dernier"
          [sparkline]="overdueSparkline()"
          [clickable]="true"
          navigationAriaLabel="Filtrer les projets avec tâches en retard" i18n-navigationAriaLabel="@@projects.project-list-kpi-row.filtrer.les.projets.avec.taches.en.retar.de3b67e9"
          (cardClick)="overdueFilter.emit()" />
        <app-stat-card
          label="Heures à facturer" i18n-label="@@projects.components.heures.a.facturer.7757d0a3"
          [value]="(extended.uninvoicedBillableHours | number:'1.0-1') + ' h'"
          icon="fa-solid fa-hourglass-half"
          variant="warning"
          tone="violet"
          appearance="default"
          [change]="extended.kpiTrends?.uninvoicedBillableHoursChangePercent ?? undefined"
          changeSuffix="vs mois dernier" />
        <app-stat-card
          label="Avancement moyen" i18n-label="@@projects.components.avancement.moyen.06267bd4"
          [value]="extended.averageProgressPercent + ' %'"
          icon="fa-solid fa-chart-pie"
          variant="primary"
          tone="cyan"
          appearance="default"
          [change]="extended.kpiTrends?.averageProgressChangePercent ?? undefined"
          changeSuffix="vs mois dernier">
          <app-project-list-progress-ring [value]="extended.averageProgressPercent" />
        </app-stat-card>
      </div>
    } @else if (basic) {
      <div class="proj-list-kpi-row proj-list-kpi-row--fallback">
        <app-stat-card label="Projets actifs" i18n-label="@@projects.components.projets.actifs.9a6cf9d6" [value]="String(basic.activeProjects)" icon="fa-solid fa-folder-open" variant="primary" tone="primary" />
        <app-stat-card label="Tâches ouvertes" i18n-label="@@projects.components.taches.ouvertes.639d6d23" [value]="String(basic.openTasks)" icon="fa-solid fa-list-check" variant="success" tone="emerald" />
        <app-stat-card
          label="En retard" i18n-label="@@projects.components.en.retard.40c1dde3"
          [value]="String(basic.overdueTasks)"
          icon="fa-solid fa-clock"
          [variant]="basic.overdueTasks > 0 ? 'error' : 'success'"
          [tone]="basic.overdueTasks > 0 ? 'rose' : 'emerald'" />
        <app-stat-card
          label="Heures à facturer" i18n-label="@@projects.components.heures.a.facturer.7757d0a3"
          [value]="(basic.uninvoicedBillableHours | number:'1.0-1') + ' h'"
          icon="fa-solid fa-hourglass-half"
          variant="warning"
          tone="violet" />
      </div>
    }
  `
})
export class ProjectListKpiRowComponent {
  @Input() extended: ProjectDashboardExtended | null = null;
  @Input() basic: { activeProjects: number; openTasks: number; overdueTasks: number; uninvoicedBillableHours: number } | null = null;
  @Output() overdueFilter = new EventEmitter<void>();

  readonly String = String;

  pendingSparkline(): number[] | null {
    const trend = this.extended?.taskTrend;
    if (!trend?.length || trend.length < 2) return null;
    return trend.map(p => p.pending);
  }

  overdueSparkline(): number[] | null {
    const trend = this.extended?.taskTrend;
    if (!trend?.length || trend.length < 2) return null;
    return trend.map(p => p.overdue);
  }
}
