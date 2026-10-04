import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { StockService, Warehouse } from '@core/services/stock.service';
import { ProductCategoryService, ProductCategorySelect } from '@core/services/product-category.service';
import {
  ReportsApiService,
  StockStatusGroupingMode,
  StockStatusPdfError,
  StockStatusReportResult,
  StockStatusReportRow
} from '@core/services/reports-api.service';
import { formatLocalDate } from '@core/utils/date.util';
import { firstValueFrom } from 'rxjs';

interface StockStatusSubGroup {
  label: string;
  rows: StockStatusReportRow[];
  subQuantity: number;
  subValue: number;
}

interface StockStatusPrimaryGroup {
  label: string;
  subgroups: StockStatusSubGroup[];
  totalQuantity: number;
  totalValue: number;
}

@Component({
  selector: 'app-stock-status-report',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    SelectModule,
    CheckboxModule,
    ToastModule,
    PageHeaderComponent,
    ButtonComponent,
    StatCardComponent
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>
    <app-page-header
      title="État de stock" i18n-title="@@reports.stock-status.etat.de.stock.title"
      subtitle="Quantités et valeurs en stock actuelles, par entrepôt et par catégorie" i18n-subtitle="@@reports.stock-status.subtitle">
      <app-button variant="secondary" icon="pi-file-pdf" iconPos="left"
        [disabled]="loading() || printingPdf() || !hasData()" (click)="printPdf()"
        i18n="@@reports.stock-status.imprimer.pdf">Imprimer (PDF)</app-button>
      <app-button variant="secondary" icon="pi-download" iconPos="left"
        [disabled]="loading() || !hasData()" (click)="exportCsv()"
        i18n="@@reports.stock-status.exporter">Exporter</app-button>
    </app-page-header>

    <p class="snapshot-link">
      <a routerLink="/reports/stock" [queryParams]="{ section: 'snapshot' }" i18n="@@reports.stock-status.lien.snapshot">
        Besoin d'un état à une date antérieure ?
      </a>
    </p>

    <div class="ft-filters">
      <div class="filters-row">
        <label class="filter-label" for="warehouse" i18n="@@reports.stock-status.entrepot">Entrepôt</label>
        <p-select inputId="warehouse" [options]="warehouseOptions()" optionLabel="name" optionValue="id"
          [(ngModel)]="selectedWarehouseId" [showClear]="true" placeholder="Tous les entrepôts"
          i18n-placeholder="@@reports.stock-status.tous.entrepots" (ngModelChange)="reload()" styleClass="filter-select" />

        <label class="filter-label" for="category" i18n="@@reports.stock-status.categorie">Catégorie</label>
        <p-select inputId="category" [options]="categoryOptions()" optionLabel="name" optionValue="id"
          [(ngModel)]="selectedCategoryId" [showClear]="true" placeholder="Toutes les catégories"
          i18n-placeholder="@@reports.stock-status.toutes.categories" (ngModelChange)="reload()" styleClass="filter-select" />

        <label class="filter-label" for="search" i18n="@@reports.stock-status.recherche">Recherche</label>
        <input id="search" type="search" class="filter-input" [(ngModel)]="searchTerm" (change)="reload()" />

        <label class="filter-label grouping-label" for="grouping" i18n="@@reports.stock-status.regroupement">Regroupement</label>
        <p-select inputId="grouping" [options]="groupingOptions" optionLabel="label" optionValue="value"
          [(ngModel)]="groupingMode" (ngModelChange)="reload()" styleClass="filter-select" />

        <div class="zero-stock-check">
          <p-checkbox inputId="includeZero" [(ngModel)]="includeZeroStock" [binary]="true" (onChange)="reload()" />
          <label for="includeZero" i18n="@@reports.stock-status.inclure.zero">Inclure stock à zéro</label>
        </div>
      </div>
    </div>

    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else if (loadError()) {
      <div class="error-placeholder" role="alert">
        <p>{{ loadError() }}</p>
        <app-button variant="secondary" icon="pi-refresh" (click)="reload()" i18n="@@reports.stock-status.reessayer">Réessayer</app-button>
      </div>
    } @else if (report()) {
      <div class="stats-grid" role="status" aria-live="polite">
        <app-stat-card
          label="Valeur totale" i18n-label="@@reports.stock-status.valeur.totale"
          [value]="formatAmount(report()!.grandTotalValue) + ' ' + report()!.currency"
          icon="pi-dollar" variant="success" />
        <app-stat-card
          label="Quantité totale" i18n-label="@@reports.stock-status.quantite.totale"
          [value]="report()!.grandTotalQuantity"
          icon="pi-box" variant="primary" />
        <app-stat-card
          label="Lignes" i18n-label="@@reports.stock-status.lignes"
          [value]="report()!.totalRows"
          icon="pi-list" variant="primary" />
      </div>

      @if (!hasData()) {
        <div class="empty-placeholder" i18n="@@reports.stock-status.aucune.ligne">Aucun article en stock pour ces critères.</div>
      } @else if (useFlatTable()) {
        <p class="partial-hint" i18n="@@reports.stock-status.table.plate">Affichage paginé (nombreuses lignes).</p>
        <p-table [value]="report()!.rows" [paginator]="true" [rows]="pageSize" [totalRecords]="report()!.totalRows"
          [lazy]="true" [loading]="loading()" (onLazyLoad)="onPage($event)" styleClass="p-datatable-sm reports-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.stock-status.col.entrepot">Entrepôt</th>
              <th i18n="@@reports.stock-status.col.categorie">Catégorie</th>
              <th i18n="@@reports.stock-status.col.code">Code</th>
              <th i18n="@@reports.stock-status.col.designation">Désignation</th>
              <th class="text-right" i18n="@@reports.stock-status.col.qte">Qté</th>
              <th class="text-right" i18n="@@reports.stock-status.col.pu">P.U.</th>
              <th class="text-right" i18n="@@reports.stock-status.col.valeur">Valeur</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.warehouseName }}</td>
              <td>{{ row.categoryName }}</td>
              <td>{{ row.productCode }}</td>
              <td>{{ row.productName }}</td>
              <td class="text-right">{{ row.quantityOnHand | number:'1.0-3' }}</td>
              <td class="text-right">{{ row.unitCost | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.stockValue | number:'1.3-3' }} {{ report()!.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      } @else {
        @for (group of primaryGroups(); track group.label) {
          <section class="section">
            <h2 class="section-title">{{ group.label }}</h2>
            @for (sub of group.subgroups; track sub.label) {
              <div class="subgroup">
                <h3 class="subgroup-title">{{ sub.label }}</h3>
                <p-table [value]="sub.rows" styleClass="p-datatable-sm reports-table">
                  <ng-template pTemplate="header">
                    <tr>
                      <th i18n="@@reports.stock-status.col.code">Code</th>
                      <th i18n="@@reports.stock-status.col.designation">Désignation</th>
                      <th class="text-right" i18n="@@reports.stock-status.col.qte">Qté</th>
                      <th class="text-right" i18n="@@reports.stock-status.col.pu">P.U.</th>
                      <th class="text-right" i18n="@@reports.stock-status.col.valeur">Valeur</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td>{{ row.productCode }}</td>
                      <td>{{ row.productName }}</td>
                      <td class="text-right">{{ row.quantityOnHand | number:'1.0-3' }}</td>
                      <td class="text-right">{{ row.unitCost | number:'1.3-3' }}</td>
                      <td class="text-right amount">{{ row.stockValue | number:'1.3-3' }} {{ report()!.currency }}</td>
                    </tr>
                  </ng-template>
                </p-table>
                <div class="subtotal">
                  <span i18n="@@reports.stock-status.sous.total">Sous-total</span>
                  <span>{{ sub.subQuantity | number:'1.0-3' }} — {{ sub.subValue | number:'1.3-3' }} {{ report()!.currency }}</span>
                </div>
              </div>
            }
            <div class="group-total">
              <span i18n="@@reports.stock-status.total.groupe">Total</span>
              <span>{{ group.totalQuantity | number:'1.0-3' }} — {{ group.totalValue | number:'1.3-3' }} {{ report()!.currency }}</span>
            </div>
          </section>
        }
      }
    }
  `,
  styles: [`
    .snapshot-link { margin: 0 0 var(--spacing-4); font-size: var(--font-size-sm); }
    .snapshot-link a { color: var(--color-primary-600); }
    .ft-filters { margin-bottom: var(--spacing-6); }
    .filters-row { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: center; }
    .filter-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .filter-input { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); min-width: 160px; }
    .zero-stock-check { display: flex; align-items: center; gap: var(--spacing-2); margin-inline-start: var(--spacing-2); }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-4); margin-bottom: var(--spacing-6); }
    .stat-skeleton { height: 96px; border-radius: var(--radius-lg); background: var(--color-neutral-100); }
    .section { background: var(--color-background); border-radius: var(--radius-lg); padding: var(--spacing-5); margin-bottom: var(--spacing-5); box-shadow: var(--shadow-sm); }
    .section-title { font-size: var(--font-size-xl); margin: 0 0 var(--spacing-4); }
    .subgroup { margin-bottom: var(--spacing-4); }
    .subgroup-title { font-size: var(--font-size-md); margin: 0 0 var(--spacing-2); color: var(--color-text-secondary); }
    .subtotal, .group-total { display: flex; justify-content: space-between; font-size: var(--font-size-sm); padding: var(--spacing-2) 0; }
    .group-total { font-weight: var(--font-weight-bold); border-top: 1px solid var(--color-border-subtle); margin-top: var(--spacing-2); }
    .text-right { text-align: end; }
    .amount { font-weight: var(--font-weight-semibold); }
    .empty-placeholder, .error-placeholder { padding: var(--spacing-8); text-align: center; color: var(--color-text-secondary); }
    .partial-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-3); }
    @media (max-width: 768px) { .stats-grid { grid-template-columns: 1fr; } }
  `]
})
export class StockStatusReportComponent implements OnInit {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly stockService = inject(StockService);
  private readonly categoryService = inject(ProductCategoryService);
  private readonly printPreview = inject(PrintPreviewService);
  private readonly toast = inject(MessageService);

  loading = signal(false);
  printingPdf = signal(false);
  loadError = signal<string | null>(null);
  report = signal<StockStatusReportResult | null>(null);

  warehouseOptions = signal<Warehouse[]>([]);
  categoryOptions = signal<ProductCategorySelect[]>([]);

  selectedWarehouseId: string | null = null;
  selectedCategoryId: string | null = null;
  searchTerm = '';
  includeZeroStock = false;
  groupingMode: StockStatusGroupingMode = 'warehouse_then_category';

  page = 1;
  pageSize = 50;
  readonly flatTableThreshold = 200;

  groupingOptions = [
    { label: $localize`:@@reports.stock-status.mode.wh.cat:Par entrepôt puis catégorie`, value: 'warehouse_then_category' as StockStatusGroupingMode },
    { label: $localize`:@@reports.stock-status.mode.cat.wh:Par catégorie puis entrepôt`, value: 'category_then_warehouse' as StockStatusGroupingMode }
  ];

  primaryGroups = computed(() => {
    const data = this.report();
    if (!data?.rows?.length) return [];
    return buildPrimaryGroups(data.rows, this.groupingMode);
  });

  useFlatTable = computed(() => (this.report()?.totalRows ?? 0) > this.flatTableThreshold);

  ngOnInit(): void {
    this.stockService.getWarehouses().subscribe({
      next: res => this.warehouseOptions.set(res.data ?? []),
      error: () => this.warehouseOptions.set([])
    });
    this.categoryService.getProductCategories(true).subscribe({
      next: res => this.categoryOptions.set(res.data ?? []),
      error: () => this.categoryOptions.set([])
    });
    this.reload();
  }

  hasData(): boolean {
    return (this.report()?.totalRows ?? 0) > 0;
  }

  /**
   * Chiffres latins et 3 décimales. `fr-FR` est conservé : la locale hybride `ar-TN`
   * utilise les mêmes séparateurs, et `LOCALE_ID` vaut `fr-TN` en français, ce qui
   * changerait le regroupement déjà affiché sur cette carte.
   */
  formatAmount(value: number): string {
    return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  reload(resetPage = true): void {
    if (resetPage) this.page = 1;
    this.loading.set(true);
    this.loadError.set(null);

    const flat = this.report() && (this.report()!.totalRows > this.flatTableThreshold);
    const requestPageSize = flat ? this.pageSize : 50;

    this.reportsApi.getStockStatus({
      warehouseId: this.selectedWarehouseId,
      categoryId: this.selectedCategoryId,
      search: this.searchTerm,
      includeZeroStock: this.includeZeroStock,
      groupingMode: this.groupingMode,
      page: flat ? this.page : 1,
      pageSize: requestPageSize
    }).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) {
          this.loadError.set(res.message ?? $localize`:@@reports.stock-status.erreur.chargement:Impossible de charger l'état de stock.`);
          return;
        }
        const data = res.data;
        if (data.totalRows > this.flatTableThreshold) {
          this.report.set(data);
          return;
        }
        if (data.totalRows > data.rows.length) {
          this.fetchAllForGrouping(data).then(full => {
            this.report.set(full ?? data);
          });
        } else {
          this.report.set(data);
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set($localize`:@@reports.stock-status.erreur.chargement:Impossible de charger l'état de stock.`);
      }
    });
  }

  private async fetchAllForGrouping(initial: StockStatusReportResult): Promise<StockStatusReportResult | null> {
    const allRows = [...initial.rows];
    const chunk = 200;
    let page = 2;
    try {
      while (allRows.length < initial.totalRows) {
        const res = await firstValueFrom(this.reportsApi.getStockStatus({
          warehouseId: this.selectedWarehouseId,
          categoryId: this.selectedCategoryId,
          search: this.searchTerm,
          includeZeroStock: this.includeZeroStock,
          groupingMode: this.groupingMode,
          page,
          pageSize: chunk
        }));
        if (!res.success || !res.data?.rows.length) break;
        allRows.push(...res.data.rows);
        page++;
      }
      return { ...initial, rows: allRows };
    } catch {
      return null;
    }
  }

  onPage(event: TableLazyLoadEvent): void {
    const rows = event.rows ?? this.pageSize;
    const first = event.first ?? 0;
    this.page = rows ? Math.floor(first / rows) + 1 : 1;
    this.pageSize = rows;
    this.reload(false);
  }

  printPdf(): void {
    this.printingPdf.set(true);
    this.reportsApi.downloadStockStatusPdf({
      warehouseId: this.selectedWarehouseId,
      categoryId: this.selectedCategoryId,
      search: this.searchTerm,
      includeZeroStock: this.includeZeroStock,
      groupingMode: this.groupingMode
    }).subscribe({
      next: blob => {
        this.printingPdf.set(false);
        this.printPreview.openPdfForPrintPreview(blob, `Etat_stock_${formatLocalDate(new Date())}.pdf`);
      },
      error: err => {
        this.printingPdf.set(false);
        const pdfError = err instanceof StockStatusPdfError ? err : null;
        const msg = pdfError?.message
          ?? err?.message
          ?? $localize`:@@reports.stock-status.pdf.error:Impossible de générer le PDF`;
        this.toast.add({
          severity: pdfError?.code === 'NoData' ? 'info' : 'error',
          summary: $localize`:@@reports.stock-status.information:Information`,
          detail: msg
        });
      }
    });
  }

  exportCsv(): void {
    const data = this.report();
    if (!data?.rows?.length) return;

    const loadRows = data.totalRows <= data.rows.length
      ? Promise.resolve(data.rows)
      : this.fetchAllForGrouping(data).then(r => r?.rows ?? data.rows);

    loadRows.then(rows => {
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const header = [
        $localize`:@@reports.stock-status.col.entrepot:Entrepôt`,
        $localize`:@@reports.stock-status.col.categorie:Catégorie`,
        $localize`:@@reports.stock-status.col.code:Code`,
        $localize`:@@reports.stock-status.col.designation:Désignation`,
        $localize`:@@reports.stock-status.col.qte:Qté`,
        $localize`:@@reports.stock-status.col.pu:P.U.`,
        $localize`:@@reports.stock-status.col.valeur:Valeur`,
        $localize`:@@reports.stock-status.col.devise:Devise`
      ];
      const lines = [
        header.join(';'),
        ...rows.map(row =>
          [
            row.warehouseName,
            row.categoryName,
            row.productCode,
            row.productName,
            row.quantityOnHand,
            row.unitCost,
            row.stockValue,
            data.currency
          ].map(c => escape(String(c))).join(';'))
      ];
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Etat_stock_${formatLocalDate(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

function buildPrimaryGroups(rows: StockStatusReportRow[], mode: StockStatusGroupingMode): StockStatusPrimaryGroup[] {
  const primaryKey = mode === 'category_then_warehouse'
    ? (r: StockStatusReportRow) => r.categoryName
    : (r: StockStatusReportRow) => r.warehouseName;
  const secondaryKey = mode === 'category_then_warehouse'
    ? (r: StockStatusReportRow) => r.warehouseName
    : (r: StockStatusReportRow) => r.categoryName;

  const primaryMap = new Map<string, Map<string, StockStatusReportRow[]>>();
  for (const row of rows) {
    const p = primaryKey(row);
    const s = secondaryKey(row);
    if (!primaryMap.has(p)) primaryMap.set(p, new Map());
    const sub = primaryMap.get(p)!;
    if (!sub.has(s)) sub.set(s, []);
    sub.get(s)!.push(row);
  }

  return [...primaryMap.entries()].map(([label, subMap]) => {
    const subgroups: StockStatusSubGroup[] = [...subMap.entries()].map(([subLabel, subRows]) => ({
      label: subLabel,
      rows: subRows,
      subQuantity: subRows.reduce((a, r) => a + r.quantityOnHand, 0),
      subValue: subRows.reduce((a, r) => a + r.stockValue, 0)
    }));
    return {
      label,
      subgroups,
      totalQuantity: subgroups.reduce((a, g) => a + g.subQuantity, 0),
      totalValue: subgroups.reduce((a, g) => a + g.subValue, 0)
    };
  });
}
