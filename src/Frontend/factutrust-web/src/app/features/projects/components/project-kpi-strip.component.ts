import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectDashboard } from '../project-api.service';

@Component({
  selector: 'app-project-kpi-strip',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (data) {
      <div class="proj-kpi-grid">
        <div class="proj-kpi-card">
          <span class="proj-kpi-label" i18n="@@projects.components.projets.actifs.9a6cf9d6">Projets actifs</span>
          <strong class="proj-kpi-value">{{ data.activeProjects }}</strong>
        </div>
        <div class="proj-kpi-card">
          <span class="proj-kpi-label" i18n="@@projects.components.taches.ouvertes.639d6d23">Tâches ouvertes</span>
          <strong class="proj-kpi-value">{{ data.openTasks }}</strong>
        </div>
        <div class="proj-kpi-card">
          <span class="proj-kpi-label" i18n="@@projects.components.taches.terminees.f6a3e341">Tâches terminées</span>
          <strong class="proj-kpi-value">{{ completedTasks ?? '—' }}</strong>
        </div>
        <div class="proj-kpi-card" [class.proj-kpi-warn]="data.overdueTasks > 0">
          <span class="proj-kpi-label" i18n="@@projects.components.en.retard.40c1dde3">En retard</span>
          <strong class="proj-kpi-value">{{ data.overdueTasks }}</strong>
        </div>
        <div class="proj-kpi-card">
          <span class="proj-kpi-label" i18n="@@projects.components.heures.a.facturer.7757d0a3">Heures à facturer</span>
          <strong class="proj-kpi-value">{{ data.uninvoicedBillableHours | number:'1.0-1' }} h</strong>
        </div>
      </div>
    }
  `
})
export class ProjectKpiStripComponent {
  @Input() data: ProjectDashboard | null = null;
  @Input() completedTasks: number | null = null;
}
