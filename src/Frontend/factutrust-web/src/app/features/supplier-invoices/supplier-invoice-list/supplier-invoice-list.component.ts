import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterModule, ActivatedRoute, ParamMap } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
    SupplierInvoiceService,
    SupplierInvoiceListItem,
    SupplierInvoiceSearchParams,
    SupplierInvoiceListSummary,
    SupplierInvoiceStatus
} from '@core/services/supplier-invoice.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { applySupplierInvoiceListFiltersFromQuery } from '@core/utils/list-filter-from-query';

interface StatusOption {
    label: string;
    value: SupplierInvoiceStatus | null;
}

@Component({
    selector: 'app-supplier-invoice-list',
    standalone: true,
    imports: [
        CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
        TableModule, InputTextModule, SelectModule, TagModule, ToastModule,
        PageHeaderComponent, BreadcrumbComponent, SkeletonTableComponent,
        EmptyStateComponent, ButtonComponent, TableTotalsBarComponent
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header
      [title]="unpaidOnlyMode() ? 'Factures impayées fournisseurs' : 'Factures fournisseurs'"
      [subtitle]="unpaidOnlyMode() ? 'Factures fournisseurs non réglées ou partiellement réglées.' : 'Consultez et gérez les factures fournisseurs et leur statut de paiement.'">
      @if (canCreateSupplierInvoice() && !unpaidOnlyMode()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@supplier-invoices.supplier-invoice-list.nouvelle.facture.cdf7e09c">Nouvelle facture</app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button class="ft-filters__reset" (click)="resetFilters()" aria-label="Réinitialiser les filtres" i18n-aria-label="Réinitialiser les filtres">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left flex-1">
          <i class="pi pi-search"></i>
          <input pInputText type="text"
            placeholder="Rechercher par n° facture, fournisseur…" i18n-placeholder="Rechercher par n° facture, fournisseur…"
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
          [options]="supplierOptions"
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
      </div>
    </div>

    <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
    <app-table-totals-bar
      [metrics]="summaryMetrics()"
      [loading]="summaryLoading()">
    </app-table-totals-bar>

    <div class="ft-table-card">
      @if (loading() && invoices().length === 0) {
        <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
      } @else {
        <p-table
          [value]="invoices()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} factures"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [rowHover]="true"
          styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 140px" i18n="@@supplier-invoices.supplier-invoice-list.n.facture.7543385a">N° facture</th>
              <th style="width: 90px" i18n="@@supplier-invoices.supplier-invoice-list.type.3deb7456">Type</th>
              <th i18n="@@supplier-invoices.supplier-invoice-list.fournisseur.97d91d89">Fournisseur</th>
              <th style="width: 120px" i18n="@@supplier-invoices.supplier-invoice-list.bon.de.commande.4b9aea29">Bon de commande</th>
              <th style="width: 110px" i18n="@@supplier-invoices.supplier-invoice-list.date.eb9a4bc1">Date</th>
              <th style="width: 110px" i18n="@@supplier-invoices.supplier-invoice-list.echeance.f9a77ff6">Échéance</th>
              <th style="width: 120px" i18n="@@supplier-invoices.supplier-invoice-list.total.ttc.9e80ff7c">Total TTC</th>
              <th style="width: 120px" i18n="@@supplier-invoices.supplier-invoice-list.statut.659499f3">Statut</th>
              <th style="width: 80px" i18n="@@supplier-invoices.supplier-invoice-list.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-inv>
            <tr>
              <td><a [routerLink]="[inv.id]" class="invoice-number">{{ inv.invoiceNumber }}</a></td>
              <td>
                @if (inv.hasFixedAssetLines) {
                  <p-tag value="Immo" severity="info" [rounded]="true"></p-tag>
                } @else if (isStandalone(inv)) {
                  <p-tag value="Directe" severity="secondary" [rounded]="true"></p-tag>
                } @else {
                  <span class="type-muted" i18n="@@supplier-invoices.supplier-invoice-list.text.1b93795b">—</span>
                }
              </td>
              <td><span class="supplier-name">{{ inv.supplierName }}</span></td>
              <td>
                @if (inv.purchaseOrderNumber) {
                  <a [routerLink]="['/purchase-orders', inv.purchaseOrderId]" class="po-link">{{ inv.purchaseOrderNumber }}</a>
                } @else {
                  —
                }
              </td>
              <td><span class="date">{{ inv.invoiceDate | date:'dd/MM/yyyy' }}</span></td>
              <td><span class="date">{{ inv.dueDate | date:'dd/MM/yyyy' }}</span></td>
              <td><span class="amount">{{ inv.totalTTC | currency:'TND':'symbol':'1.3-3' }}</span></td>
              <td><p-tag [value]="inv.statusDisplay" [severity]="getStatusSeverity(inv.status)"></p-tag></td>
              <td>
                <app-button variant="ghost" size="sm" icon="pi-eye" [iconOnly]="true" [routerLink]="inv.id" ariaLabel="Voir"></app-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center p-6">
                @if (unpaidOnlyMode()) {
                  <app-empty-state
                    title="Aucune facture impayée" i18n-title="Aucune facture impayée"
                    description="Aucune facture fournisseur en attente de règlement."
                    actionLabel="Voir toutes les factures fournisseurs"
                    actionRoute="/supplier-invoices">
                  </app-empty-state>
                } @else {
                  <app-empty-state
                    title="Aucune facture fournisseur" i18n-title="Aucune facture fournisseur"
                    description="Créez une facture depuis un bon de commande, un bon de réception, ou directement."
                    [showAction]="canCreateSupplierInvoice()"
                    actionLabel="Nouvelle facture"
                    actionRoute="/supplier-invoices/new">
                  </app-empty-state>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
    styles: [`
    .invoice-number { font-family: var(--font-family-mono, 'JetBrains Mono', monospace); font-weight: var(--font-weight-semibold); color: var(--color-primary-600); font-size: var(--font-size-sm); }
    .supplier-name { font-weight: var(--font-weight-medium); color: var(--color-neutral-900); }
    .po-link { font-size: var(--font-size-sm); color: var(--color-primary-600); }
    .date { font-size: var(--font-size-sm); color: var(--color-neutral-600); }
    .amount { font-family: var(--font-family-mono, 'JetBrains Mono', monospace); font-weight: var(--font-weight-semibold); color: var(--color-neutral-900); }
    .type-muted { font-size: var(--font-size-sm); color: var(--color-text-tertiary); }
  `]
})
export class SupplierInvoiceListComponent implements OnInit, OnDestroy {
    private service = inject(SupplierInvoiceService);
    private supplierService = inject(SupplierService);
    private toastService = inject(ToastService);
    private auth = inject(AuthService);
    private route = inject(ActivatedRoute);
    private destroy$ = new Subject<void>();
    private searchSubject = new Subject<string>();
    private initialLoadDone = false;
    private isFirstLoad = true;

    loading = signal(true);
  initialLoad = signal(true);
    invoices = signal<SupplierInvoiceListItem[]>([]);
    totalRecords = signal(0);
    unpaidOnlyMode = signal(false);
    searchTerm = '';
    selectedStatus: SupplierInvoiceStatus | null = null;
    selectedSupplierId: string | null = null;
    supplierOptions: SupplierListItem[] = [];
    page = 1;
    pageSize = 20;

    /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
    summary = signal<SupplierInvoiceListSummary | null>(null);
    summaryLoading = signal(false);

    summaryMetrics = computed<TotalMetric[]>(() => {
        const s = this.summary();
        const currency = s?.currency ?? 'TND';
        return [
            { label: 'Factures', value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
            { label: 'Total TTC', value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
            { label: 'Total HT', value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
            { label: 'Total payé', value: s?.totalPaid, format: 'currency', currency, icon: 'pi-check-circle', tone: 'emerald' },
            { label: 'Reste à payer', value: s?.totalRemaining, format: 'currency', currency, icon: 'pi-clock', tone: 'amber' },
            { label: 'En retard', value: s?.overdueCount, format: 'number', icon: 'pi-exclamation-triangle', tone: 'rose' }
        ];
    });

    breadcrumbItems = computed<BreadcrumbItem[]>(() => {
        const base: BreadcrumbItem[] = [
            { label: 'Accueil', route: '/', icon: 'pi-home' },
            { label: 'Achats' }
        ];
        if (this.unpaidOnlyMode()) {
            base.push({ label: 'Factures fournisseurs', route: '/supplier-invoices' });
            base.push({ label: 'Factures impayées' });
        } else {
            base.push({ label: 'Factures fournisseurs' });
        }
        return base;
    });

    canCreateSupplierInvoice = computed(
        () => !this.auth.isFirmDelegatedReadonly() && this.auth.hasPermission(PERMISSIONS.supplierInvoices.create)
    );

    isStandalone(inv: SupplierInvoiceListItem): boolean {
        return !inv.purchaseOrderId && !inv.sourcePurchaseReceiptId;
    }

    skeletonColumns: SkeletonColumn[] = [
        { width: '140px' }, { width: '90px' }, { width: '200px' }, { width: '120px' }, { width: '110px' }, { width: '110px' }, { width: '120px' }, { width: '120px' }, { width: '80px' }
    ];

    statusOptions: StatusOption[] = [
        { label: 'En attente', value: SupplierInvoiceStatus.Pending },
        { label: 'Partiellement payée', value: SupplierInvoiceStatus.PartiallyPaid },
        { label: 'Payée', value: SupplierInvoiceStatus.Paid },
        { label: 'Annulée', value: SupplierInvoiceStatus.Cancelled }
    ];

    ngOnInit(): void {
        this.unpaidOnlyMode.set(this.route.snapshot.data['unpaidOnly'] === true);
        this.route.data.pipe(takeUntil(this.destroy$)).subscribe((data) => {
            this.unpaidOnlyMode.set(data['unpaidOnly'] === true);
        });
        this.applyFiltersFromQuery(this.route.snapshot.queryParamMap);
        this.searchSubject.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => this.onSearch());
        this.loadSuppliers();
        this.loadInvoices();
    }

    private applyFiltersFromQuery(paramMap: ParamMap): void {
        const applied = applySupplierInvoiceListFiltersFromQuery(paramMap, {
            selectedStatus: this.selectedStatus,
            selectedSupplierId: this.selectedSupplierId,
            search: this.searchTerm || null
        });
        this.selectedStatus = applied.selectedStatus as SupplierInvoiceStatus | null;
        if (applied.selectedSupplierId) {
            this.selectedSupplierId = applied.selectedSupplierId;
        }
        if (applied.search) {
            this.searchTerm = applied.search;
        }
    }

    private loadSuppliers(): void {
        this.supplierService.getSuppliers({ pageSize: 200, isActive: true }).subscribe({
            next: (response) => {
                if (response.success && response.data?.items) {
                    this.supplierOptions = response.data.items;
                }
            }
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.searchSubject.complete();
    }

    loadInvoices(): void {
        if (this.loading() && this.invoices().length > 0) return;
        this.loading.set(true);
        const params: SupplierInvoiceSearchParams = {
            search: this.searchTerm || undefined,
            status: this.selectedStatus ?? undefined,
            supplierId: this.selectedSupplierId || undefined,
            page: this.page,
            pageSize: this.pageSize,
            ...(this.unpaidOnlyMode() ? { unpaidOnly: true } : {})
        };
        this.loadSummary(params);
        this.service.getSupplierInvoices(params).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.invoices.set(response.data.items);
                    this.totalRecords.set(response.data.totalCount);
                    this.initialLoadDone = true;
                }
                this.loading.set(false);
        this.initialLoad.set(false);
            },
            error: (error) => {
                this.loading.set(false);
        this.initialLoad.set(false);
                this.toastService.add({ severity: 'error', summary: 'Erreur', detail: error?.error?.errors?.[0] || 'Impossible de charger les factures' });
            }
        });
    }

    /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
    private loadSummary(params: SupplierInvoiceSearchParams): void {
        this.summaryLoading.set(true);
        this.service.getSupplierInvoicesSummary(params).subscribe({
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
        this.loadInvoices();
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
        this.loadInvoices();
        this.isFirstLoad = false;
    }

    getStatusSeverity(s: SupplierInvoiceStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
        switch (s) {
            case SupplierInvoiceStatus.Pending: return 'warn';
            case SupplierInvoiceStatus.PartiallyPaid: return 'info';
            case SupplierInvoiceStatus.Paid: return 'success';
            case SupplierInvoiceStatus.Cancelled: return 'danger';
            default: return 'secondary';
        }
    }

    hasActiveFilters(): boolean {
        return !!this.searchTerm || this.selectedStatus !== null || !!this.selectedSupplierId;
    }

    activeFiltersCount(): number {
        let c = 0;
        if (this.searchTerm) c++;
        if (this.selectedStatus !== null) c++;
        if (this.selectedSupplierId) c++;
        return c;
    }

    onFilterChange(): void {
        this.page = 1;
        this.loadInvoices();
    }

    resetFilters(): void {
        this.searchTerm = '';
        this.selectedStatus = null;
        this.selectedSupplierId = null;
        this.page = 1;
        this.loadInvoices();
    }
}
