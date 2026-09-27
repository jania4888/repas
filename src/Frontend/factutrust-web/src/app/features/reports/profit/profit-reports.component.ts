import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import { ReportsApiService, CommercialProfitReportRow } from '@core/services/reports-api.service';
import { ProfitTableComponent } from './profit-table.component';

@Component({
  selector: 'app-profit-reports',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    ProfitTableComponent
  ],
  template: `
    <app-page-header
      title="Rapport Bénéfices" i18n-title="Rapport Bénéfices"
      subtitle="Bénéfice commercial par pièce, mensuel, par ligne et par produit">
      <app-button variant="secondary" icon="pi-download" iconPos="left" (click)="onExport()" [disabled]="loading()" i18n="@@reports.profit.exporter.0cd84bdc"> Exporter </app-button>
    </app-page-header>

    <div class="filter-section">
      <div class="filter-group">
        <label for="period" class="filter-label" i18n="@@reports.profit.periode.de2110b7">Période</label>
        <select id="period" [(ngModel)]="selectedPeriod" (ngModelChange)="onPeriodChange()" class="filter-select" aria-label="Période" i18n-aria-label="Période">
          @for (p of periodOptions; track p.value) {
            <option [value]="p.value">{{ p.label }}</option>
          }
        </select>
      </div>
    </div>

    <p-tabs class="ft-tabs" (valueChange)="onTabChange($event)" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0"><i class="pi pi-list"></i><span i18n="@@reports.profit.par.ligne.26d2b61a">Par ligne</span></p-tab>
        <p-tab [value]="1"><i class="pi pi-box"></i><span i18n="@@reports.profit.par.produit.069de81b">Par produit</span></p-tab>
        <p-tab [value]="2"><i class="pi pi-calendar"></i><span i18n="@@reports.profit.mensuel.272c1b22">Mensuel</span></p-tab>
        <p-tab [value]="3"><i class="pi pi-file"></i><span i18n="@@reports.profit.par.piece.d152a853">Par pièce</span></p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <div class="tab-content">
          <app-profit-table
            [rows]="profitByLine()"
            [loading]="loading()"
            mode="line" />
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="1">
        <div class="tab-content">
          <app-profit-table
            [rows]="profitByProduct()"
            [loading]="loading()"
            mode="product" />
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="2">
        <div class="tab-content">
          <app-profit-table
            [rows]="profitByMonth()"
            [loading]="loading()"
            mode="month" />
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="3">
        <div class="tab-content">
          <app-profit-table
            [rows]="profitByPiece()"
            [loading]="loading()"
            mode="piece" />
        </div>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <div class="back-link-wrap">
      <a routerLink="/reports" class="back-link" i18n="@@reports.profit.retour.aux.rapports.48320a4f">Retour aux rapports</a>
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
export class ProfitReportsComponent implements OnInit {
  private reportsApi = inject(ReportsApiService);

  loading = signal(false);
  profitByPiece = signal<CommercialProfitReportRow[]>([]);
  profitByLine = signal<CommercialProfitReportRow[]>([]);
  profitByProduct = signal<CommercialProfitReportRow[]>([]);
  profitByMonth = signal<CommercialProfitReportRow[]>([]);
  selectedPeriod: 'month' | 'quarter' | 'year' | 'all' = 'month';
  activeTabIndex = 0;
  private requestSeq = 0;

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
    const seq = ++this.requestSeq;
    this.loading.set(true);

    // Reset datasets for a consistent UX while loading.
    this.profitByPiece.set([]);
    this.profitByLine.set([]);
    this.profitByProduct.set([]);
    this.profitByMonth.set([]);

    let pending = 4;
    const maybeDone = () => {
      pending--;
      if (pending === 0 && seq === this.requestSeq) {
        this.loading.set(false);
      }
    };

    this.reportsApi.getCommercialProfit(fromDate, toDate, 'Piece').subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.profitByPiece.set(res.success && res.data ? res.data : []);
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.profitByPiece.set([]);
      },
      complete: maybeDone
    });

    this.reportsApi.getCommercialProfit(fromDate, toDate, 'Line').subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.profitByLine.set(res.success && res.data ? res.data : []);
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.profitByLine.set([]);
      },
      complete: maybeDone
    });

    this.reportsApi.getCommercialProfit(fromDate, toDate, 'Product').subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.profitByProduct.set(res.success && res.data ? res.data : []);
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.profitByProduct.set([]);
      },
      complete: maybeDone
    });

    this.reportsApi.getCommercialProfit(fromDate, toDate, 'Month').subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.profitByMonth.set(res.success && res.data ? res.data : []);
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.profitByMonth.set([]);
      },
      complete: maybeDone
    });
  }

  onExport(): void {
    if (this.loading()) return;

    const rows =
      this.activeTabIndex === 0 ? this.profitByLine() :
        this.activeTabIndex === 1 ? this.profitByProduct() :
          this.activeTabIndex === 2 ? this.profitByMonth() :
            this.profitByPiece();

    const mode =
      this.activeTabIndex === 0 ? 'line' :
        this.activeTabIndex === 1 ? 'product' :
          this.activeTabIndex === 2 ? 'month' :
            'piece';

    const headers =
      mode === 'line'
        ? ['Produit', 'Facture', 'Date', 'Quantité', 'CA net HT', 'Coût', 'Bénéfice', 'Devise']
        : mode === 'product'
          ? ['Produit', 'Code', 'Quantité', 'CA net HT', 'Coût', 'Bénéfice', 'Devise']
          : mode === 'month'
            ? ['Période', 'Quantité', 'CA net HT', 'Coût', 'Bénéfice', 'Devise']
            : ['Facture', 'Date', 'Quantité', 'CA net HT', 'Coût', 'Bénéfice', 'Devise'];

    const csvRows = [headers, ...rows.map(r => {
      if (mode === 'piece') {
        return [
          r.invoiceNumber ?? '',
          r.issueDate ? new Date(r.issueDate).toLocaleDateString('fr-FR') : '',
          r.quantity.toString(),
          r.revenue.toFixed(3),
          r.cost.toFixed(3),
          r.profit.toFixed(3),
          r.currency
        ];
      }
      if (mode === 'line') {
        return [r.productName ?? '', r.invoiceNumber ?? '', r.issueDate ? new Date(r.issueDate).toLocaleDateString('fr-FR') : '', r.quantity.toString(), r.revenue.toFixed(3), r.cost.toFixed(3), r.profit.toFixed(3), r.currency];
      }
      if (mode === 'product') {
        return [r.productName ?? '', r.productCode ?? '', r.quantity.toString(), r.revenue.toFixed(3), r.cost.toFixed(3), r.profit.toFixed(3), r.currency];
      }
      return [r.period ?? '', r.quantity.toString(), r.revenue.toFixed(3), r.cost.toFixed(3), r.profit.toFixed(3), r.currency];
    })];
    const csv = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `benefices-${mode}-${formatLocalDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
