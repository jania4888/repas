import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { ProjectDashboardExtended, ProjectStatusBreakdown } from '../project-api.service';
import { ProjectProgressGaugeComponent } from './project-progress-gauge.component';

@Component({
  selector: 'app-project-dashboard-charts',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, ChartModule, ChartCardComponent, ProjectProgressGaugeComponent],
  template: `
    @if (data) {
      <div class="proj-dash-charts">
        <app-chart-card title="Avancement des projets" i18n-title="@@projects.components.avancement.des.projets.2192527c" subtitle="Répartition par statut">
          <div class="proj-dash-donut-wrap">
            <div class="proj-dash-donut-chart">
              <p-chart type="doughnut" [data]="statusChart()" [options]="doughnutOptions" [style]="{ height: '220px' }" />
              <div class="proj-dash-donut-center" aria-hidden="true">
                <strong>{{ data.averageProgressPercent }} %</strong>
                <span i18n="@@projects.components.avancement.moyen.06267bd4">Avancement moyen</span>
              </div>
            </div>
            <ul class="proj-dash-donut-legend">
              @for (item of legendItems(); track item.statusDisplay) {
                <li>
                  <span class="proj-dash-legend-dot" [style.background]="item.color"></span>
                  <span class="proj-dash-legend-label">{{ item.statusDisplay | backendLabel }}</span>
                  <span class="proj-dash-legend-meta">{{ item.percent }} % · {{ item.count }}</span>
                </li>
              }
            </ul>
          </div>
        </app-chart-card>

        <app-chart-card
          title="Évolution des tâches" i18n-title="@@projects.components.evolution.des.taches.1cb8b4bb"
          [subtitle]="period === 'month' ? loc_ui_tern_30_derniers_jours_edd8ab : loc_ui_tern_7_derniers_jours_4ea89a">
          <p-chart type="line" [data]="trendChart()" [options]="lineOptions" [style]="{ height: '260px' }" />
        </app-chart-card>

        <app-project-progress-gauge
          [value]="data.averageProgressPercent"
          [target]="data.progressTargetPercent" />
      </div>
    }
  `
})
export class ProjectDashboardChartsComponent {
  readonly loc_ui_tern_30_derniers_jours_edd8ab = $localize`:@@ui.tern.30.derniers.jours.edd8ab:30 derniers jours`;
  readonly loc_ui_tern_7_derniers_jours_4ea89a = $localize`:@@ui.tern.7.derniers.jours.4ea89a:7 derniers jours`;
  @Input() data: ProjectDashboardExtended | null = null;
  @Input() period: 'week' | 'month' = 'week';

  readonly doughnutOptions = {
    cutout: '72%',
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    maintainAspectRatio: false
  };

  readonly lineOptions = {
    plugins: { legend: { position: 'bottom' as const } },
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  };

  private readonly statusColors: Record<string, string> = {
    Completed: '#16a34a',
    Active: '#2563eb',
    OnHold: '#d97706',
    Draft: '#64748b',
    Cancelled: '#dc2626'
  };

  readonly legendItems = computed(() => {
    const d = this.data;
    if (!d) return [] as (ProjectStatusBreakdown & { color: string })[];
    return d.projectStatusBreakdown.map(item => ({
      ...item,
      color: this.colorForStatus(item.status)
    }));
  });

  statusChart = computed(() => {
    const d = this.data;
    const items = d?.projectStatusBreakdown ?? [];
    return {
      labels: items.map(x => x.statusDisplay),
      datasets: [{
        data: items.map(x => x.count),
        backgroundColor: items.map(x => this.colorForStatus(x.status))
      }]
    };
  });

  trendChart = computed(() => {
    const d = this.data;
    const trend = d?.taskTrend ?? [];
    return {
      labels: trend.map(p => new Date(p.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })),
      datasets: [
        { label: 'Créées', data: trend.map(p => p.created), borderColor: '#2563eb', tension: 0.3 },
        { label: 'Terminées', data: trend.map(p => p.completed), borderColor: '#16a34a', tension: 0.3 },
        { label: 'En attente', data: trend.map(p => p.pending ?? 0), borderColor: '#d97706', tension: 0.3 },
        { label: 'En retard', data: trend.map(p => p.overdue), borderColor: '#dc2626', tension: 0.3 }
      ]
    };
  });

  private colorForStatus(status: unknown): string {
    const key = typeof status === 'string' ? status : String(status ?? '');
    return this.statusColors[key] ?? '#64748b';
  }
}
