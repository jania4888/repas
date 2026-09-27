/// <reference types="@angular/localize" />
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
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';

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
        EmptyStateComponent, ButtonComponent, TableTotalsBarComponent, BackendLabelPipe
    ],
    template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header
      [title]="unpaidOnlyMode() ? loc_ui_tern_factures_impayees_fournisseurs_12bded : loc_ui_tern_factures_fournisseurs_1dcbc2"
      [subtitle]="unpaidOnlyMode() ? loc_ui_tern_factures_fournisseurs_non_reglees_ou_parti_50d35b : loc_ui_tern_consultez_et_gerez_les_factures_fournisseu_77faa5">
      @if (canCreateSupplierInvoice() && !unpaidOnlyMode()) {
        <app-button
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@supplier-invoices.supplier-invoice-list.nouvelle.facture.cdf7e09c"> Nouvelle facture </app-button>
      }
    </app-page-header>

    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@supplier-invoices.supplier-invoice-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button class="ft-filters__reset" (click)="resetFilters()" aria-label="Réinitialiser les filtres" i18n-aria-label="@@supplier-invoices.supplier-invoice-list.reinitialiser.les.filtres.d8915f02" i18n="@@supplier-invoices.supplier-invoice-list.reinitialiser.9637f51e">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left flex-1">
          <i class="pi pi-search"></i>
          <input pInputText type="text"
            placeholder="Rechercher par n° facture, fournisseur…" i18n-placeholder="@@supplier-invoices.supplier-invoice-list.rechercher.par.n.facture.fournisseur.f88033f2"
            [(ngModel)]="searchTerm"
            (input)="onSearchInput($event)"
            class="w-full">
        </span>
        <p-select
          [options]="statusOptions"
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@supplier-invoices.supplier-invoice-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>
        <p-select
          [options]="supplierOptions"
          [(ngModel)]="selectedSupplierId"
          optionLabel="name"
          optionValue="id"
          placeholder="Tous les fournisseurs" i18n-placeholder="@@supplier-invoices.supplier-invoice-list.tous.les.fournisseurs.0e8a9fae"
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
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} factures" i18n-currentPageReportTemplate="@@supplier-invoices.supplier-invoice-list.affichage.de.first.a.last.sur.totalrecords.factu.5b810a90"
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
              <td><p-tag [value]="inv.statusDisplay | backendLabel" [severity]="getStatusSeverity(inv.status)"></p-tag></td>
              <td>
                <app-button variant="ghost" size="sm" icon="pi-eye" [iconOnly]="true" [routerLink]="inv.id" ariaLabel="Voir" i18n-ariaLabel="@@supplier-invoices.supplier-invoice-list.voir.f2dabbea"></app-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center p-6">
                @if (unpaidOnlyMode()) {
                  <app-empty-state
                    title="Aucune facture impayée" i18n-title="@@supplier-invoices.supplier-invoice-list.aucune.facture.impayee.6da9b1d9"
                    description="Aucune facture fournisseur en attente de règlement." i18n-description="@@supplier-invoices.supplier-invoice-list.aucune.facture.fournisseur.en.attente.de.5775edcb"
                    actionLabel="Voir toutes les factures fournisseurs" i18n-actionLabel="@@supplier-invoices.supplier-invoice-list.voir.toutes.les.factures.fournisseurs.8c337291"
                    actionRoute="/supplier-invoices">
                  </app-empty-state>
                } @else {
                  <app-empty-state
                    title="Aucune facture fournisseur" i18n-title="@@supplier-invoices.supplier-invoice-list.aucune.facture.fournisseur.7b87b354"
                    description="Créez une facture depuis un bon de commande, un bon de réception, ou directement." i18n-description="@@supplier-invoices.supplier-invoice-list.creez.une.facture.depuis.un.bon.de.comma.804f26c6"
                    [showAction]="canCreateSupplierInvoice()"
                    actionLabel="Nouvelle facture" i18n-actionLabel="@@supplier-invoices.supplier-invoice-list.nouvelle.facture.dd11a962"
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
  readonly loc_ui_tern_factures_impayees_fournisseurs_12bded = $localize`:@@ui.tern.factures.impayees.fournisseurs.12bded:Factures impayées fournisseurs`;
  readonly loc_ui_tern_factures_fournisseurs_1dcbc2 = $localize`:@@ui.tern.factures.fournisseurs.1dcbc2:Factures fournisseurs`;
  readonly loc_ui_tern_factures_fournisseurs_non_reglees_ou_parti_50d35b = $localize`:@@ui.tern.factures.fournisseurs.non.reglees.ou.parti.50d35b:Factures fournisseurs non réglées ou partiellement réglées.`;
  readonly loc_ui_tern_consultez_et_gerez_les_factures_fournisseu_77faa5 = $localize`:@@ui.tern.consultez.et.gerez.les.factures.fournisseu.77faa5:Consultez et gérez les factures fournisseurs et leur statut de paiement.`;
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
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.factures.da35e4f2:Factures`, value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.total.ttc.9e80ff7c:Total TTC`, value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.total.ht.2ca17ae6:Total HT`, value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.total.paye.57d30be5:Total payé`, value: s?.totalPaid, format: 'currency', currency, icon: 'pi-check-circle', tone: 'emerald' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.reste.a.payer.968444fc:Reste à payer`, value: s?.totalRemaining, format: 'currency', currency, icon: 'pi-clock', tone: 'amber' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.en.retard.40c1dde3:En retard`, value: s?.overdueCount, format: 'number', icon: 'pi-exclamation-triangle', tone: 'rose' }
        ];
    });

    breadcrumbItems = computed<BreadcrumbItem[]>(() => {
        const base: BreadcrumbItem[] = [
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.accueil.a8ff8fd2:Accueil`, route: '/', icon: 'pi-home' },
            { label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.achats.ee5b078c:Achats` }
        ];
        if (this.unpaidOnlyMode()) {
            base.push({ label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs`, route: '/supplier-invoices' });
            base.push({ label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.factures.impayees.dc3cffa5:Factures impayées` });
        } else {
            base.push({ label: $localize`:@@supplier-invoices.supplier-invoice-list.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs` });
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
        { label: $localize`:@@supplier-invoices.list.filter.en-attente:En attente`, value: SupplierInvoiceStatus.Pending },
        { label: $localize`:@@supplier-invoices.list.filter.partielle:Partiellement payée`, value: SupplierInvoiceStatus.PartiallyPaid },
        { label: $localize`:@@supplier-invoices.list.filter.payee:Payée`, value: SupplierInvoiceStatus.Paid },
        { label: $localize`:@@supplier-invoices.list.filter.annulee:Annulée`, value: SupplierInvoiceStatus.Cancelled }
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
                this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-invoice-list.component.summary.Erreur:Erreur`, detail: error?.error?.errors?.[0] || $localize`:@@supplier-invoices.supplier-invoice-list.ts.impossible.de.charger.les.factures.583c2251:Impossible de charger les factures` });
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
