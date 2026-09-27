/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
  PurchaseReceiptService,
  PurchaseReceiptListItem,
  PurchaseReceiptSearchParams,
  PurchaseReceiptListSummary,
  PurchaseReceiptStatus
} from '@core/services/purchase-receipt.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface StatusOption {
  label: string;
  value: PurchaseReceiptStatus | null;
}

@Component({
  selector: 'app-purchase-receipt-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
    TableModule, ButtonModule, InputTextModule, SelectModule,
    TagModule, DatePickerModule, ToastModule,
    PageHeaderComponent, BreadcrumbComponent, SkeletonTableComponent,
    EmptyStateComponent, ButtonComponent, TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Bons de réception" i18n-title="@@purchase-receipts.pages.bons.de.reception.84d6ebb5"
      subtitle="Enregistrez et validez les réceptions de marchandises fournisseurs." i18n-subtitle="@@purchase-receipts.pages.enregistrez.et.validez.les.receptions.de.25825b29">
      @if (canCreate()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@purchase-receipts.pages.nouveau.bon.de.reception.479ec866"> Nouveau bon de réception </app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@purchase-receipts.pages.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@purchase-receipts.pages.reinitialiser.les.filtres.d8915f02" i18n="@@purchase-receipts.pages.reinitialiser.9637f51e">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left flex-1">
          <i class="pi pi-search"></i>
          <input
            pInputText
            type="text"
            placeholder="Rechercher par numéro, fournisseur ou référence…" i18n-placeholder="@@purchase-receipts.pages.rechercher.par.numero.fournisseur.ou.reference.f62ac59c"
            [(ngModel)]="searchTerm"
            (input)="onSearchInput($event)"
            class="w-full">
        </span>

        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@purchase-receipts.pages.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-select
          [options]="suppliers()"
          [(ngModel)]="selectedSupplierId"
          optionLabel="name"
          optionValue="id"
          placeholder="Tous les fournisseurs" i18n-placeholder="@@purchase-receipts.pages.tous.les.fournisseurs.0e8a9fae"
          [showClear]="true"
          [filter]="true"
          filterBy="name"
          (onChange)="onFilterChange()"
          styleClass="supplier-filter">
        </p-select>

        <div class="ft-filters__field">
          <span class="filter-label" i18n="@@purchase-receipts.pages.date.debut.2413e246">Date début</span>
          <p-datepicker
            [(ngModel)]="fromDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            placeholder="Du" i18n-placeholder="@@purchase-receipts.pages.du.84814985"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            styleClass="date-filter">
          </p-datepicker>
        </div>

        <div class="ft-filters__field">
          <span class="filter-label" i18n="@@purchase-receipts.pages.date.fin.2d44e855">Date fin</span>
          <p-datepicker
            [(ngModel)]="toDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            placeholder="Au" i18n-placeholder="@@purchase-receipts.pages.au.7a1732d5"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            styleClass="date-filter">
          </p-datepicker>
        </div>
      </div>
    </div>

    <app-table-totals-bar
      [metrics]="summaryMetrics()"
      [loading]="summaryLoading()">
    </app-table-totals-bar>

    <div class="ft-table-card">
      @if (loading() && receipts().length === 0) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table
          [value]="receipts()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} bons de réception" i18n-currentPageReportTemplate="@@purchase-receipts.pages.affichage.de.first.a.last.sur.totalrecor.1d355587"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [rowHover]="true"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="header">
            <tr>
              <th style="width: 130px" i18n="@@purchase-receipts.pages.n.754e6095">N°</th>
              <th i18n="@@purchase-receipts.pages.fournisseur.97d91d89">Fournisseur</th>
              <th style="width: 120px" i18n="@@purchase-receipts.pages.date.eb9a4bc1">Date</th>
              <th i18n="@@purchase-receipts.pages.bon.de.commande.4b9aea29">Bon de commande</th>
              <th i18n="@@purchase-receipts.pages.entrepot.c349c0bc">Entrepôt</th>
              <th style="width: 80px" i18n="@@purchase-receipts.pages.lignes.41c7025e">Lignes</th>
              <th style="width: 130px" i18n="@@purchase-receipts.pages.total.ttc.9e80ff7c">Total TTC</th>
              <th style="width: 140px" i18n="@@purchase-receipts.pages.statut.659499f3">Statut</th>
              <th style="width: 80px" i18n="@@purchase-receipts.pages.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-receipt>
            <tr>
              <td>
                <a [routerLink]="[receipt.id]" class="receipt-number">{{ receipt.number }}</a>
              </td>
              <td>
                <span class="supplier-name">{{ receipt.supplierName }}</span>
              </td>
              <td>
                <span class="date">{{ receipt.receiptDate | date:'dd/MM/yyyy' }}</span>
              </td>
              <td>
                @if (receipt.purchaseOrderId) {
                  <a [routerLink]="['/purchase-orders', receipt.purchaseOrderId]" class="po-link">
                    {{ receipt.purchaseOrderNumber }}
                  </a>
                } @else {
                  <span class="muted" i18n="@@purchase-receipts.pages.text.1b93795b">—</span>
                }
              </td>
              <td>{{ receipt.warehouseName || '—' }}</td>
              <td class="text-center">
                <span class="line-count">{{ receipt.lineCount }}</span>
                @if (receipt.isPartialRelativeToOrdered) {
                  <p-tag value="Partiel" severity="warn" styleClass="partial-tag"></p-tag>
                }
              </td>
              <td>
                <span class="amount">{{ receipt.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
              </td>
              <td>
                <p-tag
                  [value]="receipt.statusDisplay | backendLabel"
                  [severity]="getStatusSeverity(receipt.status)">
                </p-tag>
              </td>
              <td>
                <div class="actions">
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-eye"
                    [iconOnly]="true"
                    [routerLink]="receipt.id"
                    ariaLabel="Voir le bon de réception" i18n-ariaLabel="@@purchase-receipts.pages.voir.le.bon.de.reception.7b8895f5">
                  </app-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center p-6">
                <app-empty-state
                  title="Aucun bon de réception" i18n-title="@@purchase-receipts.pages.aucun.bon.de.reception.8ae0bc37"
                  description="Créez votre premier bon de réception pour enregistrer les livraisons fournisseurs." i18n-description="@@purchase-receipts.pages.creez.votre.premier.bon.de.reception.pou.12491aa9"
                  [showAction]="canCreate()"
                  actionLabel="Nouveau bon de réception" i18n-actionLabel="@@purchase-receipts.pages.nouveau.bon.de.reception.5db3fe90"
                  actionRoute="new">
                </app-empty-state>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [`
    .filter-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      margin-right: var(--spacing-1);
    }

    .date-filter {
      min-width: 160px;

      ::ng-deep {
        .p-datepicker {
          display: flex;
          width: 100%;
        }
        .p-inputtext {
          flex: 1;
          min-width: 80px;
        }
      }
    }

    .supplier-filter {
      min-width: 200px;
    }

    .receipt-number, .po-link {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
      text-decoration: none;
    }

    .po-link:hover, .receipt-number:hover {
      text-decoration: underline;
    }

    .supplier-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-900);
    }

    .date {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .muted {
      color: var(--color-neutral-400);
    }

    .line-count {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    :host ::ng-deep .partial-tag {
      margin-left: var(--spacing-1);
      font-size: 0.65rem;
    }
  `]
})
export class PurchaseReceiptListComponent implements OnInit, OnDestroy {
  private receiptService = inject(PurchaseReceiptService);
  private supplierService = inject(SupplierService);
  private toastService = inject(ToastService);
  private auth = inject(AuthService);

  canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.purchaseReceipts.create));

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();
  private initialLoadDone = false;
  private isFirstLoad = true;

  loading = signal(true);
  receipts = signal<PurchaseReceiptListItem[]>([]);
  totalRecords = signal(0);
  suppliers = signal<SupplierListItem[]>([]);

  summary = signal<PurchaseReceiptListSummary | null>(null);
  summaryLoading = signal(false);

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    const currency = s?.currency ?? 'TND';
    return [
      { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.receptions.c22fafbd:Réceptions`, value: s?.count, format: 'number', icon: 'pi-box', tone: 'primary' },
      { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.total.ttc.9e80ff7c:Total TTC`, value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
      { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.total.ht.2ca17ae6:Total HT`, value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
      { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.valides.f9664fcf:Validés`, value: s?.validatedCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.brouillons.a55f3cd9:Brouillons`, value: s?.draftCount, format: 'number', icon: 'pi-file-edit', tone: 'amber' }
    ];
  });

  searchTerm = '';
  selectedStatus: PurchaseReceiptStatus | null = null;
  selectedSupplierId: string | null = null;
  fromDate: Date | null = null;
  toDate: Date | null = null;
  page = 1;
  pageSize = 20;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.achats.ee5b078c:Achats` },
    { label: $localize`:@@purchase-receipts.purchase-receipt-list.ts.bons.de.reception.84d6ebb5:Bons de réception` }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '130px' },
    { width: '200px' },
    { width: '120px' },
    { width: '120px' },
    { width: '140px' },
    { width: '80px' },
    { width: '130px' },
    { width: '120px' },
    { width: '80px' }
  ];

  statusOptions: StatusOption[] = [
    { label: $localize`:@@purchase-receipts.list.filter.brouillon:Brouillon`, value: PurchaseReceiptStatus.Draft },
    { label: $localize`:@@purchase-receipts.list.filter.valide:Validé`, value: PurchaseReceiptStatus.Validated },
    { label: $localize`:@@purchase-receipts.list.filter.annule:Annulé`, value: PurchaseReceiptStatus.Cancelled }
  ];

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => this.onSearch());

    this.loadSuppliers();
    this.loadReceipts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.searchSubject.complete();
  }

  private loadSuppliers(): void {
    this.supplierService.getActiveSuppliers().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.suppliers.set(response.data.items);
        }
      }
    });
  }

  loadReceipts(): void {
    if (this.loading() && this.receipts().length > 0) return;

    this.loading.set(true);

    const params: PurchaseReceiptSearchParams = {
      search: this.searchTerm || undefined,
      status: this.selectedStatus ?? undefined,
      supplierId: this.selectedSupplierId ?? undefined,
      fromDate: this.fromDate ? formatLocalDate(this.fromDate) : undefined,
      toDate: this.toDate ? formatLocalDate(this.toDate) : undefined,
      page: this.page,
      pageSize: this.pageSize
    };

    this.loadSummary(params);

    this.receiptService.getPurchaseReceipts(params).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.receipts.set(response.data.items);
          this.totalRecords.set(response.data.totalCount);
          this.initialLoadDone = true;
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        const status = error?.status as number | undefined;
        const detail =
          status === 403
            ? 'Accès non autorisé aux bons de réception'
            : error?.error?.errors?.[0] || 'Impossible de charger les bons de réception';
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@purchase-receipt-list.component.summary.Erreur:Erreur`,
          detail
        });
      }
    });
  }

  private loadSummary(params: PurchaseReceiptSearchParams): void {
    this.summaryLoading.set(true);
    this.receiptService.getPurchaseReceiptsSummary(params).subscribe({
      next: (response) => {
        this.summary.set(response.success && response.data ? response.data : null);
        this.summaryLoading.set(false);
      },
      error: () => {
        this.summary.set(null);
        this.summaryLoading.set(false);
      }
    });
  }

  onSearchInput(event: Event): void {
    this.searchSubject.next((event.target as HTMLInputElement).value);
  }

  onSearch(): void {
    this.page = 1;
    this.loadReceipts();
  }

  onPageChange(event: { first?: number | null; rows?: number | null }): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    this.page = rows ? Math.floor(first / rows) + 1 : 1;
    this.pageSize = rows || this.pageSize;

    if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
      this.isFirstLoad = false;
      return;
    }

    this.loadReceipts();
    this.isFirstLoad = false;
  }

  getStatusSeverity(status: PurchaseReceiptStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case PurchaseReceiptStatus.Draft: return 'secondary';
      case PurchaseReceiptStatus.Validated: return 'success';
      case PurchaseReceiptStatus.Cancelled: return 'danger';
      default: return 'secondary';
    }
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedStatus !== null ||
      this.selectedSupplierId !== null || this.fromDate !== null || this.toDate !== null;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedStatus !== null) count++;
    if (this.selectedSupplierId !== null) count++;
    if (this.fromDate !== null) count++;
    if (this.toDate !== null) count++;
    return count;
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadReceipts();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
    this.selectedSupplierId = null;
    this.fromDate = null;
    this.toDate = null;
    this.page = 1;
    this.loadReceipts();
  }
}
