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
import { TooltipModule } from 'primeng/tooltip';
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
    PurchaseOrderService, PurchaseOrderListItem, PurchaseOrderSearchParams, PurchaseOrderListSummary, PurchaseOrderStatus
} from '@core/services/purchase-order.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface StatusOption {
    label: string;
    value: PurchaseOrderStatus | null;
}

@Component({
    selector: 'app-purchase-order-list',
    standalone: true,
    imports: [
    BackendLabelPipe,
        CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
        TableModule, ButtonModule, InputTextModule, SelectModule,
        TagModule, TooltipModule, DatePickerModule, ToastModule,
        PageHeaderComponent, BreadcrumbComponent, SkeletonTableComponent,
        EmptyStateComponent, ButtonComponent, TableTotalsBarComponent
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Bons de commande" i18n-title="Bons de commande"
      subtitle="Gérez vos commandes fournisseurs et suivez les réceptions.">
      @if (canCreatePurchaseOrder()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@purchase-orders.purchase-order-list.nouvelle.commande.061f365b"> Nouvelle commande </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="Réinitialiser les filtres">
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
            placeholder="Rechercher par numéro, fournisseur ou référence…" i18n-placeholder="Rechercher par numéro, fournisseur ou référence…"
            [(ngModel)]="searchTerm"
            (input)="onSearchInput($event)"
            class="w-full">
        </span>

        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="Tous les statuts"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-select
          [options]="suppliers()"
          [(ngModel)]="selectedSupplierId"
          optionLabel="name"
          optionValue="id"
          placeholder="Tous les fournisseurs" i18n-placeholder="Tous les fournisseurs"
          [showClear]="true"
          [filter]="true"
          filterBy="name"
          (onChange)="onFilterChange()"
          styleClass="supplier-filter">
        </p-select>

        <div class="ft-filters__field">
          <span class="filter-label" i18n="@@purchase-orders.purchase-order-list.date.debut.2413e246">Date début</span>
          <p-datepicker
            [(ngModel)]="fromDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            placeholder="Du" i18n-placeholder="Du"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            styleClass="date-filter">
          </p-datepicker>
        </div>

        <div class="ft-filters__field">
          <span class="filter-label" i18n="@@purchase-orders.purchase-order-list.date.fin.2d44e855">Date fin</span>
          <p-datepicker
            [(ngModel)]="toDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            placeholder="Au" i18n-placeholder="Au"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            styleClass="date-filter">
          </p-datepicker>
        </div>
      </div>
    </div>

    <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
    <app-table-totals-bar
      [metrics]="summaryMetrics()"
      [loading]="summaryLoading()">
    </app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (loading() && orders().length === 0) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table
          [value]="orders()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} commandes" i18n-currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} commandes"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [rowHover]="true"
          styleClass="p-datatable-sm">

        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="number" style="width: 130px"><ng-container i18n="@@purchase-orders.purchase-order-list.n.754e6095">N° </ng-container> <p-sortIcon field="number"></p-sortIcon></th>
            <th i18n="@@purchase-orders.purchase-order-list.fournisseur.97d91d89">Fournisseur</th>
            <th pSortableColumn="orderDate" style="width: 120px"><ng-container i18n="@@purchase-orders.purchase-order-list.date.eb9a4bc1">Date </ng-container> <p-sortIcon field="orderDate"></p-sortIcon></th>
            <th style="width: 120px" i18n="@@purchase-orders.purchase-order-list.livraison.prevue.dc15f458">Livraison prévue</th>
            <th i18n="@@purchase-orders.purchase-order-list.reference.f8130bb0">Référence</th>
            <th style="width: 100px" i18n="@@purchase-orders.purchase-order-list.lignes.41c7025e">Lignes</th>
            <th pSortableColumn="totalTTC" style="width: 130px"><ng-container i18n="@@purchase-orders.purchase-order-list.total.ttc.9e80ff7c">Total TTC </ng-container> <p-sortIcon field="totalTTC"></p-sortIcon></th>
            <th style="width: 140px" i18n="@@purchase-orders.purchase-order-list.statut.659499f3">Statut</th>
            <th style="width: 80px" i18n="@@purchase-orders.purchase-order-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-order>
          <tr>
            <td>
              <a [routerLink]="[order.id]" class="order-number">{{ order.number }}</a>
            </td>
            <td>
              <span class="supplier-name">{{ order.supplierName }}</span>
            </td>
            <td>
              <span class="date">{{ order.orderDate | date:'dd/MM/yyyy' }}</span>
            </td>
            <td>
              <span class="date">{{ order.expectedDeliveryDate ? (order.expectedDeliveryDate | date:'dd/MM/yyyy') : '-' }}</span>
            </td>
            <td>
              <span class="reference">{{ order.reference || '-' }}</span>
            </td>
            <td class="text-center">
              <span class="line-count">{{ order.lineCount }}</span>
            </td>
            <td>
              <span class="amount">{{ order.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span>
            </td>
            <td>
              <p-tag
                [value]="order.statusDisplay | backendLabel"
                [severity]="getStatusSeverity(order.status)">
              </p-tag>
            </td>
            <td>
              <div class="actions">
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [routerLink]="order.id"
                  ariaLabel="Voir la commande">
                </app-button>
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="9" class="text-center p-6">
              <app-empty-state
                title="Aucun bon de commande" i18n-title="Aucun bon de commande"
                description="Créez votre première commande fournisseur pour approvisionner votre stock."
                [showAction]="canCreatePurchaseOrder()"
                actionLabel="Nouvelle commande"
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
        .p-inputtext {
          flex: 1;
          min-width: 80px;
        }
      }
    }

    .supplier-filter {
      min-width: 200px;
    }

    .order-number {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
    }

    .supplier-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-900);
    }

    .date {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .reference {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
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
  `]
})
export class PurchaseOrderListComponent implements OnInit, OnDestroy {
    private poService = inject(PurchaseOrderService);
    private supplierService = inject(SupplierService);
    private toastService = inject(ToastService);
    private auth = inject(AuthService);

    canCreatePurchaseOrder = computed(() => this.auth.hasPermission(PERMISSIONS.purchaseOrders.create));

    private destroy$ = new Subject<void>();
    private searchSubject = new Subject<string>();
    private initialLoadDone = false;
    private isFirstLoad = true;

    loading = signal(true);
  initialLoad = signal(true);
    orders = signal<PurchaseOrderListItem[]>([]);
    totalRecords = signal(0);
    suppliers = signal<SupplierListItem[]>([]);

    /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
    summary = signal<PurchaseOrderListSummary | null>(null);
    summaryLoading = signal(false);

    summaryMetrics = computed<TotalMetric[]>(() => {
        const s = this.summary();
        const currency = s?.currency ?? $localize`:@@ui.tern.tnd.51da21:TND`;
        return [
            { label: 'Commandes', value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
            { label: 'Total TTC', value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
            { label: 'Total HT', value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
            { label: 'Reçus', value: s?.receivedCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
            { label: 'En attente', value: s?.pendingCount, format: 'number', icon: 'pi-clock', tone: 'amber' }
        ];
    });

    searchTerm = '';
    selectedStatus: PurchaseOrderStatus | null = null;
    selectedSupplierId: string | null = null;
    fromDate: Date | null = null;
    toDate: Date | null = null;
    page = 1;
    pageSize = 20;

    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Achats' },
        { label: 'Bons de commande' }
    ];

    skeletonColumns: SkeletonColumn[] = [
        { width: '130px' },
        { width: '200px' },
        { width: '120px' },
        { width: '120px' },
        { width: '120px' },
        { width: '80px' },
        { width: '130px' },
        { width: '120px' },
        { width: '80px' }
    ];

    statusOptions: StatusOption[] = [
        { label: $localize`:@@purchase-orders.list.filter.brouillon:Brouillon`, value: PurchaseOrderStatus.Draft },
        { label: $localize`:@@purchase-orders.list.filter.confirme:Confirmé`, value: PurchaseOrderStatus.Confirmed },
        { label: $localize`:@@purchase-orders.list.filter.partiel:Partiellement reçu`, value: PurchaseOrderStatus.PartiallyReceived },
        { label: $localize`:@@purchase-orders.list.filter.recu:Reçu`, value: PurchaseOrderStatus.Received },
        { label: $localize`:@@purchase-orders.list.filter.annule:Annulé`, value: PurchaseOrderStatus.Cancelled }
    ];

    ngOnInit(): void {
        this.searchSubject
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                takeUntil(this.destroy$)
            )
            .subscribe(() => this.onSearch());

        this.loadSuppliers();
        this.loadOrders();
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

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.searchSubject.complete();
    }

    loadOrders(): void {
        if (this.loading() && this.orders().length > 0) return;

        this.loading.set(true);

        const params: PurchaseOrderSearchParams = {
            search: this.searchTerm || undefined,
            status: this.selectedStatus ?? undefined,
            supplierId: this.selectedSupplierId ?? undefined,
            fromDate: this.fromDate ? this.formatDate(this.fromDate) : undefined,
            toDate: this.toDate ? this.formatDate(this.toDate) : undefined,
            page: this.page,
            pageSize: this.pageSize
        };

        this.loadSummary(params);

        this.poService.getPurchaseOrders(params).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.orders.set(response.data.items);
                    this.totalRecords.set(response.data.totalCount);
                    this.initialLoadDone = true;
                }
                this.loading.set(false);
        this.initialLoad.set(false);
            },
            error: (error) => {
                this.loading.set(false);
        this.initialLoad.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@purchase-order-list.component.summary.Erreur:Erreur`,
                    detail: error?.error?.errors?.[0] || 'Impossible de charger les commandes'
                });
            }
        });
    }

    /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
    private loadSummary(params: PurchaseOrderSearchParams): void {
        this.summaryLoading.set(true);
        this.poService.getPurchaseOrdersSummary(params).subscribe({
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
        const value = (event.target as HTMLInputElement).value;
        this.searchSubject.next(value);
    }

    onSearch(): void {
        this.page = 1;
        this.loadOrders();
    }

    onPageChange(event: any): void {
        const first = event.first ?? 0;
        const rows = event.rows ?? this.pageSize;
        this.page = rows ? Math.floor(first / rows) + 1 : 1;
        this.pageSize = rows || this.pageSize;

        if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
            this.isFirstLoad = false;
            return;
        }

        this.loadOrders();
        this.isFirstLoad = false;
    }

    getStatusSeverity(status: PurchaseOrderStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
        switch (status) {
            case PurchaseOrderStatus.Draft: return 'secondary';
            case PurchaseOrderStatus.Confirmed: return 'info';
            case PurchaseOrderStatus.PartiallyReceived: return 'warn';
            case PurchaseOrderStatus.Received: return 'success';
            case PurchaseOrderStatus.Cancelled: return 'danger';
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

    private formatDate(date: Date): string {
        return formatLocalDate(date);
    }

    onFilterChange(): void {
        this.page = 1;
        this.loadOrders();
    }

    resetFilters(): void {
        this.searchTerm = '';
        this.selectedStatus = null;
        this.selectedSupplierId = null;
        this.fromDate = null;
        this.toDate = null;
        this.page = 1;
        this.loadOrders();
    }
}
