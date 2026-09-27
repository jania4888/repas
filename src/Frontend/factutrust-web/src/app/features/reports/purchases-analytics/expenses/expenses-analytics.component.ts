import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PurchasesAnalyticsService,
  PurchasesAnalyticsPeriod,
  ExpensesAnalyticsData,
  ExpenseChartPoint
} from '../../services/purchases-analytics.service';

@Component({
  selector: 'app-expenses-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header
      title="Dépenses" i18n-title="@@reports.purchases-analytics.depenses.fb667434"
      subtitle="Suivez l'évolution de vos dépenses et comparez par période">
      <app-button
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()" i18n="@@reports.purchases-analytics.imprimer.5382c09d"> Imprimer </app-button>
    </app-page-header>

    <div class="filter-bar">
      <div class="filter-group">
        <label class="filter-label" i18n="@@reports.purchases-analytics.periode.de2110b7">Période</label>
        <div class="period-tabs">
          @for (p of periodOptions; track p.value) {
            <button
              class="period-tab"
              [class.active]="selectedPeriod === p.value"
              (click)="onPeriodChange(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
      </div>
    </div>

    @if (!loading() && data()?.comparison) {
      <div class="insight-banner" [class]="'insight-banner--' + data()!.comparison.changeDirection">
        <i class="pi"
           [class.pi-trending-up]="data()!.comparison.changeDirection === 'up'"
           [class.pi-trending-down]="data()!.comparison.changeDirection === 'down'"
           [class.pi-minus]="data()!.comparison.changeDirection === 'stable'">
        </i>
        <p class="insight-message">{{ data()!.comparison.message }}</p>
        <span class="insight-badge" [class]="'badge--' + data()!.comparison.changeDirection">
          {{ data()!.comparison.changeDirection === 'down' ? '' : '+' }}{{ data()!.comparison.changePercent | number:'1.1-1' }} %
        </span>
      </div>
    }

    @if (loading()) {
      <div class="kpi-grid">
        <div class="kpi-skeleton"></div>
        <div class="kpi-skeleton"></div>
        <div class="kpi-skeleton"></div>
      </div>
    } @else if (data()) {
      <div class="kpi-grid">
        <app-stat-card
          label="Dépenses totales" i18n-label="@@reports.purchases-analytics.depenses.totales.7f280e4e"
          [value]="formatAmount(data()!.totalExpenses)"
          icon="pi-dollar"
          variant="primary"
          [change]="-data()!.comparison.changePercent">
        </app-stat-card>
        <app-stat-card
          label="Factures fournisseurs" i18n-label="@@reports.purchases-analytics.factures.fournisseurs.1dcbc2ed"
          [value]="data()!.totalInvoices"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Période précédente" i18n-label="@@reports.purchases-analytics.periode.precedente.5e420e76"
          [value]="formatAmount(data()!.comparison.previousValue)"
          icon="pi-history"
          variant="warning">
        </app-stat-card>
      </div>
    }

    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases-analytics.evolution.des.depenses.55b93cad">Évolution des dépenses</h2>
        <span class="section-hint">
          <i class="pi pi-info-circle"></i>
          Dépenses (factures payées) sur la période sélectionnée
        </span>
      </div>
      @if (loading()) {
        <div class="chart-placeholder">
          <div class="loading-spinner">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.purchases-analytics.chargement.a209b664">Chargement...</span>
          </div>
        </div>
      } @else if (data()?.chartData && hasChartData()) {
        <div class="chart-container" role="img" aria-label="Graphique des dépenses" i18n-aria-label="@@reports.purchases-analytics.graphique.des.depenses.7f62dfb4">
          <div class="chart-y-axis">
            <span class="y-label">{{ formatAmountShort(maxAmount) }}</span>
            <span class="y-label">{{ formatAmountShort(maxAmount / 2) }}</span>
            <span class="y-label">0</span>
          </div>
          <div class="chart-area">
            <div class="chart-grid-lines">
              <div class="grid-line"></div>
              <div class="grid-line"></div>
              <div class="grid-line"></div>
            </div>
            <div class="chart-bars">
              @for (item of getVisibleChartData(); track item.label) {
                <div class="bar-group">
                  <div class="bar-tooltip">
                    <strong>{{ formatAmount(item.amount) }}</strong><br>
                    <small>{{ item.invoiceCount }} facture{{ item.invoiceCount > 1 ? 's' : '' }}</small>
                  </div>
                  <div class="bar-wrapper">
                    <div
                      class="bar bar-blue"
                      [style.height.%]="getBarHeight(item.amount)"
                      [class.bar-zero]="item.amount === 0">
                    </div>
                  </div>
                  <span class="bar-label">{{ item.labelShort }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      } @else {
        <div class="chart-placeholder">
          <div class="empty-state">
            <i class="pi pi-chart-line empty-icon"></i>
            <p class="empty-title" i18n="@@reports.purchases-analytics.aucune.donnee.pour.cette.periode.b2a99770">Aucune donnée pour cette période</p>
            <p class="empty-subtitle" i18n="@@reports.purchases-analytics.les.depenses.apparaitront.ici.une.fois.que.vous..631790aa">Les dépenses apparaîtront ici une fois que vous aurez des factures fournisseurs payées. Créez des bons de commande et des factures fournisseurs.</p>
          </div>
        </div>
      }
    </div>

    <div class="grid-2-cols">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.depenses.par.fournisseur.e216e654">Dépenses par fournisseur</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Top fournisseurs par montant total (factures payées)
          </span>
        </div>
        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases-analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.bySupplier?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-building"></i>
            <p i18n="@@reports.purchases-analytics.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          </div>
        } @else {
          <div class="ranking-list">
            @for (supplier of data()!.bySupplier; track supplier.supplierName; let i = $index) {
              <div class="ranking-item">
                <div class="rank-badge" [class]="'rank-' + (i < 3 ? i + 1 : 'default')">
                  {{ i + 1 }}
                </div>
                <div class="rank-info">
                  <span class="rank-name">{{ supplier.supplierName }}</span>
                  <span class="rank-detail">{{ supplier.invoiceCount }} facture{{ supplier.invoiceCount > 1 ? 's' : '' }}</span>
                </div>
                <div class="rank-value">
                  <span class="rank-amount">{{ formatAmount(supplier.totalAmount) }}</span>
                  <div class="rank-bar-wrapper">
                    <div class="rank-bar rank-bar-blue" [style.width.%]="supplier.percentOfTotal"></div>
                  </div>
                  <span class="rank-percent">{{ supplier.percentOfTotal | number:'1.1-1' }} %</span>
                </div>
              </div>
            }
          </div>
        }
      </div>
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.resume.9fb58963">Résumé</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Vue d'ensemble de la période
          </span>
        </div>
        @if (!loading() && data()) {
          <div class="summary-cards">
            <div class="summary-item">
              <div class="summary-icon-wrap primary">
                <i class="pi pi-dollar"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.purchases-analytics.total.depense.8bd8cc9d">Total dépensé</span>
                <span class="summary-value">{{ formatAmount(data()!.totalExpenses) }}</span>
                <span class="summary-desc" i18n="@@reports.purchases-analytics.factures.fournisseurs.payees.sur.la.periode.f7cd96dd">Factures fournisseurs payées sur la période</span>
              </div>
            </div>
            <div class="summary-item">
              <div class="summary-icon-wrap warning">
                <i class="pi pi-file"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.purchases-analytics.factures.da35e4f2">Factures</span>
                <span class="summary-value">{{ data()!.totalInvoices }}</span>
                <span class="summary-desc" i18n="@@reports.purchases-analytics.nombre.total.de.factures.sur.la.periode.9c4fbfde">Nombre total de factures sur la période</span>
              </div>
            </div>
            <div class="summary-item">
              <div class="summary-icon-wrap success">
                <i class="pi pi-chart-line"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.purchases-analytics.moyenne.par.facture.b3785f82">Moyenne par facture</span>
                <span class="summary-value">{{ data()!.totalInvoices > 0 ? formatAmount(data()!.totalExpenses / data()!.totalInvoices) : '0' }}</span>
                <span class="summary-desc" i18n="@@reports.purchases-analytics.montant.moyen.par.facture.payee.4c9910ff">Montant moyen par facture payée</span>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .filter-bar {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4) var(--spacing-5);
      margin-bottom: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }
    .filter-group { display: flex; align-items: center; gap: var(--spacing-4); flex-wrap: wrap; }
    .filter-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .period-tabs { display: flex; gap: var(--spacing-1); background: var(--color-neutral-100); border-radius: var(--radius-lg); padding: var(--spacing-1); }
    .period-tab { padding: var(--spacing-2) var(--spacing-4); border: none; border-radius: var(--radius-md); background: transparent; cursor: pointer; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); transition: all 0.2s ease; font-family: inherit; }
    .period-tab:hover { color: var(--color-text-primary); background: var(--color-background); }
    .period-tab.active { background: var(--color-background-elevated); color: #2563eb; box-shadow: var(--shadow-sm); font-weight: var(--font-weight-semibold); }

    .insight-banner { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-4) var(--spacing-5); border-radius: var(--radius-xl); margin-bottom: var(--spacing-6); }
    .insight-banner--up { background: linear-gradient(135deg, var(--color-error-50), rgba(239, 68, 68, 0.05)); border: 1px solid var(--color-error-200); }
    .insight-banner--up .pi { color: var(--color-error-600); font-size: 1.25rem; }
    .insight-banner--down { background: linear-gradient(135deg, var(--color-success-50), rgba(34, 197, 94, 0.05)); border: 1px solid var(--color-success-200); }
    .insight-banner--down .pi { color: var(--color-success-600); font-size: 1.25rem; }
    .insight-banner--stable { background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(59, 130, 246, 0.05)); border: 1px solid #93c5fd; }
    .insight-banner--stable .pi { color: #2563eb; font-size: 1.25rem; }
    .insight-message { margin: 0; flex: 1; font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.5; }
    .insight-badge { padding: var(--spacing-1) var(--spacing-3); border-radius: var(--radius-full); font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
    .badge--up { background: var(--color-error-100); color: var(--color-error-700); }
    .badge--down { background: var(--color-success-100); color: var(--color-success-700); }
    .badge--stable { background: rgba(59, 130, 246, 0.15); color: #1d4ed8; }

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--spacing-4); margin-bottom: var(--spacing-6); }
    .kpi-skeleton { background: var(--color-background-elevated); border-radius: var(--radius-xl); height: 120px; border: 1px solid var(--color-border-subtle); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .section { background: var(--color-background-elevated); border-radius: var(--radius-xl); padding: var(--spacing-6); box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-subtle); margin-bottom: var(--spacing-6); }
    .section-header { margin-bottom: var(--spacing-5); padding-bottom: var(--spacing-4); border-bottom: 2px solid var(--color-border-subtle); }
    .section-title { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); margin: 0 0 var(--spacing-2); display: flex; align-items: center; gap: var(--spacing-2); }
    .section-title::before { content: ''; width: 4px; height: 20px; background: linear-gradient(180deg, #60a5fa, #3b82f6); border-radius: var(--radius-full); }
    .section-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--spacing-1); }
    .section-hint .pi { font-size: 0.75rem; opacity: 0.7; }

    .chart-placeholder { min-height: 280px; display: flex; align-items: center; justify-content: center; background: var(--color-neutral-50); border-radius: var(--radius-lg); border: 2px dashed var(--color-border-subtle); }
    .chart-container { display: flex; gap: var(--spacing-2); padding: var(--spacing-4) 0; }
    .chart-y-axis { display: flex; flex-direction: column; justify-content: space-between; padding-bottom: 28px; min-width: 60px; text-align: right; }
    .y-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); font-family: 'JetBrains Mono', monospace; }
    .chart-area { flex: 1; position: relative; min-height: 250px; }
    .chart-grid-lines { position: absolute; top: 0; left: 0; right: 0; bottom: 28px; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
    .grid-line { height: 1px; background: var(--color-border-subtle); }
    .chart-bars { display: flex; align-items: flex-end; height: calc(100% - 28px); gap: 2px; padding: 0; }
    .bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; position: relative; height: 100%; justify-content: flex-end; }
    .bar-wrapper { width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
    .bar { width: 70%; max-width: 50px; min-height: 3px; border-radius: var(--radius-md) var(--radius-md) 0 0; transition: height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; }
    .bar-blue { background: linear-gradient(180deg, #60a5fa, #3b82f6); }
    .bar-blue:hover { background: linear-gradient(180deg, #93c5fd, #2563eb); }
    .bar-zero { background: var(--color-neutral-200); }
    .bar-tooltip { position: absolute; top: 0; left: 50%; transform: translateX(-50%) translateY(-100%); background: var(--color-text-primary); color: var(--color-background); padding: var(--spacing-2) var(--spacing-3); border-radius: var(--radius-md); font-size: var(--font-size-xs); white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; z-index: 10; text-align: center; font-family: 'JetBrains Mono', monospace; }
    .bar-group:hover .bar-tooltip { opacity: 1; }
    .bar-label { margin-top: var(--spacing-2); font-size: 10px; color: var(--color-text-secondary); text-align: center; line-height: 1; }

    .ranking-list { display: flex; flex-direction: column; gap: var(--spacing-2); }
    .ranking-item { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-lg); transition: background 0.2s ease; border: 1px solid transparent; }
    .ranking-item:hover { background: var(--color-neutral-50); border-color: var(--color-border-subtle); }
    .rank-badge { width: 32px; height: 32px; border-radius: var(--radius-full); display: flex; align-items: center; justify-content: center; font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); flex-shrink: 0; }
    .rank-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; }
    .rank-2 { background: linear-gradient(135deg, #9ca3af, #6b7280); color: white; }
    .rank-3 { background: linear-gradient(135deg, #d97706, #b45309); color: white; }
    .rank-default { background: var(--color-neutral-100); color: var(--color-text-secondary); }
    .rank-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .rank-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rank-detail { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .rank-value { display: flex; flex-direction: column; align-items: flex-end; gap: var(--spacing-1); min-width: 120px; }
    .rank-amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .rank-bar-wrapper { width: 100%; height: 4px; background: var(--color-neutral-200); border-radius: var(--radius-full); overflow: hidden; }
    .rank-bar { height: 100%; border-radius: var(--radius-full); transition: width 0.6s ease; }
    .rank-bar-blue { background: linear-gradient(90deg, #60a5fa, #3b82f6); }
    .rank-percent { font-size: var(--font-size-xs); color: var(--color-text-secondary); }

    .summary-cards { display: flex; flex-direction: column; gap: var(--spacing-4); }
    .summary-item { display: flex; gap: var(--spacing-4); padding: var(--spacing-4); border-radius: var(--radius-lg); border: 1px solid var(--color-border-subtle); background: var(--color-neutral-50); }
    .summary-icon-wrap { width: 44px; height: 44px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.1rem; }
    .summary-icon-wrap.primary { background: rgba(59, 130, 246, 0.15); color: #2563eb; }
    .summary-icon-wrap.warning { background: var(--color-warning-100); color: var(--color-warning-700); }
    .summary-icon-wrap.success { background: var(--color-success-100); color: var(--color-success-700); }
    .summary-content { display: flex; flex-direction: column; }
    .summary-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-value { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); font-family: 'JetBrains Mono', monospace; }
    .summary-desc { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: var(--spacing-1); }

    .grid-2-cols { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: var(--spacing-6); }
    .loading-spinner { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-3); padding: var(--spacing-8); color: var(--color-text-secondary); }
    .loading-spinner .pi { font-size: 2rem; }
    .empty-state { text-align: center; color: var(--color-text-secondary); }
    .empty-icon { font-size: 3rem; color: #3b82f6; margin-bottom: var(--spacing-3); }
    .empty-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--spacing-2); }
    .empty-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .empty-state-sm { text-align: center; padding: var(--spacing-6); color: var(--color-text-secondary); }
    .empty-state-sm .pi { font-size: 2rem; margin-bottom: var(--spacing-2); }
    @media (max-width: 1024px) { .grid-2-cols { grid-template-columns: 1fr; } }
  `]
})
export class ExpensesAnalyticsComponent implements OnInit {
  private analyticsService = inject(PurchasesAnalyticsService);

  loading = signal(true);
  data = signal<ExpensesAnalyticsData | null>(null);
  selectedPeriod: PurchasesAnalyticsPeriod = 'month';
  maxAmount = 0;
  private readonly maxBars = 31;

  periodOptions: { label: string; value: PurchasesAnalyticsPeriod }[] = [
    { label: 'Jour', value: 'day' },
    { label: 'Mois', value: 'month' },
    { label: 'Année', value: 'year' }
  ];

  ngOnInit(): void {
    this.loadData();
  }

  onPeriodChange(period: PurchasesAnalyticsPeriod): void {
    this.selectedPeriod = period;
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.analyticsService.loadExpensesData(this.selectedPeriod).subscribe({
      next: (d) => {
        this.data.set(d);
        const amounts = d.chartData.map(x => x.amount);
        this.maxAmount = Math.max(...amounts, 1);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  hasChartData(): boolean {
    const d = this.data();
    if (!d?.chartData?.length) return false;
    return d.chartData.some(x => x.amount > 0);
  }

  getVisibleChartData(): ExpenseChartPoint[] {
    const d = this.data();
    if (!d?.chartData?.length) return [];
    if (d.chartData.length <= this.maxBars) return d.chartData;
    const step = Math.ceil(d.chartData.length / this.maxBars);
    return d.chartData.filter((_, i) => i % step === 0 || i === d.chartData.length - 1);
  }

  getBarHeight(amount: number): number {
    if (this.maxAmount === 0) return 3;
    const pct = (amount / this.maxAmount) * 100;
    return Math.max(pct, 3);
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value) + $localize`:@@ui.tern.tnd.9aaf5c: TND`;
  }

  formatAmountShort(value: number): string {
    if (value >= 1e6) return (value / 1e6).toFixed(1) + ' M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + ' k';
    return value.toFixed(0);
  }

  onPrint(): void {
    window.print();
  }
}
