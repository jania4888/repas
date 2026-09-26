import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import { ReportsApiService, SalesRevenueReportRow } from '@core/services/reports-api.service';
import { RevenueTableComponent } from './revenue-table.component';

type GroupBy = 'Product' | 'Category' | 'ProductAndClient';

@Component({
  selector: 'app-sales-by-line-reports',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    RevenueTableComponent
  ],
  template: `
    <app-page-header
      title="Détails ventes par ligne produit" i18n-title="Détails ventes par ligne produit"
      subtitle="Chiffre d'affaires par produit, par catégorie et par client">
      <app-button variant="secondary" icon="pi-download" iconPos="left" (click)="onExport()" i18n="@@reports.sales-by-line.exporter.0cd84bdc">Exporter</app-button>
    </app-page-header>

    <div class="filter-section">
      <div class="filter-group">
        <label for="period" class="filter-label" i18n="@@reports.sales-by-line.periode.de2110b7">Période</label>
        <select id="period" [(ngModel)]="selectedPeriod" (ngModelChange)="onPeriodChange()" class="filter-select" aria-label="Période" i18n-aria-label="Période">
          @for (p of periodOptions; track p.value) {
            <option [value]="p.value">{{ p.label }}</option>
          }
        </select>
      </div>
    </div>

    <p-tabs class="ft-tabs" (valueChange)="onTabChange($event)" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0"><i class="pi pi-box"></i><span i18n="@@reports.sales-by-line.chiffre.d.affaires.par.produit.38290f0c">Chiffre d'affaires par produit</span></p-tab>
        <p-tab [value]="1"><i class="pi pi-tag"></i><span i18n="@@reports.sales-by-line.chiffre.d.affaires.par.categorie.9207c985">Chiffre d'affaires par catégorie</span></p-tab>
        <p-tab [value]="2"><i class="pi pi-users"></i><span i18n="@@reports.sales-by-line.chiffre.d.affaires.par.produit.par.client.15c9310e">Chiffre d'affaires par produit par client</span></p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <div class="tab-content">
          <app-revenue-table [rows]="revenueByProduct()" [loading]="loading()" [currency]="currency()" />
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="1">
        <div class="tab-content">
          <app-revenue-table [rows]="revenueByCategory()" [loading]="loading()" [currency]="currency()" />
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="2">
        <div class="tab-content">
          <app-revenue-table [rows]="revenueByProductClient()" [loading]="loading()" [currency]="currency()" [showClientColumn]="true" />
        </div>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <div class="back-link-wrap">
      <a routerLink="/reports" class="back-link" i18n="@@reports.sales-by-line.retour.aux.rapports.48320a4f">Retour aux rapports</a>
    </div>
  `,
  styles: [`
    .filter-section { margin-bottom: var(--spacing-6); }
    .filter-group { display: flex; align-items: center; gap: var(--spacing-4); }
    .filter-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
    .filter-select {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .tab-content { padding: var(--spacing-4) 0; }
    .back-link-wrap { margin-top: var(--spacing-6); }
    .back-link { color: var(--color-primary-600); font-weight: var(--font-weight-medium); }
  `]
})
export class SalesByLineReportsComponent implements OnInit {
  private reportsApi = inject(ReportsApiService);

  loading = signal(false);
  revenueByProduct = signal<SalesRevenueReportRow[]>([]);
  revenueByCategory = signal<SalesRevenueReportRow[]>([]);
  revenueByProductClient = signal<SalesRevenueReportRow[]>([]);
  currency = signal('TND');
  selectedPeriod: 'month' | 'quarter' | 'year' | 'all' = 'month';
  activeTabIndex = 0;

  periodOptions = [
    { label: 'Ce mois', value: 'month' },
    { label: 'Ce trimestre', value: 'quarter' },
    { label: 'Cette année', value: 'year' },
    { label: 'Tout', value: 'all' }
  ];

  private getPeriodDates(): { fromDate: string; toDate: string } {
    const to = new Date();
    const toDate = formatLocalDate(to);
    if (this.selectedPeriod === 'all') return { fromDate: '2020-01-01', toDate };
    const daysMap = { month: 30, quarter: 90, year: 365 } as const;
    const from = new Date();
    from.setDate(from.getDate() - daysMap[this.selectedPeriod]);
    return { fromDate: formatLocalDate(from), toDate };
  }

  ngOnInit(): void {
    this.loadAll();
  }

  onPeriodChange(): void {
    this.loadAll();
  }

  onTabChange(index: string | number): void {
    this.activeTabIndex = typeof index === 'number' ? index : Number(index);
  }

  private loadAll(): void {
    const { fromDate, toDate } = this.getPeriodDates();
    this.loading.set(true);
    let pending = 3;
    const maybeDone = () => { if (--pending === 0) this.loading.set(false); };
    this.reportsApi.getSalesRevenueByProduct(fromDate, toDate, 'Product').subscribe({
      next: (res) => {
        this.revenueByProduct.set(res.success && res.data ? res.data : []);
        if (res.data?.length) this.currency.set(res.data[0].currency ?? 'TND');
      },
      error: () => this.revenueByProduct.set([]),
      complete: maybeDone
    });
    this.reportsApi.getSalesRevenueByProduct(fromDate, toDate, 'Category').subscribe({
      next: (res) => this.revenueByCategory.set(res.success && res.data ? res.data : []),
      error: () => this.revenueByCategory.set([]),
      complete: maybeDone
    });
    this.reportsApi.getSalesRevenueByProduct(fromDate, toDate, 'ProductAndClient').subscribe({
      next: (res) => this.revenueByProductClient.set(res.success && res.data ? res.data : []),
      error: () => this.revenueByProductClient.set([]),
      complete: maybeDone
    });
  }

  onExport(): void {
    const rows = this.activeTabIndex === 0 ? this.revenueByProduct() : this.activeTabIndex === 1 ? this.revenueByCategory() : this.revenueByProductClient();
    const headers = this.activeTabIndex === 2 ? ['Produit', 'Client', 'Quantité', 'Chiffre d\'affaires', 'Devise'] : ['Libellé', 'Quantité', 'Chiffre d\'affaires', 'Devise'];
    const csvRows = [headers, ...rows.map(r => this.activeTabIndex === 2
      ? [r.groupKey, r.groupKey2 ?? '', r.quantity.toString(), r.revenue.toFixed(3), r.currency]
      : [r.groupKey, r.quantity.toString(), r.revenue.toFixed(3), r.currency])];
    const csv = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ca-ventes-ligne-${formatLocalDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
