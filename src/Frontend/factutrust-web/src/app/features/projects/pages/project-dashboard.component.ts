import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ProjectApiService, ProjectDashboardExtended } from '../project-api.service';
import { ProjectDashboardHeroComponent } from '../components/project-dashboard-hero.component';
import { ProjectDashboardKpiRowComponent } from '../components/project-dashboard-kpi-row.component';
import { ProjectDashboardChartsComponent } from '../components/project-dashboard-charts.component';
import { ProjectRecentProjectsPanelComponent } from '../components/project-recent-projects-panel.component';
import { ProjectDashboardSidebarComponent } from '../components/project-dashboard-sidebar.component';
import { ProjectPerformanceBannerComponent } from '../components/project-performance-banner.component';

@Component({
  selector: 'app-project-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    BreadcrumbComponent,
    ProjectDashboardHeroComponent,
    ProjectDashboardKpiRowComponent,
    ProjectDashboardChartsComponent,
    ProjectRecentProjectsPanelComponent,
    ProjectDashboardSidebarComponent,
    ProjectPerformanceBannerComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-project-dashboard-hero
      [greeting]="greeting"
      [canCreate]="canCreate" />

    @if (loading()) {
      <p class="text-color-secondary proj-dash-loading" i18n="@@projects.pages.chargement.01cba1df">Chargement…</p>
    } @else if (error()) {
      <p class="text-danger proj-dash-loading" role="alert">{{ error() }}</p>
    } @else {
      @if (data(); as d) {
        <app-project-dashboard-kpi-row
          [data]="d"
          [period]="period"
          (periodChange)="onPeriodChange($event)" />

        <app-project-dashboard-charts [data]="d" [period]="period" class="proj-dash-section" />

        <div class="proj-dash-main proj-dash-section">
          <app-project-recent-projects-panel [data]="d" />
          <app-project-dashboard-sidebar [data]="d" />
        </div>

        <app-project-performance-banner
          class="proj-dash-section"
          [summary]="d.performanceSummary" />
      }
    }
  `
})
export class ProjectDashboardComponent implements OnInit {
  private readonly api = inject(ProjectApiService);
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorHandlerService);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Accueil', route: '/' },
    { label: 'Projets', route: '/projects' },
    { label: 'Tableau de bord' }
  ];

  period: 'week' | 'month' = 'week';
  readonly data = signal<ProjectDashboardExtended | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  get greeting(): string {
    const name = this.auth.user()?.firstName ?? '';
    return name ? `Bonjour, ${name}` : 'Bonjour';
  }

  get canCreate(): boolean {
    return this.auth.hasPermission(PERMISSIONS.projects.create);
  }

  ngOnInit(): void {
    this.load();
  }

  onPeriodChange(period: 'week' | 'month'): void {
    this.period = period;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.dashboardExtended(this.period).subscribe({
      next: r => {
        this.loading.set(false);
        if (r.success && r.data) this.data.set(r.data);
        else this.error.set(r.message || 'Chargement impossible');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err));
      }
    });
  }
}
