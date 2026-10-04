import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { EMPTY, Subject, Subscription, finalize, switchMap } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { formatLocalDate } from '@core/utils/date.util';
import { parseLocalDateString, validateDateRange } from '@features/accounting/shared/accounting-date-utils';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  PurchasesJournalPdfError,
  ReportsApiService,
  PurchasesJournalAggregatedRow,
  PurchasesJournalDetailRow,
  PurchasesJournalReportResult,
  PurchasesJournalSource,
  SalesJournalViewMode
} from '@core/services/reports-api.service';

interface SourceOption {
  label: string;
  value: PurchasesJournalSource;
}

@Component({
  selector: 'app-purchases-journal-reports',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    SelectModule,
    TabsModule,
    ToastModule,
    PageHeaderComponent,
    ButtonComponent,
    TableTotalsBarComponent,
    SkeletonTableComponent
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>
    <app-page-header
      title="Journal d'achats" i18n-title="@@reports.purchases-journal.title.a1b2c3d4"
      subtitle="Journal commercial des lignes (factures fournisseur ou bons de réception) — distinct du journal comptable JA. Les deux sources ne se cumulent pas." i18n-subtitle="@@reports.purchases-journal.subtitle.ja.e5f6g7h8">
      <app-button variant="secondary" icon="pi-file-pdf" iconPos="left"
        [disabled]="loading() || initialLoad() || printingPdf()" (click)="printPdf()" i18n="@@reports.purchases-journal.imprimer.pdf.i9j0k1l2">
        Imprimer (PDF)
      </app-button>
      <app-button variant="secondary" icon="pi-download" iconPos="left"
        [disabled]="loading() || initialLoad() || !hasData()" (click)="exportCsv()" i18n="@@reports.purchases-journal.exporter.csv.m3n4o5p6">
        Exporter
      </app-button>
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__row filters-row">
        <span class="filter-field">
          <label class="filter-label" for="fromDate" i18n="@@reports.purchases-journal.du.7a8b9c0d">Du</label>
          <input id="fromDate" type="date" class="filter-input" [(ngModel)]="fromStr" (change)="reload()" />
        </span>
        <span class="filter-field">
          <label class="filter-label" for="toDate" i18n="@@reports.purchases-journal.au.1e2f3a4b">Au</label>
          <input id="toDate" type="date" class="filter-input" [(ngModel)]="toStr" (change)="reload()" />
        </span>
        <span class="filter-field">
          <label class="filter-label" for="source" i18n="@@reports.purchases-journal.source.2a3b4c5d">Source</label>
          <p-select inputId="source" [options]="sourceOptions" optionLabel="label" optionValue="value"
            [(ngModel)]="selectedSource" (ngModelChange)="reload()" styleClass="source-select" />
        </span>
        <span class="filter-field">
          <label class="filter-label" for="supplier" i18n="@@reports.purchases-journal.fournisseur.5c6d7e8f">Fournisseur</label>
          <p-select inputId="supplier" [options]="supplierOptions()" optionLabel="name" optionValue="id"
            [(ngModel)]="selectedSupplierId" [showClear]="true" placeholder="Tous les fournisseurs" i18n-placeholder="@@reports.purchases-journal.tous.fournisseurs.9a0b1c2d"
            (ngModelChange)="reload()" styleClass="supplier-select" />
        </span>
      </div>
    </div>

    <p-tabs class="ft-tabs" [value]="viewModeTab()" (valueChange)="onViewModeChange($event)">
      <p-tablist>
        <p-tab [value]="0"><span i18n="@@reports.purchases-journal.detail.3d4e5f60">Détail</span></p-tab>
        <p-tab [value]="1"><span i18n="@@reports.purchases-journal.par.jour.7e8f9a01">Par jour</span></p-tab>
        <p-tab [value]="2"><span i18n="@@reports.purchases-journal.par.mois.2b3c4d5e">Par mois</span></p-tab>
        <p-tab [value]="3"><span i18n="@@reports.purchases-journal.par.annee.6f7a8b9c">Par année</span></p-tab>
      </p-tablist>
      <p-tabpanels>
        <p-tabpanel [value]="viewModeTab()">
          <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading() || initialLoad()"></app-table-totals-bar>
          @if (initialLoad()) {
            <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
          } @else if (loadError()) {
            <div class="error-placeholder" role="alert">
              <p>{{ loadError() }}</p>
              <app-button variant="secondary" icon="pi-refresh" iconPos="left" (click)="reload()"
                i18n="@@reports.purchases-journal.reessayer.a1b2c3d4">Réessayer</app-button>
            </div>
          } @else if (!hasData()) {
            <div class="empty-placeholder" i18n="@@reports.purchases-journal.aucune.ligne.0d1e2f3a">Aucune ligne d'achat sur cette période.</div>
          } @else if (isDetailMode()) {
            <p-table [value]="detailRows()" [paginator]="true" [rows]="pageSize" [totalRecords]="totalRows()"
              [lazy]="true" [lazyLoadOnInit]="false" [loading]="loading()"
              (onLazyLoad)="onPage($event)" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@reports.purchases-journal.date.4e5f6071">Date</th>
                  <th>{{ documentColumnLabel() }}</th>
                  <th i18n="@@reports.purchases-journal.type.2e3f4a5b">Type</th>
                  <th i18n="@@reports.purchases-journal.fournisseur.col.6c7d8e9f">Fournisseur</th>
                  <th i18n="@@reports.purchases-journal.code.1a2b3c4d">Code</th>
                  <th i18n="@@reports.purchases-journal.produit.5e6f7a8b">Produit</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.qte.9c0d1e2f">Qté</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.pu.3a4b5c6d">P.U.</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.ht.7e8f9a0b">HT</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.tva.1c2d3e4f">TVA</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.ttc.5a6b7c8d">TTC</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td>{{ row.entryDate | date:'dd/MM/yyyy' }}</td>
                  <td><a [routerLink]="documentLink(row)">{{ row.documentNumber }}</a></td>
                  <td>{{ documentKindLabel(row.documentKind) }}</td>
                  <td>{{ row.supplierName }}</td>
                  <td>{{ row.productCode }}</td>
                  <td>{{ row.productName }}</td>
                  <td class="text-end erp-amount">{{ row.quantity | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.unitPrice | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.lineSubTotal | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.vatAmount | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.lineTotal | number:'1.3-3' }} {{ row.currency }}</td>
                </tr>
              </ng-template>
            </p-table>
          } @else {
            <p-table [value]="aggregatedRows()" [paginator]="true" [rows]="pageSize" [totalRecords]="totalRows()"
              [lazy]="true" [lazyLoadOnInit]="false" [loading]="loading()"
              (onLazyLoad)="onPage($event)" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@reports.purchases-journal.periode.0e1f2a3b">Période</th>
                  <th i18n="@@reports.purchases-journal.fournisseur.col.6c7d8e9f">Fournisseur</th>
                  <th i18n="@@reports.purchases-journal.code.1a2b3c4d">Code</th>
                  <th i18n="@@reports.purchases-journal.produit.5e6f7a8b">Produit</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.qte.9c0d1e2f">Qté</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.ht.7e8f9a0b">HT</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.tva.1c2d3e4f">TVA</th>
                  <th class="text-end" i18n="@@reports.purchases-journal.ttc.5a6b7c8d">TTC</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td>{{ row.periodKey }}</td>
                  <td>{{ row.supplierName }}</td>
                  <td>{{ row.productCode }}</td>
                  <td>{{ row.productName }}</td>
                  <td class="text-end erp-amount">{{ row.quantity | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.lineSubTotal | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.vatAmount | number:'1.3-3' }}</td>
                  <td class="text-end erp-amount">{{ row.lineTotal | number:'1.3-3' }} {{ row.currency }}</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <div class="back-link-wrap">
      <a routerLink="/reports" class="back-link" i18n="@@reports.purchases-journal.retour.4b5c6d7e">Retour aux rapports</a>
    </div>
  `,
  styles: [`
    .filters-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-3); }
    .filter-field { display: inline-flex; align-items: center; gap: var(--spacing-2); }
    .filter-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .filter-input { padding: var(--spacing-2); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); }
    .supplier-select, .source-select { min-width: 220px; }
    .text-end { text-align: end; }
    .empty-placeholder, .error-placeholder { padding: var(--spacing-8); text-align: center; color: var(--color-text-secondary); }
    .error-placeholder p { margin-bottom: var(--spacing-4); color: var(--color-text-primary); }
    .back-link-wrap { margin-top: var(--spacing-6); }
    .back-link { color: var(--color-primary-600); }
  `]
})
export class PurchasesJournalReportsComponent implements OnInit, OnDestroy {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly supplierService = inject(SupplierService);
  private readonly printPreview = inject(PrintPreviewService);
  private readonly toast = inject(MessageService);
  private readonly errorHandler = inject(ErrorHandlerService);

  private readonly reloadTrigger$ = new Subject<{ resetPage: boolean }>();
  private subscriptions = new Subscription();
  private initialLoadDone = false;
  private isFirstLazyLoad = true;

  loading = signal(false);
  initialLoad = signal(true);
  loadError = signal<string | null>(null);
  printingPdf = signal(false);
  result = signal<PurchasesJournalReportResult | null>(null);
  supplierOptions = signal<SupplierListItem[]>([]);

  sourceOptions: SourceOption[] = [
    { label: $localize`:@@reports.purchases-journal.source.invoice:Factures fournisseur`, value: 'Invoice' },
    { label: $localize`:@@reports.purchases-journal.source.receipt:Bons de réception`, value: 'Receipt' }
  ];

  fromStr = formatLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  toStr = formatLocalDate(new Date());
  selectedSupplierId: string | null = null;
  selectedSource: PurchasesJournalSource = 'Invoice';
  viewModeTab = signal(0);
  page = 1;
  pageSize = 50;

  skeletonColumns: SkeletonColumn[] = [
    { width: '90px' },
    { width: '100px' },
    { width: '60px' },
    { width: '140px' },
    { width: '80px' },
    { width: '160px' },
    { width: '70px' },
    { width: '70px' },
    { width: '80px' },
    { width: '80px' },
    { width: '100px' }
  ];

  detailRows = () => this.result()?.detailRows ?? [];
  aggregatedRows = () => this.result()?.aggregatedRows ?? [];
  totalRows = () => this.result()?.totalRows ?? 0;
  isDetailMode = () => this.viewModeTab() === 0;
  hasData = () => this.totalRows() > 0;

  documentColumnLabel = () =>
    this.selectedSource === 'Receipt'
      ? $localize`:@@reports.purchases-journal.bon.reception.8a9b0c1d:Bon de réception`
      : $localize`:@@reports.purchases-journal.facture.8a9b0c1e:Facture`;

  documentKindLabel(kind: string): string {
    return kind === 'BR'
      ? $localize`:@@reports.purchases-journal.bon.reception.8a9b0c1d:Bon de réception`
      : $localize`:@@reports.purchases-journal.facture.8a9b0c1e:Facture`;
  }

  documentLink(row: PurchasesJournalDetailRow): string[] {
    return row.documentKind === 'BR'
      ? ['/purchase-receipts', row.documentId]
      : ['/supplier-invoices', row.documentId];
  }

  summaryMetrics = () => {
    const t = this.result()?.totals;
    const cur = t?.currency ?? 'TND';
    if (!t) return [];
    return [
      { label: $localize`:@@reports.purchases-journal.total.qte.8d9e0f1a:Total quantité`, value: t.quantity, format: 'number' as const },
      { label: $localize`:@@reports.purchases-journal.total.ht.2a3b4c5d:Total HT`, value: t.lineSubTotal, format: 'currency' as const, currency: cur },
      { label: $localize`:@@reports.purchases-journal.total.tva.6e7f8a9b:Total TVA`, value: t.vatAmount, format: 'currency' as const, currency: cur },
      { label: $localize`:@@reports.purchases-journal.total.ttc.0c1d2e3f:Total TTC`, value: t.lineTotal, format: 'currency' as const, currency: cur }
    ];
  };

  ngOnInit(): void {
    this.subscriptions.add(
      this.supplierService.getActiveSuppliers().subscribe({
        next: res => this.supplierOptions.set(res.success && res.data ? res.data.items : [])
      })
    );

    this.subscriptions.add(
      this.reloadTrigger$.pipe(
        switchMap(({ resetPage }) => {
          if (resetPage) this.page = 1;
          const from = parseLocalDateString(this.fromStr);
          const to = parseLocalDateString(this.toStr);
          const range = validateDateRange(from, to);
          if (!range.valid) {
            this.loadError.set(range.message ?? $localize`:@@reports.purchases-journal.dates.invalides.b2c3d4e5:Dates invalides.`);
            this.result.set(null);
            this.loading.set(false);
            this.initialLoad.set(false);
            this.initialLoadDone = true;
            return EMPTY;
          }

          this.loadError.set(null);
          this.loading.set(true);
          return this.reportsApi.getPurchasesJournal({
            from: this.fromStr,
            to: this.toStr,
            viewMode: this.viewMode(),
            source: this.selectedSource,
            supplierId: this.selectedSupplierId,
            page: this.page,
            pageSize: this.pageSize
          }).pipe(
            finalize(() => {
              this.loading.set(false);
              this.initialLoad.set(false);
              this.initialLoadDone = true;
            })
          );
        })
      ).subscribe({
        next: res => {
          if (res.success && res.data) {
            this.loadError.set(null);
            this.result.set(res.data);
          } else {
            const msg =
              res.errors?.join(', ') ??
              $localize`:@@reports.purchases-journal.chargement.echoue.c6d7e8f9:Impossible de charger le journal d'achats.`;
            this.loadError.set(msg);
            this.result.set(null);
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@reports.purchases-journal.erreur.chargement.d0e1f2a3:Erreur`,
              detail: msg
            });
          }
        },
        error: err => {
          const msg =
            this.errorHandler.extractErrorMessage(err) ??
            $localize`:@@reports.purchases-journal.chargement.echoue.c6d7e8f9:Impossible de charger le journal d'achats.`;
          this.loadError.set(msg);
          this.result.set(null);
        }
      })
    );

    this.reload();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.reloadTrigger$.complete();
  }

  onViewModeChange(tab: string | number): void {
    const n = typeof tab === 'number' ? tab : Number(tab);
    if (Number.isNaN(n)) return;
    this.viewModeTab.set(n);
    this.page = 1;
    this.isFirstLazyLoad = true;
    this.reload();
  }

  onPage(event: TableLazyLoadEvent): void {
    const rows = event.rows ?? this.pageSize;
    const first = event.first ?? 0;
    const nextPage = rows ? Math.floor(first / rows) + 1 : 1;

    if (nextPage === this.page && rows === this.pageSize) {
      return;
    }

    if (this.isFirstLazyLoad && first === 0 && this.initialLoadDone) {
      this.isFirstLazyLoad = false;
      return;
    }

    this.page = nextPage;
    this.pageSize = rows;
    this.reload(false);
    this.isFirstLazyLoad = false;
  }

  private viewMode(): SalesJournalViewMode {
    const map: SalesJournalViewMode[] = ['Detail', 'Day', 'Month', 'Year'];
    return map[this.viewModeTab()] ?? 'Detail';
  }

  reload(resetPage = true): void {
    this.reloadTrigger$.next({ resetPage });
  }

  printPdf(): void {
    this.printingPdf.set(true);
    this.reportsApi.downloadPurchasesJournalPdf({
      from: this.fromStr,
      to: this.toStr,
      viewMode: this.viewMode(),
      source: this.selectedSource,
      supplierId: this.selectedSupplierId
    }).subscribe({
      next: blob => {
        this.printingPdf.set(false);
        this.printPreview.openPdfForPrintPreview(blob, 'Journal_achats.pdf');
      },
      error: err => {
        this.printingPdf.set(false);
        const pdfError = err instanceof PurchasesJournalPdfError ? err : null;
        const msg = pdfError?.message
          ?? err?.message
          ?? $localize`:@@reports.purchases-journal.pdf.error.1f2e3d4c:Impossible de générer le PDF`;
        this.toast.add({
          severity: pdfError?.code === 'NoData' ? 'info' : 'error',
          summary: $localize`:@@reports.purchases-journal.information.5a6b7c8d:Information`,
          detail: msg
        });
      }
    });
  }

  exportCsv(): void {
    if (!this.hasData()) return;
    this.fetchAllRowsForExport().then(rows => {
      if (rows === null) {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@reports.purchases-journal.erreur.export.e4f5a6b7:Erreur`,
          detail: $localize`:@@reports.purchases-journal.export.interrompu.c8d9e0f1:L'export CSV n'a pas pu être complété. Réessayez ou réduisez la période.`
        });
        return;
      }
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      let lines: string[] = [];
      if (this.isDetailMode()) {
        const detail = rows as PurchasesJournalDetailRow[];
        lines = [
          [
            $localize`:@@reports.purchases-journal.csv.date:Date`,
            $localize`:@@reports.purchases-journal.csv.piece:Pièce`,
            $localize`:@@reports.purchases-journal.csv.type:Type`,
            $localize`:@@reports.purchases-journal.csv.supplier:Fournisseur`,
            $localize`:@@reports.purchases-journal.csv.code:Code`,
            $localize`:@@reports.purchases-journal.csv.product:Produit`,
            $localize`:@@reports.purchases-journal.csv.qty:Qté`,
            $localize`:@@reports.purchases-journal.csv.pu:PU`,
            $localize`:@@reports.purchases-journal.csv.ht:HT`,
            $localize`:@@reports.purchases-journal.csv.tva:TVA`,
            $localize`:@@reports.purchases-journal.csv.ttc:TTC`,
            $localize`:@@reports.purchases-journal.csv.currency:Devise`
          ].join(';'),
          ...detail.map(row =>
            [row.entryDate, row.documentNumber, this.documentKindLabel(row.documentKind), row.supplierName, row.productCode, row.productName,
              row.quantity, row.unitPrice, row.lineSubTotal, row.vatAmount, row.lineTotal, row.currency]
              .map(c => escape(String(c))).join(';'))
        ];
      } else {
        const agg = rows as PurchasesJournalAggregatedRow[];
        lines = [
          [
            $localize`:@@reports.purchases-journal.csv.period:Période`,
            $localize`:@@reports.purchases-journal.csv.supplier:Fournisseur`,
            $localize`:@@reports.purchases-journal.csv.code:Code`,
            $localize`:@@reports.purchases-journal.csv.product:Produit`,
            $localize`:@@reports.purchases-journal.csv.qty:Qté`,
            $localize`:@@reports.purchases-journal.csv.ht:HT`,
            $localize`:@@reports.purchases-journal.csv.tva:TVA`,
            $localize`:@@reports.purchases-journal.csv.ttc:TTC`,
            $localize`:@@reports.purchases-journal.csv.currency:Devise`
          ].join(';'),
          ...agg.map(row =>
            [row.periodKey, row.supplierName, row.productCode, row.productName,
              row.quantity, row.lineSubTotal, row.vatAmount, row.lineTotal, row.currency]
              .map(c => escape(String(c))).join(';'))
        ];
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `journal-achats-${formatLocalDate(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  private async fetchAllRowsForExport(): Promise<PurchasesJournalDetailRow[] | PurchasesJournalAggregatedRow[] | null> {
    const pageSize = 200;
    const total = this.totalRows();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const all: (PurchasesJournalDetailRow | PurchasesJournalAggregatedRow)[] = [];
    for (let p = 1; p <= pages; p++) {
      const res = await new Promise<PurchasesJournalReportResult | null>(resolve => {
        this.reportsApi.getPurchasesJournal({
          from: this.fromStr,
          to: this.toStr,
          viewMode: this.viewMode(),
          source: this.selectedSource,
          supplierId: this.selectedSupplierId,
          page: p,
          pageSize
        }).subscribe({
          next: r => resolve(r.success && r.data ? r.data : null),
          error: () => resolve(null)
        });
      });
      if (!res) return null;
      if (this.isDetailMode()) all.push(...(res.detailRows ?? []));
      else all.push(...(res.aggregatedRows ?? []));
    }
    return all as PurchasesJournalDetailRow[] | PurchasesJournalAggregatedRow[];
  }
}
