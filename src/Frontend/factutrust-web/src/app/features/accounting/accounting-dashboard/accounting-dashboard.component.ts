import {
  Component,
  DestroyRef,
  HostListener,
  Injector,
  OnInit,
  QueryList,
  ViewChildren,
  afterNextRender,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ChartModule, UIChart } from 'primeng/chart';

import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { AppDatePipe } from '@shared/pipes/app-date.pipe';
import { ErpFormatService } from '@core/i18n/erp-format';
import { FirmContextService } from '@core/services/firm-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

import {
  AccountingOverviewDashboardDto,
  AccountingService,
  ApiResponse,
  DashboardComparison,
  RecentDocumentDto
} from '../services/accounting.service';
import { FiscalScheduleService } from '../services/fiscal-schedule.service';
import { AccountingAmountPipe } from '../shared/accounting-amount.pipe';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { downloadBlob } from '../shared/accounting-download.util';
import {
  buildExpenseDoughnutData,
  buildNetResultChartData,
  buildRevenueChartData,
  buildThirdPartyChartData,
  comparisonOptions,
  deadlineCountdownLabel,
  deadlineUrgency,
  deltaIconClass,
  deltaTone,
  documentIcon,
  formatCompactTnd,
  formatDeltaPercent,
  formatFileSize,
  isEmptyPeriod,
  mainAccountSparkline,
  periodOptions,
  relativeDocumentAge,
  roundToOneDecimal
} from './accounting-dashboard.view-model';

type LoadRequest = { fiscalYear?: number; month?: number; comparison?: DashboardComparison };

/** Tableau de bord comptable du dossier, écran d'accueil d'une ouverture de dossier délégué. */
@Component({
  selector: 'app-accounting-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    ChartModule,
    DecimalPipe,
    PageHeaderComponent,
    StatCardComponent,
    ChartCardComponent,
    DashboardPanelComponent,
    EmptyStateComponent,
    SkeletonComponent,
    AccountingAmountPipe,
    AppDatePipe,
    AccountingStatusBannerComponent
  ],
  templateUrl: './accounting-dashboard.component.html',
  styleUrl: './accounting-dashboard.component.scss'
})
export class AccountingDashboardComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly fiscalSchedule = inject(FiscalScheduleService);
  private readonly firmContext = inject(FirmContextService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly erpFormat = inject(ErpFormatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  @ViewChildren(UIChart) private readonly charts?: QueryList<UIChart>;

  constructor() {
    // Une fenêtre desk peut rattacher ce composant avec un canvas de largeur obsolète (Chart.js
    // garde la taille calculée au premier rendu) : chaque changement de données déclenche un
    // redimensionnement après le prochain rendu, une fois les `<p-chart>` effectivement à jour.
    effect(() => {
      this.data();
      afterNextRender(() => this.resizeCharts(), { injector: this.injector });
    });
  }

  @HostListener('window:resize')
  @HostListener('window:beforeprint')
  @HostListener('window:afterprint')
  onWindowResize(): void {
    this.resizeCharts();
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AccountingOverviewDashboardDto | null>(null);

  private readonly now = new Date();
  readonly selectedPeriod = signal<{ fiscalYear: number; month: number }>({
    fiscalYear: this.now.getFullYear(),
    month: this.now.getMonth() + 1
  });
  readonly comparison = signal<DashboardComparison>('previous-month');

  readonly comparisonOptionsList = comparisonOptions();

  readonly companyName = computed(() => this.firmContext.activeClient()?.companyName ?? '');
  readonly subtitle = computed(
    () =>
      $localize`:@@accounting.accounting-dashboard.ts.vue.d.ensemble.de.la.situation.comptable.7cbd45f1:Vue d'ensemble de la situation comptable et financière de ${this.companyName()}:companyName:`
  );
  readonly isEmpty = computed(() => isEmptyPeriod(this.data()));
  readonly periodOptionsList = computed(() => periodOptions(this.data()?.availableYears ?? [this.now.getFullYear()]));
  readonly selectedPeriodValue = computed(() => `${this.selectedPeriod().fiscalYear}-${this.selectedPeriod().month}`);

  readonly revenueChartData = computed(() => {
    const d = this.data();
    return d ? buildRevenueChartData(d.revenueByMonth, d.fiscalYear) : null;
  });
  readonly netResultChartData = computed(() => {
    const d = this.data();
    return d ? buildNetResultChartData(d.netResultByMonth) : null;
  });
  readonly expenseDoughnut = computed(() => {
    const d = this.data();
    return d ? buildExpenseDoughnutData(d.expenseBreakdown) : null;
  });
  readonly clientsChart = computed(() => buildThirdPartyChartData(this.data()?.clients ?? null));
  readonly suppliersChart = computed(() => buildThirdPartyChartData(this.data()?.suppliers ?? null));

  readonly netResultTone = computed<'success' | 'error'>(() =>
    (this.data()?.netResult.current ?? 0) < 0 ? 'error' : 'success'
  );

  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  readonly commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: this.reducedMotion ? false : undefined,
    plugins: { legend: { display: false } }
  };

  readonly revenueChartOptions = {
    ...this.commonChartOptions,
    plugins: { legend: { display: true, position: 'top' as const } },
    scales: {
      y: { ticks: { callback: (v: number) => formatCompactTnd(v) } }
    }
  };

  readonly netResultChartOptions = {
    ...this.commonChartOptions,
    scales: {
      y: { ticks: { callback: (v: number) => formatCompactTnd(v) } }
    }
  };

  readonly doughnutChartOptions = {
    ...this.commonChartOptions,
    cutout: '68%'
  };

  private readonly requestLoad$ = new Subject<LoadRequest | undefined>();

  readonly formatDeltaPercent = formatDeltaPercent;
  readonly deltaTone = deltaTone;
  readonly deltaIconClass = deltaIconClass;
  readonly deadlineUrgency = deadlineUrgency;
  readonly deadlineCountdownLabel = deadlineCountdownLabel;
  readonly documentIcon = documentIcon;
  readonly formatFileSize = formatFileSize;
  readonly mainAccountSparkline = mainAccountSparkline;
  readonly roundToOneDecimal = roundToOneDecimal;

  ngOnInit(): void {
    this.requestLoad$
      .pipe(
        switchMap(request => this.api.getDashboardOverview(request)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: res => this.onLoadSuccess(res),
        error: err => this.onLoadError(err)
      });

    this.load();
  }

  /** Sans paramètre, le backend choisit la période ; la sélection courante est alignée sur la réponse. */
  load(request?: LoadRequest): void {
    this.loading.set(true);
    this.error.set(null);
    this.requestLoad$.next(request);
  }

  onPeriodChange(value: string): void {
    const [fiscalYear, month] = value.split('-').map(Number);
    this.selectedPeriod.set({ fiscalYear, month });
    this.reload();
  }

  onComparisonChange(value: DashboardComparison): void {
    this.comparison.set(value);
    this.reload();
  }

  reload(): void {
    const { fiscalYear, month } = this.selectedPeriod();
    this.load({ fiscalYear, month, comparison: this.comparison() });
  }

  private onLoadSuccess(res: ApiResponse<AccountingOverviewDashboardDto>): void {
    this.loading.set(false);
    if (res.success && res.data) {
      this.data.set(res.data);
      this.selectedPeriod.set({ fiscalYear: res.data.fiscalYear, month: res.data.month });
      this.comparison.set(res.data.comparison);
    } else {
      this.error.set(
        res.error ?? $localize`:@@accounting.accounting-dashboard.ts.erreur.de.chargement.du.tableau.de.bord.1a7e5770:Erreur de chargement du tableau de bord`
      );
    }
  }

  private onLoadError(err: unknown): void {
    this.loading.set(false);
    this.error.set(
      this.errorHandler.extractErrorMessage(
        err,
        $localize`:@@accounting.accounting-dashboard.ts.erreur.reseau.0683007f:Erreur réseau`
      )
    );
  }

  private resizeCharts(): void {
    this.charts?.forEach(c => c.chart?.resize());
  }

  downloadDocument(doc: RecentDocumentDto): void {
    const request$ =
      doc.source === 'fiscal-schedule'
        ? this.fiscalSchedule.downloadAttachment(doc.ownerId, doc.id)
        : this.api.downloadEntryAttachment(doc.ownerId, doc.id);
    request$.subscribe(blob => downloadBlob(blob, doc.fileName));
  }

  relativeAge(createdAt: string): string {
    const { value, unit } = relativeDocumentAge(createdAt, new Date());
    return this.erpFormat.relativeTime(value, unit);
  }

  print(): void {
    window.print();
  }

  focusPeriodSelect(): void {
    document.getElementById('accounting-dashboard-period')?.focus();
  }

  documentDownloadAriaLabel(doc: RecentDocumentDto): string {
    return $localize`:@@accounting.accounting-dashboard.ts.tpl.telecharger.filename.fff6dacd:Télécharger ${doc.fileName}:fileName:`;
  }
}
