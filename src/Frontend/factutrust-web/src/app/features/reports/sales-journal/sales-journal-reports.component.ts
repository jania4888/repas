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
import { ClientService, ClientListItem } from '@core/services/client.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  ReportsApiService,
  SalesJournalAggregatedRow,
  SalesJournalDetailRow,
  SalesJournalReportResult,
  SalesJournalViewMode
} from '@core/services/reports-api.service';

@Component({
  selector: 'app-sales-journal-reports',
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
      title="Journal de ventes" i18n-title="@@reports.sales-journal.journal.de.ventes.a1b2c3d4"
      subtitle="Journal commercial des lignes de factures (FAC et AVO) — distinct du journal comptable JV." i18n-subtitle="@@reports.sales-journal.subtitle.commercial.jv.e5f6g7h8">
      <app-button variant="secondary" icon="pi-file-pdf" iconPos="left"
        [disabled]="loading() || initialLoad() || printingPdf()" (click)="printPdf()" i18n="@@reports.sales-journal.imprimer.pdf.i9j0k1l2">
        Imprimer (PDF)
      </app-button>
      <app-button variant="secondary" icon="pi-download" iconPos="left"
        [disabled]="loading() || initialLoad() || !hasData()" (click)="exportCsv()" i18n="@@reports.sales-journal.exporter.csv.m3n4o5p6">
        Exporter
      </app-button>
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__row filters-row">
        <label class="filter-label" for="fromDate" i18n="@@reports.sales-journal.du.7a8b9c0d">Du</label>
        <input id="fromDate" type="date" class="filter-input" [(ngModel)]="fromStr" (change)="reload()" />
        <label class="filter-label" for="toDate" i18n="@@reports.sales-journal.au.1e2f3a4b">Au</label>
        <input id="toDate" type="date" class="filter-input" [(ngModel)]="toStr" (change)="reload()" />
        <label class="filter-label" for="client" i18n="@@reports.sales-journal.client.5c6d7e8f">Client</label>
        <p-select inputId="client" [options]="clientOptions()" optionLabel="name" optionValue="id"
          [(ngModel)]="selectedClientId" [showClear]="true" placeholder="Tous les clients" i18n-placeholder="@@reports.sales-journal.tous.les.clients.9a0b1c2d"
          (ngModelChange)="reload()" styleClass="client-select" />
      </div>
    </div>

    <p-tabs class="ft-tabs" [value]="viewModeTab()" (valueChange)="onViewModeChange($event)">
      <p-tablist>
        <p-tab [value]="0"><span i18n="@@reports.sales-journal.detail.3d4e5f60">Détail</span></p-tab>
        <p-tab [value]="1"><span i18n="@@reports.sales-journal.par.jour.7e8f9a01">Par jour</span></p-tab>
        <p-tab [value]="2"><span i18n="@@reports.sales-journal.par.mois.2b3c4d5e">Par mois</span></p-tab>
        <p-tab [value]="3"><span i18n="@@reports.sales-journal.par.annee.6f7a8b9c">Par année</span></p-tab>
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
                i18n="@@reports.sales-journal.reessayer.a1b2c3d4">Réessayer</app-button>
            </div>
          } @else if (!hasData()) {
            <div class="empty-placeholder" i18n="@@reports.sales-journal.aucune.ligne.0d1e2f3a">Aucune ligne de vente sur cette période.</div>
          } @else if (isDetailMode()) {
            <p-table [value]="detailRows()" [paginator]="true" [rows]="pageSize" [totalRecords]="totalRows()"
              [lazy]="true" [lazyLoadOnInit]="false" [loading]="loading()"
              (onLazyLoad)="onPage($event)" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@reports.sales-journal.date.4e5f6071">Date</th>
                  <th i18n="@@reports.sales-journal.facture.8a9b0c1d">Facture</th>
                  <th i18n="@@reports.sales-journal.type.2e3f4a5b">Type</th>
                  <th i18n="@@reports.sales-journal.client.col.6c7d8e9f">Client</th>
                  <th i18n="@@reports.sales-journal.code.1a2b3c4d">Code</th>
                  <th i18n="@@reports.sales-journal.produit.5e6f7a8b">Produit</th>
                  <th class="text-right" i18n="@@reports.sales-journal.qte.9c0d1e2f">Qté</th>
                  <th class="text-right" i18n="@@reports.sales-journal.pu.3a4b5c6d">P.U.</th>
                  <th class="text-right" i18n="@@reports.sales-journal.ht.7e8f9a0b">HT</th>
                  <th class="text-right" i18n="@@reports.sales-journal.tva.1c2d3e4f">TVA</th>
                  <th class="text-right" i18n="@@reports.sales-journal.ttc.5a6b7c8d">TTC</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td>{{ row.issueDate | date:'dd/MM/yyyy' }}</td>
                  <td><a [routerLink]="['/invoices', row.invoiceId]">{{ row.invoiceNumber }}</a></td>
                  <td>{{ row.documentType }}</td>
                  <td>{{ row.clientName }}</td>
                  <td>{{ row.productCode }}</td>
                  <td>{{ row.productName }}</td>
                  <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.unitPrice | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.lineSubTotal | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.vatAmount | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.lineTotal | number:'1.3-3' }} {{ row.currency }}</td>
                </tr>
              </ng-template>
            </p-table>
          } @else {
            <p-table [value]="aggregatedRows()" [paginator]="true" [rows]="pageSize" [totalRecords]="totalRows()"
              [lazy]="true" [lazyLoadOnInit]="false" [loading]="loading()"
              (onLazyLoad)="onPage($event)" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@reports.sales-journal.periode.0e1f2a3b">Période</th>
                  <th i18n="@@reports.sales-journal.client.col.6c7d8e9f">Client</th>
                  <th i18n="@@reports.sales-journal.code.1a2b3c4d">Code</th>
                  <th i18n="@@reports.sales-journal.produit.5e6f7a8b">Produit</th>
                  <th class="text-right" i18n="@@reports.sales-journal.qte.9c0d1e2f">Qté</th>
                  <th class="text-right" i18n="@@reports.sales-journal.ht.7e8f9a0b">HT</th>
                  <th class="text-right" i18n="@@reports.sales-journal.tva.1c2d3e4f">TVA</th>
                  <th class="text-right" i18n="@@reports.sales-journal.ttc.5a6b7c8d">TTC</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td>{{ row.periodKey }}</td>
                  <td>{{ row.clientName }}</td>
                  <td>{{ row.productCode }}</td>
                  <td>{{ row.productName }}</td>
                  <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.lineSubTotal | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.vatAmount | number:'1.3-3' }}</td>
                  <td class="text-right">{{ row.lineTotal | number:'1.3-3' }} {{ row.currency }}</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <div class="back-link-wrap">
      <a routerLink="/reports" class="back-link" i18n="@@reports.sales-journal.retour.4b5c6d7e">Retour aux rapports</a>
    </div>
  `,
  styles: [`
    .filters-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-3); }
    .filter-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .filter-input { padding: var(--spacing-2); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); }
    .client-select { min-width: 220px; }
    .text-right { text-align: right; }
    .empty-placeholder, .error-placeholder { padding: var(--spacing-8); text-align: center; color: var(--color-text-secondary); }
    .error-placeholder p { margin-bottom: var(--spacing-4); color: var(--color-text-primary); }
    .back-link-wrap { margin-top: var(--spacing-6); }
    .back-link { color: var(--color-primary-600); }
  `]
})
export class SalesJournalReportsComponent implements OnInit, OnDestroy {
  private readonly reportsApi = inject(ReportsApiService);
  private readonly clientService = inject(ClientService);
  private readonly printPreview = inject(PrintPreviewService);
  private readonly toast = inject(MessageService);
  private readonly errorHandler = inject(ErrorHandlerService);

  private readonly reloadTrigger$ = new Subject<{ resetPage: boolean }>();
  private subscriptions = new Subscription();
  /** Évite le double chargement (ngOnInit + premier onLazyLoad PrimeNG). */
  private initialLoadDone = false;
  private isFirstLazyLoad = true;

  loading = signal(false);
  initialLoad = signal(true);
  loadError = signal<string | null>(null);
  printingPdf = signal(false);
  result = signal<SalesJournalReportResult | null>(null);
  clientOptions = signal<ClientListItem[]>([]);

  fromStr = formatLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  toStr = formatLocalDate(new Date());
  selectedClientId: string | null = null;
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

  summaryMetrics = () => {
    const t = this.result()?.totals;
    const cur = t?.currency ?? 'TND';
    if (!t) return [];
    return [
      { label: $localize`:@@reports.sales-journal.total.qte.8d9e0f1a:Total quantité`, value: t.quantity, format: 'number' as const },
      { label: $localize`:@@reports.sales-journal.total.ht.2a3b4c5d:Total HT`, value: t.lineSubTotal, format: 'currency' as const, currency: cur },
      { label: $localize`:@@reports.sales-journal.total.tva.6e7f8a9b:Total TVA`, value: t.vatAmount, format: 'currency' as const, currency: cur },
      { label: $localize`:@@reports.sales-journal.total.ttc.0c1d2e3f:Total TTC`, value: t.lineTotal, format: 'currency' as const, currency: cur }
    ];
  };

  ngOnInit(): void {
    this.subscriptions.add(
      this.clientService.getClients({ page: 1, pageSize: 500 }).subscribe({
        next: res => this.clientOptions.set(res.success && res.data ? res.data.items : [])
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
            this.loadError.set(range.message ?? $localize`:@@reports.sales-journal.dates.invalides.b2c3d4e5:Dates invalides.`);
            this.result.set(null);
            this.loading.set(false);
            this.initialLoad.set(false);
            this.initialLoadDone = true;
            return EMPTY;
          }

          this.loadError.set(null);
          this.loading.set(true);
          return this.reportsApi.getSalesJournal({
            from: this.fromStr,
            to: this.toStr,
            viewMode: this.viewMode(),
            clientId: this.selectedClientId,
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
              $localize`:@@reports.sales-journal.chargement.echoue.c6d7e8f9:Impossible de charger le journal de ventes.`;
            this.loadError.set(msg);
            this.result.set(null);
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@reports.sales-journal.erreur.chargement.d0e1f2a3:Erreur`,
              detail: msg
            });
          }
        },
        error: err => {
          const msg =
            this.errorHandler.extractErrorMessage(err) ??
            $localize`:@@reports.sales-journal.chargement.echoue.c6d7e8f9:Impossible de charger le journal de ventes.`;
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
    this.reportsApi.downloadSalesJournalPdf({
      from: this.fromStr,
      to: this.toStr,
      viewMode: this.viewMode(),
      clientId: this.selectedClientId
    }).subscribe({
      next: blob => {
        this.printingPdf.set(false);
        this.printPreview.openPdfForPrintPreview(blob, 'Journal_ventes.pdf');
      },
      error: err => {
        this.printingPdf.set(false);
        const msg = err?.message ?? $localize`:@@reports.sales-journal.pdf.error.1f2e3d4c:Impossible de générer le PDF`;
        this.toast.add({
          severity: msg.includes('Aucune') ? 'info' : 'error',
          summary: $localize`:@@reports.sales-journal.information.5a6b7c8d:Information`,
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
          summary: $localize`:@@reports.sales-journal.erreur.export.e4f5a6b7:Erreur`,
          detail: $localize`:@@reports.sales-journal.export.interrompu.c8d9e0f1:L'export CSV n'a pas pu être complété. Réessayez ou réduisez la période.`
        });
        return;
      }
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      let lines: string[] = [];
      if (this.isDetailMode()) {
        const detail = rows as SalesJournalDetailRow[];
        lines = [
          ['Date', 'Facture', 'Type', 'Client', 'Code', 'Produit', 'Qté', 'PU', 'HT', 'TVA', 'TTC', 'Devise'].join(';'),
          ...detail.map(row =>
            [row.issueDate, row.invoiceNumber, row.documentType, row.clientName, row.productCode, row.productName,
              row.quantity, row.unitPrice, row.lineSubTotal, row.vatAmount, row.lineTotal, row.currency]
              .map(c => escape(String(c))).join(';'))
        ];
      } else {
        const agg = rows as SalesJournalAggregatedRow[];
        lines = [
          ['Période', 'Client', 'Code', 'Produit', 'Qté', 'HT', 'TVA', 'TTC', 'Devise'].join(';'),
          ...agg.map(row =>
            [row.periodKey, row.clientName, row.productCode, row.productName,
              row.quantity, row.lineSubTotal, row.vatAmount, row.lineTotal, row.currency]
              .map(c => escape(String(c))).join(';'))
        ];
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `journal-ventes-${formatLocalDate(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  private async fetchAllRowsForExport(): Promise<SalesJournalDetailRow[] | SalesJournalAggregatedRow[] | null> {
    const pageSize = 200;
    const total = this.totalRows();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const all: (SalesJournalDetailRow | SalesJournalAggregatedRow)[] = [];
    for (let p = 1; p <= pages; p++) {
      const res = await new Promise<SalesJournalReportResult | null>(resolve => {
        this.reportsApi.getSalesJournal({
          from: this.fromStr,
          to: this.toStr,
          viewMode: this.viewMode(),
          clientId: this.selectedClientId,
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
    return all as SalesJournalDetailRow[] | SalesJournalAggregatedRow[];
  }
}
