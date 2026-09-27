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
  OrdersAnalyticsData
} from '../../services/purchases-analytics.service';

@Component({
  selector: 'app-orders-analytics',
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
      title="Analyse des commandes" i18n-title="Analyse des commandes"
      subtitle="Taux de conversion bons de commande → facture, délais et panier moyen">
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
        <div class="kpi-skeleton"></div>
      </div>
    } @else if (data()) {
      <div class="kpi-grid">
        <app-stat-card
          label="Taux de conversion" i18n-label="Taux de conversion"
          [value]="data()!.conversionRate.toFixed(1) + ' %'"
          icon="pi-sync"
          [variant]="data()!.conversionRate >= 50 ? 'success' : data()!.conversionRate >= 30 ? 'warning' : 'primary'">
        </app-stat-card>
        <app-stat-card
          label="Bons de commande" i18n-label="Bons de commande"
          [value]="data()!.totalOrders"
          icon="pi-file-edit"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Facturés" i18n-label="Facturés"
          [value]="data()!.invoicedOrders"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Panier moyen (commande)" i18n-label="Panier moyen (commande)"
          [value]="formatAmount(data()!.averageOrderAmount)"
          icon="pi-shopping-cart"
          variant="warning">
        </app-stat-card>
      </div>
    }

    @if (!loading() && data()) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.transformation.bon.de.commande.facture.c5de5897">Transformation bon de commande → facture</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Proportion des commandes ayant donné lieu à une facture fournisseur
          </span>
        </div>
        <div class="conversion-visual">
          <div class="conversion-bar-wrapper">
            <div
              class="conversion-bar"
              [style.width.%]="data()!.conversionRate"
              [attr.aria-valuenow]="data()!.conversionRate"
              aria-valuemin="0"
              aria-valuemax="100"
              role="progressbar">
            </div>
          </div>
          <p class="conversion-label">{{ data()!.invoicedOrders }} / {{ data()!.totalOrders }} commandes facturées</p>
        </div>
      </div>
    }

    <div class="reports-grid">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.commandes.par.statut.0f600a16">Commandes par statut</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Répartition des bons de commande sur la période
          </span>
        </div>
        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases-analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.ordersByStatus?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-info-circle"></i>
            <p i18n="@@reports.purchases-analytics.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          </div>
        } @else {
          <div class="status-list">
            @for (item of data()!.ordersByStatus; track item.status) {
              <div class="status-row">
                <span class="status-label">{{ item.status }}</span>
                <span class="status-count">{{ item.count }}</span>
              </div>
            }
          </div>
        }
      </div>
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.top.fournisseurs.commandes.68ee4399">Top fournisseurs (commandes)</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Par nombre de bons de commande
          </span>
        </div>
        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases-analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.topSuppliersByOrders?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-building"></i>
            <p i18n="@@reports.purchases-analytics.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          </div>
        } @else {
          <p-table
            [value]="data()!.topSuppliersByOrders"
            styleClass="p-datatable-sm analytics-table"
            aria-label="Fournisseurs par nombre de commandes" i18n-aria-label="Fournisseurs par nombre de commandes">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@reports.purchases-analytics.fournisseur.97d91d89">Fournisseur</th>
                <th class="text-right" i18n="@@reports.purchases-analytics.commandes.17275970">Commandes</th>
                <th class="text-right" i18n="@@reports.purchases-analytics.montant.total.dd001537">Montant total</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td><span class="supplier-name">{{ row.supplierName }}</span></td>
                <td class="text-right">{{ row.orderCount }}</td>
                <td class="text-right amount">{{ row.totalAmount | number:'1.3-3' }} {{ data()!.currency }}</td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>
    </div>

    @if (!loading() && data()) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases-analytics.montants.moyens.9037e619">Montants moyens</h2>
        </div>
        <div class="summary-cards">
          <div class="summary-item">
            <div class="summary-icon-wrap primary">
              <i class="pi pi-shopping-cart"></i>
            </div>
            <div class="summary-content">
              <span class="summary-label" i18n="@@reports.purchases-analytics.panier.moyen.commande.5b2d0d4c">Panier moyen (commande)</span>
              <span class="summary-value">{{ formatAmount(data()!.averageOrderAmount) }}</span>
              <span class="summary-desc" i18n="@@reports.purchases-analytics.montant.moyen.par.bon.de.commande.54f46d8e">Montant moyen par bon de commande</span>
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-icon-wrap success">
              <i class="pi pi-file"></i>
            </div>
            <div class="summary-content">
              <span class="summary-label" i18n="@@reports.purchases-analytics.panier.moyen.facture.payee.80fc8ecb">Panier moyen (facture payée)</span>
              <span class="summary-value">{{ formatAmount(data()!.averageInvoiceAmount) }}</span>
              <span class="summary-desc" i18n="@@reports.purchases-analytics.montant.moyen.par.facture.fournisseur.payee.97e31534">Montant moyen par facture fournisseur payée</span>
            </div>
          </div>
        </div>
      </div>
    }
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

    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-4); margin-bottom: var(--spacing-6); }
    .kpi-skeleton { background: var(--color-background-elevated); border-radius: var(--radius-xl); height: 120px; border: 1px solid var(--color-border-subtle); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .section { background: var(--color-background-elevated); border-radius: var(--radius-xl); padding: var(--spacing-6); box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-subtle); margin-bottom: var(--spacing-6); }
    .section-header { margin-bottom: var(--spacing-5); padding-bottom: var(--spacing-4); border-bottom: 2px solid var(--color-border-subtle); }
    .section-title { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); margin: 0 0 var(--spacing-2); display: flex; align-items: center; gap: var(--spacing-2); }
    .section-title::before { content: ''; width: 4px; height: 20px; background: linear-gradient(180deg, #60a5fa, #3b82f6); border-radius: var(--radius-full); }
    .section-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--spacing-1); }
    .section-hint .pi { font-size: 0.75rem; opacity: 0.7; }

    .conversion-visual { padding: var(--spacing-4) 0; }
    .conversion-bar-wrapper { height: 24px; background: var(--color-neutral-100); border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--spacing-2); }
    .conversion-bar { height: 100%; background: linear-gradient(90deg, #60a5fa, #3b82f6); border-radius: var(--radius-full); transition: width 0.8s ease; }
    .conversion-label { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }

    .reports-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-6); margin-bottom: var(--spacing-6); }
    .status-list { display: flex; flex-direction: column; gap: var(--spacing-2); }
    .status-row { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-lg); background: var(--color-neutral-50); border: 1px solid var(--color-border-subtle); }
    .status-label { font-size: var(--font-size-sm); color: var(--color-text-primary); }
    .status-count { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }

    .supplier-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    .text-right { text-align: right; }
    .amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }

    .loading-spinner { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-3); padding: var(--spacing-8); color: var(--color-text-secondary); }
    .empty-state-sm { text-align: center; padding: var(--spacing-6); color: var(--color-text-secondary); }
    .empty-state-sm .pi { font-size: 2rem; margin-bottom: var(--spacing-2); }

    .summary-cards { display: flex; flex-direction: column; gap: var(--spacing-4); }
    .summary-item { display: flex; gap: var(--spacing-4); padding: var(--spacing-4); border-radius: var(--radius-lg); border: 1px solid var(--color-border-subtle); background: var(--color-neutral-50); }
    .summary-icon-wrap { width: 44px; height: 44px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.1rem; }
    .summary-icon-wrap.primary { background: rgba(59, 130, 246, 0.15); color: #2563eb; }
    .summary-icon-wrap.success { background: var(--color-success-100); color: var(--color-success-700); }
    .summary-content { display: flex; flex-direction: column; }
    .summary-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-value { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text-primary); font-family: 'JetBrains Mono', monospace; }
    .summary-desc { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: var(--spacing-1); }

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

    @media (max-width: 1024px) { .reports-grid { grid-template-columns: 1fr; } }
  `]
})
export class OrdersAnalyticsComponent implements OnInit {
  private analyticsService = inject(PurchasesAnalyticsService);

  loading = signal(true);
  data = signal<OrdersAnalyticsData | null>(null);
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
    this.analyticsService.loadOrdersAnalyticsData(this.selectedPeriod).subscribe({
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
