import { Component, OnInit, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StockService, Warehouse } from '@core/services/stock.service';
import {
  StockVoucherKindName,
  StockVoucherListDto,
  StockVoucherListSummaryDto,
  StockVoucherService,
  StockVoucherStatusName
} from '@core/services/stock-voucher.service';

@Component({
  selector: 'app-stock-voucher-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    TableModule,
    SelectModule,
    InputTextModule,
    ButtonModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    TableTotalsBarComponent,
    EmptyStateComponent,
    ButtonComponent
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    <app-page-header [title]="title" [subtitle]="subtitle">
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" [routerLink]="newRoute">
          {{ createLabel }}
        </app-button>
      }
    </app-page-header>

    <div class="card filters-card">
      <div class="filters-grid" role="search">
        <div class="filter-field">
          <label class="filter-label" for="voucher-search" i18n="@@stock-vouchers.stock-voucher-list.recherche.787b5492">Recherche</label>
          <input
            id="voucher-search"
            pInputText
            type="text"
            [(ngModel)]="searchTerm"
            placeholder="Numéro, référence…" i18n-placeholder="Numéro, référence…"
            (keyup.enter)="reload()" />
        </div>
        <div class="filter-field">
          <label class="filter-label" for="filter-status" i18n="@@stock-vouchers.stock-voucher-list.statut.659499f3">Statut</label>
          <p-select
            inputId="filter-status"
            [options]="statusOptions"
            [(ngModel)]="statusFilter"
            optionLabel="label"
            optionValue="value"
            placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
            [showClear]="true"
            [style]="{ width: '100%' }"
            appendTo="body">
          </p-select>
        </div>
        <div class="filter-field">
          <label class="filter-label" for="filter-warehouse" i18n="@@stock-vouchers.stock-voucher-list.depot.4c1c61c7">Dépôt</label>
          <p-select
            inputId="filter-warehouse"
            [options]="warehouseOptions"
            [(ngModel)]="warehouseFilter"
            optionLabel="label"
            optionValue="value"
            placeholder="Tous les dépôts" i18n-placeholder="Tous les dépôts"
            [showClear]="true"
            [filter]="warehouseOptions.length > 8"
            filterBy="label"
            [style]="{ width: '100%' }"
            appendTo="body">
          </p-select>
        </div>
        <div class="filter-field">
          <label class="filter-label" for="filter-from" i18n="@@stock-vouchers.stock-voucher-list.du.84814985">Du</label>
          <input id="filter-from" type="date" class="date-input" [(ngModel)]="fromDate" />
        </div>
        <div class="filter-field">
          <label class="filter-label" for="filter-to" i18n="@@stock-vouchers.stock-voucher-list.au.7a1732d5">Au</label>
          <input id="filter-to" type="date" class="date-input" [(ngModel)]="toDate" />
        </div>
        <div class="filter-actions">
          <button pButton type="button" label="Appliquer" icon="pi pi-filter" (click)="reload()"></button>
          <button pButton type="button" label="Réinitialiser" class="p-button-outlined" (click)="resetFilters()"></button>
        </div>
      </div>
    </div>

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="summaryLoading()"></app-table-totals-bar>

    <div class="card">
      <p-table
        [value]="vouchers()"
        [lazy]="true"
        [paginator]="true"
        [rows]="pageSize"
        [totalRecords]="totalCount()"
        [loading]="loading()"
        [rowHover]="true"
        [showCurrentPageReport]="true"
        currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} bons"
        (onLazyLoad)="onLazyLoad($event)"
        styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@stock-vouchers.stock-voucher-list.numero.15e73db0">Numéro</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.date.eb9a4bc1">Date</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.depot.4c1c61c7">Dépôt</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.motif.2a198f47">Motif</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.lignes.41c7025e">Lignes</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.quantite.09a38fda">Quantité</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.valorisation.61fcd7cd">Valorisation</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.statut.659499f3">Statut</th>
            <th i18n="@@stock-vouchers.stock-voucher-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>
              <a [routerLink]="[row.id]" class="link-primary">{{ row.number }}</a>
            </td>
            <td>{{ row.voucherDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ row.warehouseName || '—' }}</td>
            <td>{{ row.reasonDisplay }}</td>
            <td>{{ row.lineCount }}</td>
            <td>{{ row.totalQuantity | number:'1.0-3' }}</td>
            <td>{{ row.totalValue | currency:'TND':'symbol':'1.3-3' }}</td>
            <td>
              <span class="status-badge" [ngClass]="row.statusCss">{{ row.statusDisplay }}</span>
            </td>
            <td>
              <a [routerLink]="[row.id]" class="btn-icon" [attr.aria-label]="'Voir ' + row.number">
                <i class="fas fa-eye" aria-hidden="true"></i>
              </a>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="9">
              <app-empty-state
                icon="pi-box"
                [title]="emptyTitle"
                [description]="emptyHint">
              </app-empty-state>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: [`
    .card { background: white; border-radius: 0.75rem; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .filters-card { margin-bottom: 1rem; }
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
      gap: 1rem;
      align-items: end;
    }
    @media (max-width: 960px) { .filters-grid { grid-template-columns: 1fr 1fr; } }
    .filter-label { display: block; font-size: 0.75rem; font-weight: 600; color: #64748b; margin-bottom: 0.375rem; }
    .date-input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.375rem; }
    .filter-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .link-primary { color: var(--color-primary-600, #2563eb); text-decoration: none; font-weight: 500; }
    .btn-icon { color: #64748b; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; }
    .status-draft { background: #f1f5f9; color: #475569; }
    .status-validated { background: #dcfce7; color: #166534; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
  `]
})
export class StockVoucherListComponent implements OnInit {
  private voucherService = inject(StockVoucherService);
  private stockService = inject(StockService);
  private route = inject(ActivatedRoute);
  private messageService = inject(MessageService);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);

  readonly isEntry = (this.route.snapshot.data['kind'] as StockVoucherKindName) !== 'Issue';
  readonly kind: StockVoucherKindName = this.isEntry ? 'Entry' : 'Issue';
  readonly title = this.isEntry ? "Bons d'entrée" : 'Bons de sortie';
  readonly subtitle = this.isEntry
    ? 'Documents d’entrée de stock (stock initial, retours hors BRT, achats hors réception).'
    : 'Documents de sortie de stock (casse, usage interne, dons, retours hors flux achat).';
  readonly createLabel = this.isEntry ? 'Nouveau bon d’entrée' : 'Nouveau bon de sortie';
  readonly newRoute = this.isEntry ? '/stock/entries/new' : '/stock/issues/new';
  readonly emptyTitle = this.isEntry ? "Aucun bon d'entrée" : 'Aucun bon de sortie';
  readonly emptyHint = this.isEntry
    ? 'Pour un achat fournisseur, utilisez Achats > Bons de réception.'
    : 'Les ventes et livraisons sortent le stock via la facture ou le bon de livraison.';

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Stock', route: '/stock' },
    { label: this.title }
  ];

  canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.create));

  vouchers = signal<StockVoucherListDto[]>([]);
  loading = signal(false);
  summaryLoading = signal(false);
  totalCount = signal(0);
  summary = signal<StockVoucherListSummaryDto | null>(null);

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    return [
      { label: 'Bons', value: s?.count ?? 0, format: 'number', icon: 'pi-box', tone: 'primary' },
      { label: 'Brouillons', value: s?.draftCount ?? 0, format: 'number', icon: 'pi-pencil', tone: 'cyan' },
      { label: 'Validés', value: s?.validatedCount ?? 0, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: 'Valorisation', value: s?.totalValue ?? 0, format: 'currency', icon: 'pi-wallet', tone: 'primary' }
    ];
  });

  searchTerm = '';
  statusFilter: StockVoucherStatusName | null = null;
  warehouseFilter: string | null = null;
  fromDate: string | null = null;
  toDate: string | null = null;
  page = 1;
  pageSize = 20;
  warehouseOptions: { label: string; value: string }[] = [];

  readonly statusOptions: { label: string; value: StockVoucherStatusName }[] = [
    { label: 'Brouillon', value: 'Draft' },
    { label: 'Validé', value: 'Validated' },
    { label: 'Annulé', value: 'Cancelled' }
  ];

  ngOnInit(): void {
    this.stockService.getWarehouses(false).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const data = (res.data as Warehouse[] | undefined) ?? [];
        this.warehouseOptions = data.map(w => ({ label: w.name, value: w.id }));
      }
    });
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    this.page = Math.floor((event.first ?? 0) / (event.rows ?? this.pageSize)) + 1;
    this.pageSize = event.rows ?? this.pageSize;
    this.load();
  }

  reload(): void {
    this.page = 1;
    this.load();
    this.loadSummary();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.statusFilter = null;
    this.warehouseFilter = null;
    this.fromDate = null;
    this.toDate = null;
    this.reload();
  }

  private queryParams() {
    return {
      kind: this.kind,
      search: this.searchTerm.trim() || undefined,
      status: this.statusFilter ?? undefined,
      warehouseId: this.warehouseFilter ?? undefined,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined
    };
  }

  private load(): void {
    this.loading.set(true);
    this.voucherService
      .getStockVouchers({ ...this.queryParams(), page: this.page, pageSize: this.pageSize })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.vouchers.set(res.data?.items ?? []);
          this.totalCount.set(res.data?.totalCount ?? 0);
          this.loading.set(false);
          if (!this.summary()) this.loadSummary();
        },
        error: () => {
          this.loading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de charger les bons' });
        }
      });
  }

  private loadSummary(): void {
    this.summaryLoading.set(true);
    this.voucherService.getSummary(this.queryParams()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.summary.set(res.data ?? null);
        this.summaryLoading.set(false);
      },
      error: () => this.summaryLoading.set(false)
    });
  }
}
