/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StockService, StockItem, Warehouse, MovementReason, RecordExitRequest, AdjustStockRequest, StockFeatures, StockLotBalance, StockValuationLayer, ExpiryAlert } from '@core/services/stock.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';

// PrimeNG Imports
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';

import { Router, RouterModule } from '@angular/router';

// Shared Components
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface StatusOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-stock-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    ToastModule,
    TooltipModule,
    ProgressBarModule,
    TagModule,
    CurrencyPipe,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    TableTotalsBarComponent
  ],
  templateUrl: './stock-list.component.html',
  styleUrl: './stock-list.component.scss'
})
export class StockListComponent implements OnInit {
  private stockService = inject(StockService);
  private productService = inject(ProductService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private errorHandler = inject(ErrorHandlerService);
  private router = inject(Router);
  private auth = inject(AuthService);

  canCreateStockVoucher = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.create));

  // Data Signals
  items = signal<StockItem[]>([]);
  filteredItems = signal<StockItem[]>([]);

  /**
   * Valeur de TOUT le stock, servie par le back et valorisée selon la méthode de chaque article.
   * Les lignes chargées ici ne sont qu'une page : les sommer donnerait un sous-total présenté
   * comme un total.
   */
  totalStockValue = signal<number | null>(null);

  /** Totaux de la zone, calculés sur les lignes filtrées. */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const items = this.filteredItems();
    return [
      { label: $localize`:@@stock.stock-list.ts.produits.48000473:Produits`, value: items.length, format: 'number', icon: 'pi-box', tone: 'primary' },
      { label: $localize`:@@stock.stock-list.ts.quantite.09a38fda:Quantité`, value: items.reduce((acc, i) => acc + i.quantityOnHand, 0), format: 'number', icon: 'pi-database', tone: 'cyan' },
      { label: $localize`:@@stock.stock-list.ts.valeur.stock.73676303:Valeur stock`, value: this.stockValueFor(items), format: 'currency', icon: 'pi-wallet', tone: 'primary' },
      { label: $localize`:@@stock.stock-list.ts.en.alerte.79f4b44b:En alerte`, value: items.filter(i => i.isLowStock && !i.isOutOfStock).length, format: 'number', icon: 'pi-exclamation-triangle', tone: 'amber' },
      { label: $localize`:@@stock.stock-list.ts.rupture.fda77001:Rupture`, value: items.filter(i => i.isOutOfStock).length, format: 'number', icon: 'pi-ban', tone: 'rose' }
    ];
  });
  warehouses: Warehouse[] = [];
  products: ProductListItem[] = [];
  productsLoaded = false;

  // UI State
  loading = signal<boolean>(true);
  initialLoad = signal<boolean>(true);
  submitting = false;
  adjustSubmitting = false;
  exitDialogVisible = false;
  adjustDialogVisible = false;
  selectedItemForAdjust: StockItem | null = null;
  lotTrackingEnabled = signal(false);
  fifoLifoValuationEnabled = signal(false);
  expiryAlerts = signal<ExpiryAlert[]>([]);
  expandedLots = signal<Record<string, StockLotBalance[]>>({});
  expandedLayers = signal<Record<string, StockValuationLayer[]>>({});

  // Filters
  searchTerm = '';
  selectedWarehouse: Warehouse | null = null;
  selectedStatus: string | null = null;

  statusOptions: StatusOption[] = [
    { label: $localize`:@@stock.list.filter.en-stock:En stock`, value: 'inStock' },
    { label: $localize`:@@stock.list.filter.faible:Stock faible`, value: 'lowStock' },
    { label: $localize`:@@stock.list.filter.rupture:Rupture`, value: 'outOfStock' }
  ];

  // Breadcrumb
  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@stock.stock-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@stock.stock-list.ts.gestion.du.stock.72df5586:Gestion du Stock` }
  ];

  // Skeleton columns for loading state
  skeletonColumns: SkeletonColumn[] = [
    { width: '180px' },
    { width: '120px' },
    { width: '100px' },
    { width: '120px' },
    { width: '100px' },
    { width: '80px' },
    { width: '120px' }
  ];

  // Form Model
  selectedExit = {
    warehouse: null as Warehouse | null,
    product: null as ProductListItem | null,
    quantity: 1,
    reason: MovementReason.SupplierReturn,
    notes: ''
  };

  exitReasons = [
    { label: $localize`:@@stock.stock-list.ts.retour.fournisseur.371de2a8:Retour Fournisseur`, value: MovementReason.SupplierReturn },
    { label: $localize`:@@stock.stock-list.ts.dommage.perte.4a8ecd42:Dommage / Perte`, value: MovementReason.Damage }
  ];

  // Adjustment Form Model
  adjustmentForm = {
    newQuantity: 0,
    notes: ''
  };

  ngOnInit(): void {
    this.loadData();
    this.loadWarehouses();
    this.loadProducts();
    this.stockService.getFeatures().subscribe({
      next: res => {
        if (res.success && res.data) {
          this.lotTrackingEnabled.set(res.data.lotTrackingEnabled);
          this.fifoLifoValuationEnabled.set(res.data.fifoLifoValuationEnabled);
          if (res.data.expiryTrackingEnabled) {
            this.stockService.getExpiryAlerts().subscribe({
              next: alerts => {
                if (alerts.success && alerts.data) this.expiryAlerts.set(alerts.data);
              }
            });
          }
        }
      }
    });
  }

  toggleLots(item: StockItem): void {
    const current = this.expandedLots();
    if (current[item.id]) {
      const next = { ...current };
      delete next[item.id];
      this.expandedLots.set(next);
      return;
    }
    this.stockService.getLots(item.id).subscribe({
      next: res => {
        this.expandedLots.set({ ...this.expandedLots(), [item.id]: res.data ?? [] });
      }
    });
  }

  toggleLayers(item: StockItem): void {
    const current = this.expandedLayers();
    if (current[item.id]) {
      const next = { ...current };
      delete next[item.id];
      this.expandedLayers.set(next);
      return;
    }
    this.stockService.getValuationLayers(item.id).subscribe({
      next: res => {
        this.expandedLayers.set({ ...this.expandedLayers(), [item.id]: res.data ?? [] });
      }
    });
  }

  costingLabel(method: number | undefined): string {
    if (method === 1) return 'FIFO';
    if (method === 2) return 'LIFO';
    return 'CMUP';
  }

  loadData() {
    this.loading.set(true);
    this.stockService.getStockItems().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.items.set(response.data.items);
          this.totalStockValue.set(response.data.totalStockValue ?? null);
          this.applyFilters();
        }
        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: (err) => {
        console.error('Error loading stock items', err);
        this.messageService.add({ severity: 'error', summary: $localize`:@@stock-list.component.summary.Erreur:Erreur`, detail: $localize`:@@stock-list.component.detail.Impossible d:Impossible de charger le stock` });
        this.loading.set(false);
        this.initialLoad.set(false);
      }
    });
  }

  loadWarehouses() {
    this.stockService.getWarehouses(true).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.warehouses = res.data;
        }
      }
    });
  }

  loadProducts() {
    // Fetch all active products for the dropdown
    // In a real scenario with many products, this should be server-side filtered on type
    this.productService.getProducts({ isActive: true, pageSize: 1000 }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          // Filter mainly physical products if distinction exists, 
          // though standard products are assumed physical for now.
          this.products = res.data.items.filter(p => p.isStockManaged);
        }
        this.productsLoaded = true;
      },
      error: (err) => {
        this.productsLoaded = true;
        console.error('Error loading products for stock exit', err);
      }
    });
  }

  /**
   * Vrai dès qu'une ligne affiche un coût de prochaine sortie : c'est la condition pour expliquer
   * à l'écran que « P.U. × Qté ≠ Valeur » sur ces lignes, au lieu de laisser croire à une erreur.
   */
  hasNextExitUnitCost(): boolean {
    return this.filteredItems().some(i => i.unitCostIsNextExit === true);
  }

  readonly nextExitUnitCostHint = $localize`:@@stock.stock-list.ts.pu.prochaine.sortie.a71f0c52:FIFO/LIFO : le P.U. affiché est le coût de la prochaine sortie. La valeur est la somme des couches restantes, donc P.U. × Qté ≠ Valeur.`;

  // --- Stats Helpers ---
  calculateTotalValue(): number {
    return this.stockValueFor(this.items());
  }

  /**
   * Le total servi par le back dès que rien n'a été filtré côté navigateur ; sinon la somme des
   * lignes retenues, qui est alors bien le total de ce que l'utilisateur regarde.
   */
  private stockValueFor(rows: StockItem[]): number {
    const serverTotal = this.totalStockValue();
    if (serverTotal !== null && rows.length === this.items().length) {
      return serverTotal;
    }
    return rows.reduce((acc, item) => acc + item.stockValue, 0);
  }

  countLowStock(): number {
    return this.items().filter(i => i.isLowStock && !i.isOutOfStock).length;
  }

  countOutOfStock(): number {
    return this.items().filter(i => i.isOutOfStock).length;
  }

  countInStock(): number {
    return this.items().filter(i => !i.isLowStock && !i.isOutOfStock).length;
  }

  // Calculate stock percentage for progress bar
  getStockPercentage(item: StockItem): number {
    if (item.minimumStock <= 0) return 100;
    const ratio = (item.quantityOnHand / (item.minimumStock * 2)) * 100;
    return Math.min(100, Math.max(0, ratio));
  }

  getStockSeverity(item: StockItem): string {
    if (item.isOutOfStock) return 'danger';
    if (item.isLowStock) return 'warn';
    return 'success';
  }

  // --- Filter Methods ---
  applyFilters(): void {
    let result = this.items();

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(i =>
        i.productName.toLowerCase().includes(term) ||
        i.productCode.toLowerCase().includes(term)
      );
    }

    if (this.selectedWarehouse) {
      result = result.filter(i => i.warehouseId === this.selectedWarehouse!.id);
    }

    if (this.selectedStatus) {
      switch (this.selectedStatus) {
        case 'inStock':
          result = result.filter(i => !i.isLowStock && !i.isOutOfStock);
          break;
        case 'lowStock':
          result = result.filter(i => i.isLowStock && !i.isOutOfStock);
          break;
        case 'outOfStock':
          result = result.filter(i => i.isOutOfStock);
          break;
      }
    }

    this.filteredItems.set(result);
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedWarehouse !== null || this.selectedStatus !== null;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedWarehouse !== null) count++;
    if (this.selectedStatus !== null) count++;
    return count;
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedWarehouse = null;
    this.selectedStatus = null;
    this.applyFilters();
  }

  // --- Exit Logic ---
  openExitDialog() {
    this.selectedExit = {
      warehouse: this.warehouses.find(w => w.isDefault) || this.warehouses[0] || null,
      product: null,
      quantity: 1,
      reason: MovementReason.SupplierReturn,
      notes: ''
    };
    this.exitDialogVisible = true;
  }

  isValidExit(): boolean {
    return !!this.selectedExit.product &&
      !!this.selectedExit.warehouse &&
      this.selectedExit.quantity > 0;
  }

  submitExit() {
    if (!this.isValidExit()) return;

    this.submitting = true;
    const request: RecordExitRequest = {
      productId: this.selectedExit.product!.id,
      warehouseId: this.selectedExit.warehouse!.id,
      quantity: this.selectedExit.quantity,
      reason: this.selectedExit.reason,
      notes: this.selectedExit.notes
    };

    this.stockService.recordExit(request, { skipGlobalErrorUi: true }).subscribe({
      next: (res) => {
        this.submitting = false;
        if (res.success) {
          this.messageService.add({ severity: 'success', summary: $localize`:@@stock-list.component.summary.Succès:Succès`, detail: $localize`:@@stock-list.component.detail.Sortie_de_stock_:Sortie de stock enregistrée` });
          this.exitDialogVisible = false;
          this.loadData(); // Refresh
        } else {
          const detail = res.errors?.join(', ') || res.message || $localize`:@@stock.stock-list.ts.erreur.ab546c23:Erreur`;
          this.confirmationService.alert({
            header: $localize`:@@stock.stock-list.ts.sortie.de.stock.impossible.803e3955:Sortie de stock impossible`,
            message: detail,
            icon: 'pi pi-exclamation-triangle'
          });
        }
      },
      error: (err) => {
        this.submitting = false;
        const msg = this.errorHandler.extractErrorMessage(err);
        this.confirmationService.alert({
          header: $localize`:@@stock.stock-list.ts.sortie.de.stock.impossible.803e3955:Sortie de stock impossible`,
          message: msg || $localize`:@@stock.stock-list.ts.echec.de.la.sortie.de.stock.d947ab02:Echec de la sortie de stock`,
          icon: 'pi pi-exclamation-triangle'
        });
        this.errorHandler.logError('Stock list exit failed', err, { consoleLevel: 'warn' });
      }
    });
  }

  // --- Adjustment Logic ---
  openAdjustDialog(item: StockItem) {
    this.selectedItemForAdjust = item;
    this.adjustmentForm = {
      newQuantity: item.quantityOnHand,
      notes: ''
    };
    this.adjustDialogVisible = true;
  }

  isValidAdjust(): boolean {
    return this.selectedItemForAdjust !== null &&
      this.adjustmentForm.newQuantity >= 0;
  }

  submitAdjust() {
    if (!this.isValidAdjust() || !this.selectedItemForAdjust) return;

    this.adjustSubmitting = true;
    const request: AdjustStockRequest = {
      productId: this.selectedItemForAdjust.productId,
      warehouseId: this.selectedItemForAdjust.warehouseId,
      newQuantity: this.adjustmentForm.newQuantity,
      notes: this.adjustmentForm.notes || undefined
    };

    this.stockService.adjustStock(request).subscribe({
      next: (res) => {
        this.adjustSubmitting = false;
        if (res.success) {
          this.messageService.add({ severity: 'success', summary: $localize`:@@stock-list.component.summary.Succès:Succès`, detail: $localize`:@@stock-list.component.detail.Stock ajusté:Stock ajusté avec succès` });
          this.adjustDialogVisible = false;
          this.selectedItemForAdjust = null;
          this.loadData(); // Refresh
        }
      },
      error: (err) => {
        this.adjustSubmitting = false;
        this.messageService.add({ severity: 'error', summary: $localize`:@@stock-list.component.summary.Erreur:Erreur`, detail: $localize`:@@stock-list.component.detail.Echec_de_l_ajust:Echec de l'ajustement du stock` });
      }
    });
  }
}
