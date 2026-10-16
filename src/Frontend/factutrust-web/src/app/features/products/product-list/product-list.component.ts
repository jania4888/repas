/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService } from '@core/services/confirmation.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { PrintLabelsDialogComponent, LabelPrintTarget } from '../components/print-labels-dialog/print-labels-dialog.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ExportExcelButtonComponent } from '@shared/components/export-excel-button/export-excel-button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { ProductService, ProductListItem, ProductSearchParams } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AppModule } from '@core/models/app-module';
import { filter, take } from 'rxjs/operators';
import { applyProductListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';

interface CategoryOption {
  label: string;
  value: string | null;
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
    BarcodeScanFieldComponent,
    PrintLabelsDialogComponent,
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    ExportExcelButtonComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Produits & Services" i18n-title="@@products.product-list.produits.services.01d33b70" 
      subtitle="Gérez votre catalogue de produits et services" i18n-subtitle="@@products.product-list.gerez.votre.catalogue.de.produits.et.ser.33a68e21">
      <app-export-excel-button dataset="products" [filters]="productExportFilters" />
      @if (canCreateProduct()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@products.product-list.nouveau.produit.c31ca342"> Nouveau produit </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@products.product-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@products.product-list.reinitialiser.les.filtres.d8915f02" i18n="@@products.product-list.reinitialiser.9637f51e">
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
            placeholder="Rechercher par nom ou code..." i18n-placeholder="@@products.product-list.rechercher.par.nom.ou.code.23e048c2" 
            [(ngModel)]="searchTerm"
            (input)="onSearch()"
            class="w-full">
        </span>
        @if (barcodeScanEnabled) {
          <span class="flex-1">
            <ft-barcode-scan-field
              placeholder="Scanner un code-barres" i18n-placeholder="@@products.product-list.scanner.un.code.barres.6f3f91b0"
              [autoFocus]="false"
              (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
          </span>
        }

        <p-select 
          [options]="categoryOptions" 
          [(ngModel)]="selectedCategory"
          placeholder="Toutes les types" i18n-placeholder="@@products.product-list.toutes.les.types.946cc73a"
          [showClear]="true"
          (onChange)="onSearch()">
        </p-select>

        <p-select 
          [options]="statusOptions" 
          [(ngModel)]="selectedStatus"
          placeholder="Tous les statuts" i18n-placeholder="@@products.product-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onSearch()">
        </p-select>

        <p-select
          [options]="variantFilterOptions"
          [(ngModel)]="selectedVariantFilter"
          placeholder="Tous les produits" i18n-placeholder="@@products.product-list.tous.les.produits.02d62f0a"
          [showClear]="true"
          (onChange)="onSearch()">
        </p-select>
      </div>
    </div>

    <!-- Totaux filtrés (conformes aux filtres ; tout le jeu filtré est chargé côté client) -->
    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (initialLoad()) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table 
          [value]="products()" 
          [loading]="loading()"
          [paginator]="true"
          [rows]="20"
          [rowHover]="true"
          styleClass="p-datatable-sm">
        
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="code" style="width: 120px"><ng-container i18n="@@products.product-list.code.adac6937">Code </ng-container> <p-sortIcon field="code"></p-sortIcon></th>
            <th pSortableColumn="name"><ng-container i18n="@@products.product-list.designation.63a9062c">Désignation </ng-container> <p-sortIcon field="name"></p-sortIcon></th>
            <th i18n="@@products.product-list.type.3deb7456">Type</th>
            <th i18n="@@products.product-list.categorie.6b38300a">Catégorie</th>
            <th pSortableColumn="unitPrice" class="text-right" style="width: 140px"><ng-container i18n="@@products.product-list.prix.ht.362207ca">Prix HT </ng-container> <p-sortIcon field="unitPrice"></p-sortIcon></th>
            <th style="width: 80px" i18n="@@products.product-list.unite.388fd9c4">Unité</th>
            <th style="width: 80px" i18n="@@products.product-list.tva.fb62cb5d">TVA</th>
            <th style="width: 120px" i18n="@@products.product-list.stock.bcecf456">Stock</th>
            <th style="width: 80px" i18n="@@products.product-list.statut.659499f3">Statut</th>
            <th style="width: 140px" class="text-right" i18n="@@products.product-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-product>
          <tr>
            <td>
              <code class="product-code">{{ product.code }}</code>
            </td>
            <td>
              <div class="product-name">
                <span class="name">{{ product.name }}</span>
                @if (product.description) {
                  <span class="desc">{{ product.description }}</span>
                }
              </div>
            </td>
            <td>
              <p-tag [value]="product.typeDisplay | backendLabel" severity="info"></p-tag>
            </td>
            <td>
              <span class="product-category">{{ product.category }}</span>
            </td>
            <td class="text-right">
              <span class="price">{{ product.unitPrice | number:'1.3-3' }} TND</span>
            </td>
            <td>{{ product.unit }}</td>
            <td>{{ product.vatRate }}%</td>
            <td>
              <p-tag 
                [value]="product.isStockManaged ? loc_ui_tern_stock_active_e21445 : loc_ui_tern_sans_stock_ef7cf7" 
                [severity]="product.isStockManaged ? 'success' : 'secondary'">
              </p-tag>
              @if (product.isVariantTemplate) {
                <p-tag value="Matrice" severity="warn" styleClass="ml-1"></p-tag>
              }
              @if (product.parentProductId) {
                <p-tag value="Variante" severity="info" styleClass="ml-1"></p-tag>
              }
              @if (product.trackingMode === 1) {
                <p-tag value="Lot" severity="contrast" styleClass="ml-1"></p-tag>
              }
              @if (product.trackingMode === 2) {
                <p-tag value="Série" severity="contrast" styleClass="ml-1"></p-tag>
              }
            </td>
            <td>
              <p-tag 
                [value]="product.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033" 
                [severity]="product.isActive ? 'success' : 'secondary'">
              </p-tag>
            </td>
            <td>
              <div class="actions justify-end">
                @if (canToggleStockOnProduct() && !product.isStockManaged && product.typeDisplay === 'Produit') {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    [icon]="stockToggleLoading().has(product.id) ? 'pi-spin pi-spinner' : 'pi-box'"
                    [iconOnly]="true"
                    [disabled]="stockToggleLoading().has(product.id)"
                    pTooltip="Activer la gestion de stock" i18n-pTooltip="@@products.product-list.activer.la.gestion.de.stock.38bf89fb"
                    tooltipPosition="top"
                    (click)="enableStockManagement(product)"
                    ariaLabel="Activer la gestion de stock" i18n-ariaLabel="@@products.product-list.activer.la.gestion.de.stock.90a2c1f9">
                  </app-button>
                }
                @if (canViewProduct()) {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-eye"
                    [iconOnly]="true"
                    [routerLink]="[product.id, 'view']"
                    pTooltip="Voir les détails du produit" i18n-pTooltip="@@products.product-list.voir.les.details.du.produit.155749a5"
                    tooltipPosition="top"
                    ariaLabel="Voir les détails du produit" i18n-ariaLabel="@@products.product-list.voir.les.details.du.produit.3819c890">
                  </app-button>
                }
                @if (canEditProduct()) {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-pencil"
                    [iconOnly]="true"
                    [routerLink]="[product.id, 'edit']"
                    pTooltip="Modifier le produit" i18n-pTooltip="@@products.product-list.modifier.le.produit.aeaa8f8a"
                    tooltipPosition="top"
                    ariaLabel="Modifier le produit" i18n-ariaLabel="@@products.product-list.modifier.le.produit.525c4ebe">
                  </app-button>
                }
                @if (labelPrintingEnabled) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-print"
                    [iconOnly]="true"
                    (clicked)="openLabelDialog(product)"
                    pTooltip="Imprimer les étiquettes" i18n-pTooltip="@@products.product-list.imprimer.les.etiquettes.ff40cf1e"
                    tooltipPosition="top"
                    ariaLabel="Imprimer les étiquettes" i18n-ariaLabel="@@products.product-list.imprimer.les.etiquettes.af1e0f60">
                  </app-button>
                }
                @if (canDeleteProduct()) {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-trash"
                    [iconOnly]="true"
                    (click)="confirmDelete(product)"
                    ariaLabel="Supprimer le produit" i18n-ariaLabel="@@products.product-list.supprimer.le.produit.b683c9f4">
                  </app-button>
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="10" class="text-center p-6">
              <app-empty-state
                illustration="empty-products.svg"
                title="Aucun produit" i18n-title="@@products.product-list.aucun.produit.2cc33b12"
                description="Ajoutez votre premier produit ou service pour commencer à créer des factures." i18n-description="@@products.product-list.ajoutez.votre.premier.produit.ou.service.fdbc6d41"
                [showAction]="canCreateProduct()"
                actionLabel="Ajouter un produit" i18n-actionLabel="@@products.product-list.ajouter.un.produit.580cdfb5"
                actionRoute="new">
              </app-empty-state>
            </td>
          </tr>
        </ng-template>
        </p-table>
      }
    </div>


    <ft-print-labels-dialog
      [visible]="labelDialogVisible()"
      (visibleChange)="labelDialogVisible.set($event)"
      [target]="labelTarget()"></ft-print-labels-dialog>
  `,
  styles: [`
    .product-code {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-size: var(--font-size-sm);
      background: var(--color-neutral-100);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-sm);
    }

    .product-name {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .name {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-900);
      }

      .desc {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
      }
    }

    .price {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    .product-category {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    .justify-end {
      justify-content: flex-end;
    }

    .text-right {
      text-align: end;
    }
  `]
})
export class ProductListComponent implements OnInit {
  readonly loc_ui_tern_stock_active_e21445 = $localize`:@@ui.tern.stock.active.e21445:Stock activé`;
  readonly loc_ui_tern_sans_stock_ef7cf7 = $localize`:@@ui.tern.sans.stock.ef7cf7:Sans stock`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);
  private productService = inject(ProductService);
  private errorHandler = inject(ErrorHandlerService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;
  readonly labelPrintingEnabled = environment.featureFlags?.barcodeLabelPrinting === true;
  readonly labelDialogVisible = signal(false);
  readonly labelTarget = signal<LabelPrintTarget | null>(null);

  /** Stock module + product update (toggle uses PATCH product via update). */
  canToggleStockOnProduct = computed(() =>
    this.auth.hasModule(AppModule.Stock) && this.auth.hasPermission(PERMISSIONS.products.update)
  );

  canCreateProduct = computed(() => this.auth.hasPermission(PERMISSIONS.products.create));
  canViewProduct = computed(() => this.auth.hasPermission(PERMISSIONS.products.read));
  canEditProduct = computed(() => this.auth.hasPermission(PERMISSIONS.products.update));
  canDeleteProduct = computed(() => this.auth.hasPermission(PERMISSIONS.products.delete));

  loading = signal(true);
  initialLoad = signal(true);
  products = signal<ProductListItem[]>([]);
  totalRecords = signal(0);
  stockToggleLoading = signal<Set<string>>(new Set());

  /** Totaux de la zone, calculés sur les lignes filtrées (tout est chargé côté client). */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.products();
    return [
      { label: $localize`:@@products.product-list.ts.produits.48000473:Produits`, value: rows.length, format: 'number', icon: 'pi-box', tone: 'primary' },
      { label: $localize`:@@products.product-list.ts.actifs.4fc3a980:Actifs`, value: rows.filter(p => p.isActive).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@products.product-list.ts.inactifs.41c2d03e:Inactifs`, value: rows.filter(p => !p.isActive).length, format: 'number', icon: 'pi-ban', tone: 'neutral' },
      { label: $localize`:@@products.product-list.ts.geres.en.stock.869a3287:Gérés en stock`, value: rows.filter(p => p.isStockManaged).length, format: 'number', icon: 'pi-database', tone: 'cyan' }
    ];
  });

  searchTerm = '';
  selectedCategory: string | null = null;
  selectedStatus: boolean | null = null;
  selectedVariantFilter: string | null = null;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@products.product-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@products.product-list.ts.produits.services.01d33b70:Produits & Services` }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '200px' },
    { width: '100px' },
    { width: '100px' },
    { width: '140px' },
    { width: '80px' },
    { width: '80px' },
    { width: '120px' },
    { width: '80px' },
    { width: '140px' }
  ];

  categoryOptions: CategoryOption[] = [
    { label: $localize`:@@products.product-list.ts.produits.48000473:Produits`, value: 'Produit' },
    { label: $localize`:@@products.product-list.ts.services.5cbd5840:Services`, value: 'Service' },
    { label: $localize`:@@products.product-list.ts.abonnements.da06ab9a:Abonnements`, value: 'Abonnement' }
  ];

  statusOptions = [
    { label: $localize`:@@products.product-list.ts.actifs.4fc3a980:Actifs`, value: true },
    { label: $localize`:@@products.product-list.ts.inactifs.41c2d03e:Inactifs`, value: false }
  ];

  variantFilterOptions = [
    { label: $localize`:@@products.product-list.ts.masquer.les.modeles.d0f1732d:Masquer les modèles`, value: 'hideTemplates' },
    { label: $localize`:@@products.product-list.ts.modeles.uniquement.9c4bbd0f:Modèles uniquement`, value: 'templates' },
    { label: $localize`:@@products.product-list.ts.variantes.sku.7eac26ca:Variantes (SKU)`, value: 'variants' },
    { label: $localize`:@@products.product-list.ts.produits.simples.f2dc61d3:Produits simples`, value: 'simple' }
  ];

  hasActiveFilters = computed(() => {
    return !!(this.searchTerm || this.selectedCategory || this.selectedStatus !== null || this.selectedVariantFilter);
  });

  activeFiltersCount = computed(() => {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedCategory) count++;
    if (this.selectedStatus !== null) count++;
    if (this.selectedVariantFilter) count++;
    return count;
  });

  ngOnInit(): void {
    this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
      const applied = applyProductListFiltersFromQuery(paramMap, {
        search: this.searchTerm || null
      });
      if (applied.search) {
        this.searchTerm = applied.search;
      }
    });

    this.loadProducts();

    // Écouter les changements de route pour rafraîchir la liste après création/modification
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        // Rafraîchir la liste si on revient de la page de création/modification
        const url = this.router.url;
        if (url === '/products' || url.startsWith('/products?')) {
          this.loadProducts();
        }
      });
  }

  readonly productExportFilters = () => {
    const filters: {
      search: string | null;
      categoryId: string | null;
      isActive: boolean | null;
      excludeVariantTemplates?: boolean;
      isVariantTemplate?: boolean;
      hasParentProduct?: boolean;
    } = {
      search: this.searchTerm || null,
      categoryId: this.selectedCategory,
      isActive: this.selectedStatus
    };
    switch (this.selectedVariantFilter) {
      case 'hideTemplates':
        filters.excludeVariantTemplates = true;
        break;
      case 'templates':
        filters.isVariantTemplate = true;
        break;
      case 'variants':
        filters.hasParentProduct = true;
        break;
      case 'simple':
        filters.hasParentProduct = false;
        filters.isVariantTemplate = false;
        break;
    }
    return filters;
  };

  loadProducts(): void {
    this.loading.set(true);

    const params: ProductSearchParams = {
      search: this.searchTerm || undefined,
      category: this.selectedCategory || undefined,
      isActive: this.selectedStatus !== null ? this.selectedStatus : undefined,
      page: 1,
      pageSize: 100 // Charger tous les produits pour l'instant
    };

    switch (this.selectedVariantFilter) {
      case 'hideTemplates':
        params.excludeVariantTemplates = true;
        break;
      case 'templates':
        params.isVariantTemplate = true;
        break;
      case 'variants':
        params.hasParentProduct = true;
        break;
      case 'simple':
        params.hasParentProduct = false;
        params.isVariantTemplate = false;
        break;
    }

    this.productService.getProducts(params).subscribe({
      next: (response) => {
        if (response.success) {
          this.products.set(response.data.items);
          this.totalRecords.set(response.data.totalCount);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-list.component.summary.Erreur:Erreur`,
            detail: response.errors?.join(', ') || $localize`:@@products.product-list.ts.impossible.de.charger.les.produits.a97081a2:Impossible de charger les produits`
          });
          this.products.set([]);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-list.component.summary.Erreur:Erreur`,
          detail: errorMessage || $localize`:@@products.product-list.ts.impossible.de.charger.les.produits.a97081a2:Impossible de charger les produits`
        });
        this.errorHandler.logError('Failed to load products', error);
        this.products.set([]);
        this.loading.set(false);
        this.initialLoad.set(false);
      }
    });
  }

  onSearch(): void {
    this.loadProducts();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = null;
    this.selectedStatus = null;
    this.selectedVariantFilter = null;
    this.loadProducts();
  }

  isStockToggleLoading(productId: string): boolean {
    return this.stockToggleLoading().has(productId);
  }

  enableStockManagement(product: ProductListItem): void {
    this.confirmationService.confirm({
      message: $localize`:@@products.product-list.ts.etes.vous.sur.de.vouloir.activer.la.gest.3652c0ec:Êtes-vous sûr de vouloir activer la gestion de stock pour le produit "${product.name}:name:" ? Il n'est pas possible de désactiver cette fonctionnalité une fois activée.`,
      header: $localize`:@@products.product-list.ts.confirmation.d.activation.e200cba4:Confirmation d'activation`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@product-list.component.acceptLabel.Oui, activer:Oui, activer`,
      rejectLabel: $localize`:@@product-list.component.rejectLabel.Non_annuler:Non, annuler`,
      acceptButtonStyleClass: 'btn-primary',
      accept: () => {
        const currentSet = new Set(this.stockToggleLoading());
        currentSet.add(product.id);
        this.stockToggleLoading.set(currentSet);

        const request = {
          code: product.code,
          name: product.name,
          description: product.description ?? null,
          category: product.typeDisplay,
          productCategoryId: product.categoryId || undefined,
          unitPrice: product.unitPrice,
          purchasePrice: product.purchasePrice ?? null,
          unit: product.unit,
          vatRate: product.vatRate,
          isActive: product.isActive,
          isStockManaged: true
        };

        this.productService.updateProduct(product.id, request).subscribe({
          next: (response) => {
            const newSet = new Set(this.stockToggleLoading());
            newSet.delete(product.id);
            this.stockToggleLoading.set(newSet);

            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@product-list.component.summary.Succès:Succès`,
                detail: $localize`:@@product-list.component.detail.La_gestion_de_st:La gestion de stock a été activée avec succès`
              });
              this.loadProducts(); // Rafraîchir la liste
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@product-list.component.summary.Erreur:Erreur`,
                detail: response.errors?.join(', ') || $localize`:@@products.product-list.ts.impossible.d.activer.la.gestion.de.stock.49710ff2:Impossible d'activer la gestion de stock`
              });
            }
          },
          error: (error) => {
            const newSet = new Set(this.stockToggleLoading());
            newSet.delete(product.id);
            this.stockToggleLoading.set(newSet);

            const errorMessage = this.errorHandler.extractErrorMessage(error);
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-list.component.summary.Erreur:Erreur`,
              detail: errorMessage || $localize`:@@products.product-list.ts.impossible.d.activer.la.gestion.de.stock.49710ff2:Impossible d'activer la gestion de stock`
            });
            this.errorHandler.logError('Failed to enable stock management', error);
          }
        });
      }
    });
  }

  confirmDelete(product: ProductListItem): void {
    this.confirmationService.confirm({
      message: $localize`:@@products.product-list.ts.etes.vous.sur.de.vouloir.supprimer.le.pr.23339b70:Êtes-vous sûr de vouloir supprimer le produit "${product.name}:name:" ?`,
      header: $localize`:@@products.product-list.ts.confirmation.de.suppression.6a082d0b:Confirmation de suppression`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@product-list.component.acceptLabel.Oui, supprim:Oui, supprimer`,
      rejectLabel: $localize`:@@product-list.component.rejectLabel.Non_annuler:Non, annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.productService.deleteProduct(product.id).subscribe({
          next: (response) => {
            if (response.success) {
              this.toastService.add({
                severity: 'success',
                summary: $localize`:@@product-list.component.summary.Succès:Succès`,
                detail: $localize`:@@product-list.component.detail.Produit supp:Produit supprimé avec succès`
              });
              this.loadProducts(); // Rafraîchir la liste
            } else {
              this.toastService.add({
                severity: 'error',
                summary: $localize`:@@product-list.component.summary.Erreur:Erreur`,
                detail: response.errors?.join(', ') || $localize`:@@products.product-list.ts.impossible.de.supprimer.le.produit.80de49b9:Impossible de supprimer le produit`
              });
            }
          },
          error: (error) => {
            const errorMessage = this.errorHandler.extractErrorMessage(error);
            this.errorHandler.logError('Failed to delete product', error);
            this.confirmationService.alert({
              message: errorMessage || $localize`:@@products.product-list.ts.impossible.de.supprimer.le.produit.80de49b9:Impossible de supprimer le produit`,
              header: $localize`:@@products.product-list.ts.impossible.de.supprimer.0300380e:Impossible de supprimer`,
              icon: 'pi pi-exclamation-triangle'
            });
          }
        });
      }
    });
  }

  /**
   * Scan d'un code-barres depuis la liste des articles.
   *
   * Écran de consultation : le scan ne modifie rien. Un article reconnu ouvre directement sa
   * fiche, ce qui répond au besoin réel — « quel est cet article que j'ai en main ». Sinon, le
   * code est versé dans la recherche pour que l'utilisateur voie ce qui s'en approche plutôt
   * que de rester devant un refus sec.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup
      .resolve(code, { requireActive: false })
      .subscribe(result => {
        if (result.status === 'found' && result.product) {
          this.router.navigate(['/products', result.product.id]);
          return;
        }

        this.searchTerm = code;
        this.onSearch();
        this.barcodeFeedback.report(result);
      });
  }

  openLabelDialog(product: ProductListItem): void {
    this.labelTarget.set({
      id: product.id,
      name: product.name,
      hasBarcode: !!product.barcode
    });
    this.labelDialogVisible.set(true);
  }
}
