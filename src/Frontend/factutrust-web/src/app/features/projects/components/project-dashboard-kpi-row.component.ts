import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ProjectDashboardExtended } from '../project-api.service';

@Component({
  selector: 'app-project-dashboard-kpi-row',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule, StatCardComponent],
  template: `
    @if (data) {
      <div class="proj-dash-kpi-header">
        <span class="proj-dash-kpi-header__label" i18n="@@projects.components.indicateurs.cles.ad2f0ef9">Indicateurs clés</span>
        <p-select
          [options]="periodOptions"
          [ngModel]="period"
          (ngModelChange)="periodChange.emit($event)"
          optionLabel="label"
          optionValue="value"
          styleClass="proj-dash-period-select" />
      </div>
      <div class="proj-dash-kpi-row">
        <app-stat-card
          label="Projets actifs" i18n-label="@@projects.components.projets.actifs.9a6cf9d6"
          [value]="String(data.activeProjects)"
          icon="fa-solid fa-briefcase"
          variant="primary"
          tone="primary"
          appearance="solid"
          [change]="data.kpiTrends?.activeProjectsChangePercent ?? undefined"
          routerLink="/projects"
          [queryParams]="{ status: 'Active' }"
          navigationAriaLabel="Voir les projets actifs" />
        <app-stat-card
          label="Tâches en cours" i18n-label="@@projects.components.taches.en.cours.fde40a7b"
          [value]="String(data.openTasks)"
          icon="fa-solid fa-list-check"
          variant="primary"
          tone="cyan"
          appearance="solid"
          [change]="data.kpiTrends?.openTasksChangePercent ?? undefined"
          routerLink="/projects"
          navigationAriaLabel="Voir les projets" />
        <app-stat-card
          label="Tâches terminées" i18n-label="@@projects.components.taches.terminees.f6a3e341"
          [value]="String(data.completedTasks)"
          icon="fa-solid fa-circle-check"
          variant="success"
          tone="emerald"
          appearance="solid"
          [change]="data.kpiTrends?.completedTasksChangePercent ?? undefined"
          routerLink="/projects"
          navigationAriaLabel="Voir les projets" />
        <app-stat-card
          label="En retard" i18n-label="@@projects.components.en.retard.40c1dde3"
          [value]="String(data.overdueTasks)"
          icon="fa-solid fa-clock"
          [variant]="data.overdueTasks > 0 ? 'error' : 'success'"
          [tone]="data.overdueTasks > 0 ? 'rose' : 'emerald'"
          appearance="solid"
          [change]="data.kpiTrends?.overdueTasksChangePercent ?? undefined"
          routerLink="/projects"
          navigationAriaLabel="Voir les projets avec tâches en retard" />
        <app-stat-card
          label="Heures à facturer" i18n-label="@@projects.components.heures.a.facturer.7757d0a3"
          [value]="(data.uninvoicedBillableHours | number:'1.0-1') + ' h'"
          icon="fa-solid fa-hourglass-half"
          variant="warning"
          tone="amber"
          appearance="solid"
          routerLink="/projects/time"
          navigationAriaLabel="Voir le suivi du temps" />
      </div>
    }
  `
})
export class ProjectDashboardKpiRowComponent {
  readonly periodOptions = [
    { label: $localize`:@@projects.project-dashboard-kpi-row.ts.cette.semaine.af7dc0a9:Cette semaine`, value: 'week' as const },
    { label: $localize`:@@projects.project-dashboard-kpi-row.ts.ce.mois.db74c560:Ce mois`, value: 'month' as const }
  ];

  @Input() data: ProjectDashboardExtended | null = null;
  @Input() period: 'week' | 'month' = 'week';
  @Output() periodChange = new EventEmitter<'week' | 'month'>();

  readonly String = String;
}
