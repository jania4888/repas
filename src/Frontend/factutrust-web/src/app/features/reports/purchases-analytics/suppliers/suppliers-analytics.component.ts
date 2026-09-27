import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PurchasesAnalyticsService,
  PurchasesAnalyticsPeriod,
  SuppliersAnalyticsData
} from '../../services/purchases-analytics.service';

@Component({
  selector: 'app-suppliers-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header
      title="Analyse fournisseurs" i18n-title="Analyse fournisseurs"
      subtitle="Classement, part des achats et indicateurs par fournisseur">
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

    @if (!loading() && data()?.alerts?.length) {
      <div class="alerts-section">
        @for (alert of data()!.alerts; track alert.title) {
          <div class="alert-card" [class]="'alert-card--' + alert.type">
            <div class="alert-icon-wrap">
              <i class="pi" [class]="alert.icon"></i>
            </div>
            <div class="alert-content">
              <strong class="alert-title">{{ alert.title }}</strong>
              <p class="alert-message">{{ alert.message }}</p>
            </div>
          </div>
        }
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
          label="Fournisseurs actifs" i18n-label="Fournisseurs actifs"
          [value]="data()!.activeSuppliersCount"
          icon="pi-building"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Dépenses totales" i18n-label="Dépenses totales"
          [value]="formatAmount(data()!.totalExpenses)"
          icon="pi-dollar"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Concentration top 5" i18n-label="Concentration top 5"
          [value]="data()!.concentrationTop5Percent.toFixed(1) + ' %'"
          icon="pi-chart-pie"
          variant="warning">
        </app-stat-card>
      </div>
    }

    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases-analytics.classement.des.fournisseurs.bfaacd1a">Classement des fournisseurs</h2>
        <span class="section-hint">
          <i class="pi pi-info-circle"></i>
          Par montant total des achats (factures payées) sur la période
        </span>
      </div>
      @if (loading()) {
        <div class="loading-spinner">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.purchases-analytics.chargement.a209b664">Chargement...</span>
        </div>
      } @else if (!data()?.topSuppliers?.length) {
        <div class="empty-state">
          <i class="pi pi-building empty-icon"></i>
          <p class="empty-title" i18n="@@reports.purchases-analytics.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          <p class="empty-subtitle" i18n="@@reports.purchases-analytics.aucune.facture.fournisseur.payee.sur.cette.perio.59098a4b">Aucune facture fournisseur payée sur cette période. Créez des factures fournisseurs et enregistrez des paiements.</p>
        </div>
      } @else {
        <p-table
          [value]="data()!.topSuppliers"
          styleClass="p-datatable-sm analytics-table"
          aria-label="Tableau des fournisseurs par montant" i18n-aria-label="Tableau des fournisseurs par montant">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.purchases-analytics.rang.dbb66acd">Rang</th>
              <th i18n="@@reports.purchases-analytics.fournisseur.97d91d89">Fournisseur</th>
              <th class="text-right" i18n="@@reports.purchases-analytics.factures.da35e4f2">Factures</th>
              <th class="text-right" i18n="@@reports.purchases-analytics.montant.total.dd001537">Montant total</th>
              <th class="text-right" i18n="@@reports.purchases-analytics.part.88be9d62">Part</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-supplier let-i="rowIndex">
            <tr>
              <td>
                <span class="rank-badge" [class]="'rank-' + (i < 3 ? i + 1 : 'default')">{{ i + 1 }}</span>
              </td>
              <td><span class="supplier-name">{{ supplier.supplierName }}</span></td>
              <td class="text-right">{{ supplier.invoiceCount }}</td>
              <td class="text-right amount">{{ supplier.totalAmount | number:'1.3-3' }} {{ supplier.currency }}</td>
              <td class="text-right">{{ supplier.percentOfTotal | number:'1.1-1' }} %</td>
            </tr>
          </ng-template>
        </p-table>
      }
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

    .alerts-section { display: flex; flex-direction: column; gap: var(--spacing-3); margin-bottom: var(--spacing-6); }
    .alert-card { display: flex; align-items: flex-start; gap: var(--spacing-3); padding: var(--spacing-4); border-radius: var(--radius-lg); border: 1px solid; }
    .alert-card--warning { background: var(--color-warning-50); border-color: var(--color-warning-200); }
    .alert-card--danger { background: var(--color-error-50); border-color: var(--color-error-200); }
    .alert-card--success { background: var(--color-success-50); border-color: var(--color-success-200); }
    .alert-card--info { background: rgba(59, 130, 246, 0.08); border-color: #93c5fd; }
    .alert-icon-wrap .pi { font-size: 1.25rem; }
    .alert-card--warning .alert-icon-wrap .pi { color: var(--color-warning-600); }
    .alert-card--danger .alert-icon-wrap .pi { color: var(--color-error-600); }
    .alert-card--success .alert-icon-wrap .pi { color: var(--color-success-600); }
    .alert-card--info .alert-icon-wrap .pi { color: #2563eb; }
    .alert-content { flex: 1; }
    .alert-title { display: block; font-size: var(--font-size-sm); margin-bottom: var(--spacing-1); color: var(--color-text-primary); }
    .alert-message { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; }

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--spacing-4); margin-bottom: var(--spacing-6); }
    .kpi-skeleton { background: var(--color-background-elevated); border-radius: var(--radius-xl); height: 120px; border: 1px solid var(--color-border-subtle); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .section { background: var(--color-background-elevated); border-radius: var(--radius-xl); padding: var(--spacing-6); box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-subtle); margin-bottom: var(--spacing-6); }
    .section-header { margin-bottom: var(--spacing-5); padding-bottom: var(--spacing-4); border-bottom: 2px solid var(--color-border-subtle); }
    .section-title { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); margin: 0 0 var(--spacing-2); display: flex; align-items: center; gap: var(--spacing-2); }
    .section-title::before { content: ''; width: 4px; height: 20px; background: linear-gradient(180deg, #60a5fa, #3b82f6); border-radius: var(--radius-full); }
    .section-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--spacing-1); }
    .section-hint .pi { font-size: 0.75rem; opacity: 0.7; }

    .loading-spinner { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-3); padding: var(--spacing-8); color: var(--color-text-secondary); }
    .loading-spinner .pi { font-size: 2rem; }
    .empty-state { text-align: center; padding: var(--spacing-8); color: var(--color-text-secondary); }
    .empty-icon { font-size: 3rem; color: #3b82f6; margin-bottom: var(--spacing-3); }
    .empty-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--spacing-2); }
    .empty-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); }

    .supplier-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    .text-right { text-align: right; }
    .amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .rank-badge { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-full); font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); }
    .rank-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; }
    .rank-2 { background: linear-gradient(135deg, #9ca3af, #6b7280); color: white; }
    .rank-3 { background: linear-gradient(135deg, #d97706, #b45309); color: white; }
    .rank-default { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    :host ::ng-deep .analytics-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
      }
      .p-datatable-tbody > tr > td { padding: var(--spacing-4) var(--spacing-3); border-bottom: 1px solid var(--color-border-subtle); }
      .p-datatable-tbody > tr:hover { background: rgba(59, 130, 246, 0.06); }
    }
  `]
})
export class SuppliersAnalyticsComponent implements OnInit {
  private analyticsService = inject(PurchasesAnalyticsService);

  loading = signal(true);
  data = signal<SuppliersAnalyticsData | null>(null);
  selectedPeriod: PurchasesAnalyticsPeriod = 'month';

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
    this.analyticsService.loadSuppliersAnalyticsData(this.selectedPeriod).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value) + $localize`:@@ui.tern.tnd.9aaf5c: TND`;
  }

  onPrint(): void {
    window.print();
  }
}
