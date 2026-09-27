import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { ChartModule } from 'primeng/chart';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingHealthComponent } from '../health/health.component';
import {
  AccountingAuditService,
  AccountingAnomalyDetailDto,
  AccountingAnomalyListItemDto,
  AccountingAuditAnalyticsDto,
  AccountingAuditDashboardDto,
  AccountingControlModuleDto
} from './accounting-audit.service';
import {
  ANOMALY_STATUS_LABELS,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TAB_TO_FILTER,
  SeverityTab
} from './audit-control.constants';
import { downloadBlob } from '../shared/accounting-download.util';
import { AuditCorrectionNavigator } from './audit-correction.navigation';
import { AccountingAmountPipe } from '../shared/accounting-amount.pipe';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-audit-control-page',
  standalone: true,
  imports: [AccountingAmountPipe, 
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    ChartModule,
    DialogModule,
    SelectModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    AccountingHealthComponent
  ],
  templateUrl: './audit-control-page.component.html',
  styleUrl: './audit-control-page.component.scss'
})
export class AuditControlPageComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly auditApi = inject(AccountingAuditService);
  private readonly correctionNavigator = inject(AuditCorrectionNavigator);
  private readonly route = inject(ActivatedRoute);

  readonly dashboardEnabled = signal(true);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly dashboard = signal<AccountingAuditDashboardDto | null>(null);
  readonly anomalies = signal<AccountingAnomalyListItemDto[]>([]);
  readonly totalRecords = signal(0);
  readonly analytics = signal<AccountingAuditAnalyticsDto | null>(null);
  readonly modules = signal<AccountingControlModuleDto[]>([]);
  readonly selectedAnomaly = signal<AccountingAnomalyDetailDto | null>(null);
  readonly detailVisible = signal(false);

  fiscalYear = new Date().getFullYear();
  search = '';
  activeTab: SeverityTab = 'all';
  selectedModuleCode: string | null = null;

  readonly tabs: { key: SeverityTab; label: string }[] = [
    { key: 'all', label: $localize`:@@accounting.audit-control-page.ts.toutes.c5f641e4:Toutes` },
    { key: 'blocking', label: $localize`:@@accounting.audit-control-page.ts.erreurs.bloquantes.f4604ece:Erreurs bloquantes` },
    { key: 'warning', label: $localize`:@@accounting.audit-control-page.ts.avertissements.0fc072a7:Avertissements` },
    { key: 'info', label: $localize`:@@accounting.audit-control-page.ts.informations.54937b3a:Informations` },
    { key: 'ignored', label: $localize`:@@accounting.audit-control-page.ts.ignorees.a4347cb7:Ignorées` }
  ];

  readonly donutData = computed(() => {
    const a = this.analytics();
    if (!a?.byCategory?.length) return null;
    return {
      labels: a.byCategory.map(c => c.label),
      datasets: [{ data: a.byCategory.map(c => c.count), backgroundColor: ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#64748b'] }]
    };
  });

  readonly lineData = computed(() => {
    const a = this.analytics();
    if (!a?.trend?.length) return null;
    return {
      labels: a.trend.map(t => t.label),
      datasets: [
        { label: $localize`:@@accounting.audit-control-page.ts.bloquants.ef4ed4be:Bloquants`, data: a.trend.map(t => t.blocking), borderColor: '#ef4444', tension: 0.3 },
        { label: $localize`:@@accounting.audit-control-page.ts.avertissements.0fc072a7:Avertissements`, data: a.trend.map(t => t.warning), borderColor: '#f97316', tension: 0.3 },
        { label: $localize`:@@accounting.audit-control-page.ts.infos.df9161f6:Infos`, data: a.trend.map(t => t.info), borderColor: '#3b82f6', tension: 0.3 }
      ]
    };
  });

  chartOptions = {
    plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 12, font: { size: 11 } } } },
    maintainAspectRatio: false
  };

  ngOnInit(): void {
    const fy = this.route.snapshot.queryParamMap.get('fiscalYear');
    if (fy) {
      const year = Number(fy);
      if (!Number.isNaN(year)) this.fiscalYear = year;
    }
    this.refreshAll();
  }

  refreshAll(): void {
    this.error.set(null);
    this.loading.set(true);
    this.auditApi.getDashboard(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.dashboardEnabled.set(true);
          this.dashboard.set(res.data);
          this.loadAnomalies(1);
          this.loadAnalytics();
          this.loadModules();
        } else {
          this.dashboardEnabled.set(false);
          this.error.set(res.error ?? null);
        }
      },
      error: err => {
        this.loading.set(false);
        if (err?.status === 400) this.dashboardEnabled.set(false);
        else this.error.set($localize`:@@accounting.audit-control-page.ts.erreur.reseau.0683007f:Erreur réseau`);
      }
    });
  }

  runControl(): void {
    this.loading.set(true);
    this.auditApi.runAudit(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          if (res.data.dashboard) this.dashboard.set(res.data.dashboard);
          this.loadAnomalies(1);
          this.loadAnalytics();
          this.loadModules();
        } else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.audit-control-page.ts.erreur.lors.du.controle.567e41cd:Erreur lors du contrôle`));
      }
    });
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    const page = event.first != null && event.rows ? Math.floor(event.first / event.rows) + 1 : 1;
    this.loadAnomalies(page, event.rows ?? 12);
  }

  loadAnomalies(page = 1, pageSize = 12): void {
    const tabFilter = SEVERITY_TAB_TO_FILTER[this.activeTab];
    this.auditApi.getAnomalies({
      fiscalYear: this.fiscalYear,
      search: this.search || undefined,
      moduleCode: this.selectedModuleCode ?? undefined,
      page,
      pageSize,
      ...tabFilter
    }).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.anomalies.set(res.data.items);
          this.totalRecords.set(res.data.totalCount);
        }
      }
    });
  }

  loadAnalytics(): void {
    this.auditApi.getAnalytics(this.fiscalYear).subscribe({
      next: res => { if (res.success && res.data) this.analytics.set(res.data); }
    });
  }

  loadModules(): void {
    this.auditApi.getModules(this.fiscalYear).subscribe({
      next: res => { if (res.success && res.data) this.modules.set(res.data); }
    });
  }

  setTab(tab: SeverityTab): void {
    this.activeTab = tab;
    this.loadAnomalies(1);
  }

  filterByModule(code: string): void {
    this.selectedModuleCode = this.selectedModuleCode === code ? null : code;
    this.loadAnomalies(1);
  }

  openDetail(item: AccountingAnomalyListItemDto): void {
    this.auditApi.getAnomalyDetail(item.id).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.selectedAnomaly.set(res.data);
          this.detailVisible.set(true);
        }
      }
    });
  }

  resolveSelected(): void {
    const id = this.selectedAnomaly()?.id;
    if (!id) return;
    this.auditApi.resolveAnomaly(id).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.selectedAnomaly.set(res.data);
          this.refreshAll();
        }
      }
    });
  }

  correctAnomaly(item: AccountingAnomalyListItemDto | AccountingAnomalyDetailDto): void {
    this.correctionNavigator.navigate(item, {
      fiscalYear: this.fiscalYear,
      closeDialog: () => this.detailVisible.set(false)
    });
  }

  openEntryLine(line: AccountingAnomalyDetailDto['lines'][number]): void {
    if (!line.journalEntryId) return;
    this.correctionNavigator.navigateToEntry(line.journalEntryId, line.entryDate ?? null);
  }

  canCorrect(item: AccountingAnomalyListItemDto | AccountingAnomalyDetailDto): boolean {
    return !!(item.correctionLink?.route || item.deepLinkRoute);
  }

  exportReport(format: 'csv' | 'pdf'): void {
    const obs = format === 'csv' ? this.auditApi.exportCsv(this.fiscalYear) : this.auditApi.exportPdf(this.fiscalYear);
    obs.subscribe(blob => downloadBlob(blob, `audit-${this.fiscalYear}.${format}`));
  }

  severityLabel(s: number): string { return SEVERITY_LABELS[s] ?? '—'; }
  statusLabel(s: number): string { return ANOMALY_STATUS_LABELS[s] ?? '—'; }
  categoryLabel(c: number): string { return CATEGORY_LABELS[c] ?? '—'; }

  severityClass(s: number): string {
    if (s === 2) return 'ac-badge--blocking';
    if (s === 1) return 'ac-badge--warning';
    return 'ac-badge--info';
  }
}
