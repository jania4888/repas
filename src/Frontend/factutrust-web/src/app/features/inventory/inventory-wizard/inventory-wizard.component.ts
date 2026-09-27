/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed, effect, untracked, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

import {
    InventoryService,
    ActiveInventoryDto,
    InventorySummaryDto,
    InventoryType,
    InventoryProductItem,
    RecordCountRequest,
    RecordCountResult,
    StartInventoryRequest
} from '@core/services/inventory.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { StockService, SimpleStockItem, Warehouse } from '@core/services/stock.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { TRACKING_MODE_LOT, coerceTrackingMode } from '@shared/utils/stock-traceability.utils';

import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { RippleModule } from 'primeng/ripple';
import { ProgressBarModule } from 'primeng/progressbar';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';

type WizardStep = 'start' | 'count' | 'summary' | 'success';

@Component({
    selector: 'app-inventory-wizard',
    standalone: true,
    imports: [
        BarcodeScanFieldComponent,
        CommonModule,
        FormsModule,
        RouterModule,
        ButtonModule,
        InputNumberModule,
        ToastModule,
        ProgressSpinnerModule,
        RippleModule,
        ProgressBarModule,
        CheckboxModule,
        InputTextModule,
        SelectModule,
        PageHeaderComponent,
        BreadcrumbComponent,
        FormSectionComponent,
        ButtonComponent
    ],
    templateUrl: './inventory-wizard.component.html',
    styleUrl: './inventory-wizard.component.scss',
    providers: [MessageService]
})
export class InventoryWizardComponent implements OnInit, AfterViewChecked {
    private inventoryService = inject(InventoryService);
    private stockService = inject(StockService);
    private messageService = inject(MessageService);
    private confirmationService = inject(ConfirmationService);
    private errorHandler = inject(ErrorHandlerService);
    private router = inject(Router);
    private readonly barcodeLookup = inject(BarcodeLookupService);
    private readonly barcodeFeedback = inject(BarcodeFeedbackService);
    readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;

    readonly InventoryType = InventoryType;

    @ViewChild('countInput') countInputRef?: ElementRef;

    // State
    step = signal<WizardStep>('start');
    loading = signal(true);
    submitting = signal(false);

    // Data
    activeInventory = signal<ActiveInventoryDto | null>(null);
    inventorySummary = signal<InventorySummaryDto | null>(null);

    // Start step
    inventoryType = signal<InventoryType>(InventoryType.Complete);
    availableProducts = signal<SimpleStockItem[]>([]);
    selectedProductIds = signal<Set<string>>(new Set());
    productSearchTerm = signal('');
    loadingProducts = signal(false);
    warehouses: Warehouse[] = [];
    selectedWarehouse = signal<Warehouse | null>(null);

    // Count step
    currentProductIndex = signal(0);
    countedQuantity = signal(0);
    lotNumber = signal('');
    lastCountResult = signal<RecordCountResult | null>(null);
    private focusCountInputPending = false;

    // Computed
    currentProduct = computed(() => {
        const inventory = this.activeInventory();
        const index = this.currentProductIndex();
        if (!inventory || index >= inventory.products.length) return null;
        return inventory.products[index];
    });

    progress = computed(() => {
        const inventory = this.activeInventory();
        if (!inventory) return 0;
        return inventory.progressPercent;
    });

    countDifference = computed(() => {
        const product = this.currentProduct();
        if (!product) return null;
        return this.countedQuantity() - product.theoreticalQuantity;
    });

    needsOpeningLotNumber = computed(() => {
        const product = this.currentProduct();
        if (!product) return false;
        return this.needsOpeningLotForProduct(product);
    });

    requiresLotNumberForCurrentCount = computed(() => {
        const diff = this.countDifference();
        return this.needsOpeningLotNumber() && diff !== null && diff !== 0;
    });

    filteredProducts = computed(() => {
        const products = this.availableProducts();
        const search = this.productSearchTerm().toLowerCase().trim();
        if (!search) return products;
        return products.filter(p =>
            p.productName.toLowerCase().includes(search) ||
            (p.productCode?.toLowerCase().includes(search) ?? false)
        );
    });

    canStartPartialInventory = computed(() => {
        return this.inventoryType() !== InventoryType.Partial ||
            this.selectedProductIds().size > 0;
    });

    lineKey(line: { productId: string; productLotId?: string | null }): string {
        return `${line.productId}::${line.productLotId ?? ''}`;
    }

    needsOpeningLotForProduct(product: InventoryProductItem): boolean {
        return coerceTrackingMode(product.trackingMode) === TRACKING_MODE_LOT && !product.productLotId;
    }

    productsMissingLot = computed(() => {
        const summary = this.inventorySummary();
        const inventory = this.activeInventory();
        const fromSummary = summary?.productsWithDifferenceList ?? [];
        if (fromSummary.length > 0) {
            const byKey = new Map((inventory?.products ?? []).map(p => [this.lineKey(p), p]));
            return fromSummary.filter(item => {
                const live = byKey.get(this.lineKey(item));
                const tracking = item.trackingMode ?? live?.trackingMode;
                return coerceTrackingMode(tracking) === TRACKING_MODE_LOT
                    && !item.productLotId
                    && !item.lotNumber?.trim();
            });
        }
        return (inventory?.products ?? []).filter(p =>
            this.needsOpeningLotForProduct(p)
            && p.isCounted
            && p.countedQuantity != null
            && p.countedQuantity !== p.theoreticalQuantity
            && !p.lotNumber?.trim()
        );
    });

    showWarehousePicker = computed(() => this.warehouses.length > 1);

    wizardSteps = computed(() => {
        const current = this.step();
        return [
            { key: 'start' as const, label: 'Lancement', active: current === 'start', done: current !== 'start' },
            { key: 'count' as const, label: 'Comptage', active: current === 'count', done: current === 'summary' || current === 'success' },
            { key: 'summary' as const, label: 'Résumé', active: current === 'summary', done: current === 'success' },
            { key: 'success' as const, label: 'Terminé', active: current === 'success', done: false }
        ];
    });

    // Breadcrumb
    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Mon Stock', route: '/stock' },
        { label: 'Inventaire physique' }
    ];

    constructor() {
        effect(() => {
            const isPartial = this.inventoryType() === InventoryType.Partial;
            const hasNoProducts = this.availableProducts().length === 0;

            if (isPartial && hasNoProducts) {
                untracked(() => this.loadAvailableProducts());
            }
        });
    }

    ngOnInit(): void {
        this.loadWarehouses();
        this.checkActiveInventory();
    }

    ngAfterViewChecked(): void {
        if (this.focusCountInputPending && this.countInputRef) {
            this.focusCountInputPending = false;
            const input = this.countInputRef.nativeElement?.querySelector?.('input')
                ?? this.countInputRef.nativeElement;
            input?.focus?.();
            input?.select?.();
        }
    }

    loadWarehouses(): void {
        this.stockService.getWarehouses(true).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.warehouses = response.data;
                    const defaultWh = response.data.find(w => w.isDefault) ?? response.data[0] ?? null;
                    const previousId = this.selectedWarehouse()?.id;
                    this.selectedWarehouse.set(defaultWh);
                    // Re-check active inventory once warehouse is known (multi-warehouse safe)
                    if (defaultWh && defaultWh.id !== previousId && this.step() === 'start') {
                        this.checkActiveInventory();
                    }
                }
            },
            error: () => {
                // Non-blocking: wizard can still run with default warehouse on backend
            }
        });
    }

    onWarehouseChange(warehouse: Warehouse | null): void {
        this.selectedWarehouse.set(warehouse);
        this.checkActiveInventory();
    }

    checkActiveInventory(): void {
        this.loading.set(true);
        const warehouseId = this.selectedWarehouse()?.id;
        this.inventoryService.getActiveInventory(warehouseId).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.activeInventory.set(response.data);
                    this.step.set('count');
                    this.findNextUncountedProduct();
                } else {
                    this.activeInventory.set(null);
                    if (this.step() === 'count') {
                        this.step.set('start');
                    }
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@inventory-wizard.component.detail.Impossible_de_ch:Impossible de charger les inventaires`
                });
            }
        });
    }

    // --- START STEP ---

    loadAvailableProducts(): void {
        this.loadingProducts.set(true);
        this.stockService.getSimpleOverview().subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.availableProducts.set(response.data.items);
                }
                this.loadingProducts.set(false);
            },
            error: () => {
                this.loadingProducts.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@inventory-wizard.component.detail.impossible.de.charger.les.produits.a97081a2:Impossible de charger les produits`
                });
            }
        });
    }

    toggleProductSelection(productId: string): void {
        const current = new Set(this.selectedProductIds());
        if (current.has(productId)) {
            current.delete(productId);
        } else {
            current.add(productId);
        }
        this.selectedProductIds.set(current);
    }

    isProductSelected(productId: string): boolean {
        return this.selectedProductIds().has(productId);
    }

    selectAllProducts(): void {
        const allIds = new Set(this.filteredProducts().map(p => p.productId));
        this.selectedProductIds.set(allIds);
    }

    clearProductSelection(): void {
        this.selectedProductIds.set(new Set());
    }

    startInventory(): void {
        this.submitting.set(true);
        const request: StartInventoryRequest = {
            type: this.inventoryType()
        };

        const warehouseId = this.selectedWarehouse()?.id;
        if (warehouseId) {
            request.warehouseId = warehouseId;
        }

        if (this.inventoryType() === InventoryType.Partial) {
            request.productIds = Array.from(this.selectedProductIds());
        }

        this.inventoryService.startInventory(request).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.messageService.add({
                        severity: 'success',
                        summary: $localize`:@@inventory-wizard.component.summary.Inventaire_lanc_:Inventaire lancé !`,
                        detail: response.data.humanMessage
                    });
                    this.checkActiveInventory();
                }
                this.submitting.set(false);
            },
            error: (error) => {
                this.submitting.set(false);
                const errorMessage = error?.error?.message
                    || error?.error?.error
                    || error?.error?.globalErrors?.[0]
                    || 'Impossible de démarrer l\'inventaire';
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: errorMessage
                });
            }
        });
    }

    // --- COUNT STEP ---

    findNextUncountedProduct(): void {
        const inventory = this.activeInventory();
        if (!inventory) return;

        const index = inventory.products.findIndex(p => !p.isCounted);
        if (index !== -1) {
            this.currentProductIndex.set(index);
            const product = inventory.products[index];
            this.countedQuantity.set(product.theoreticalQuantity);
            this.lotNumber.set(product.lotNumber ?? '');
            this.focusCountInputPending = true;
        }
    }

    navigateToProduct(index: number): void {
        this.currentProductIndex.set(index);
        const product = this.activeInventory()?.products[index];
        if (product) {
            this.countedQuantity.set(product.isCounted && product.countedQuantity !== null
                ? product.countedQuantity
                : product.theoreticalQuantity);
            this.lotNumber.set(product.lotNumber ?? '');
            this.focusCountInputPending = true;
        }
    }

    onCountedQuantityChange(value: number | null): void {
        this.countedQuantity.set(value ?? 0);
    }

    onCountKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !this.submitting()) {
            event.preventDefault();
            this.submitCount();
        }
    }

    submitCount(): void {
        const inventory = this.activeInventory();
        const product = this.currentProduct();
        if (!inventory || !product) return;

        if (this.requiresLotNumberForCurrentCount() && !this.lotNumber().trim()) {
            this.messageService.add({
                severity: 'warn',
                summary: $localize`:@@inventory-wizard.component.summary.N° de lot re:N° de lot requis`,
                detail: $localize`:@@inventory-wizard.component.detail.Saisissez_un_num:Saisissez un numéro de lot pour cet article suivi (inventaire d'ouverture).`
            });
            return;
        }

        this.submitting.set(true);
        const payload: RecordCountRequest = {
            productId: product.productId,
            countedQuantity: this.countedQuantity()
        };
        if (product.productLotId) {
            payload.productLotId = product.productLotId;
        } else if (this.needsOpeningLotForProduct(product) && this.lotNumber().trim()) {
            payload.lotNumber = this.lotNumber().trim();
        }

        this.inventoryService.recordCount(inventory.inventoryId, payload).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.lastCountResult.set(response.data);
                    this.messageService.add({
                        severity: 'success',
                        summary: $localize`:@@inventory-wizard.component.summary.Comptage_enregis:Comptage enregistré`,
                        detail: response.data.humanMessage
                    });
                    this.refreshAndMoveNext();
                }
                this.submitting.set(false);
            },
            error: (err) => {
                this.submitting.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: this.errorHandler.extractErrorMessage(err) ?? $localize`:@@ui.tern.impossible.d.enregistrer.le.comptage.b4a869:Impossible d'enregistrer le comptage`
                });
            }
        });
    }

    private refreshAndMoveNext(): void {
        const warehouseId = this.activeInventory()?.warehouseId ?? this.selectedWarehouse()?.id;
        this.inventoryService.getActiveInventory(warehouseId).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.activeInventory.set(response.data);

                    if (response.data.remainingProducts === 0) {
                        this.goToSummary();
                    } else {
                        this.findNextUncountedProduct();
                    }
                }
            }
        });
    }

    // --- SUMMARY STEP ---

    goToSummary(): void {
        const inventory = this.activeInventory();
        if (!inventory) return;

        this.loading.set(true);
        this.inventoryService.getSummary(inventory.inventoryId).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.inventorySummary.set(response.data);
                    this.step.set('summary');
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@inventory-wizard.component.detail.impossible.de.charger.le.resume.e18c7605:Impossible de charger le résumé`
                });
            }
        });
    }

    goToFirstMissingLot(): void {
        const first = this.productsMissingLot()[0];
        this.step.set('count');
        if (!first) return;

        const index = this.activeInventory()?.products.findIndex(p => this.lineKey(p) === this.lineKey(first)) ?? -1;
        if (index >= 0) {
            this.navigateToProduct(index);
        }
    }

    validateInventory(): void {
        const inventory = this.activeInventory();
        if (!inventory) return;

        const missing = this.productsMissingLot();
        if (missing.length > 0 || this.inventorySummary()?.canValidate === false) {
            const names = missing.map(item => `« ${item.productName} »`).join(', ');
            this.messageService.add({
                severity: 'warn',
                summary: $localize`:@@inventory-wizard.component.summary.N° de lot re:N° de lot requis`,
                detail: names
                    ? $localize`:@@ui.tern.saisissez.un.numero.de.lot.pour.ph.article.7c7998:Saisissez un numéro de lot pour ${names}:p0: (article suivi par lot).`
                    : (this.inventorySummary()?.statusMessage
                        ?? $localize`:@@ui.tern.saisissez.les.numeros.de.lot.manquants.ava.fa6d2f:Saisissez les numéros de lot manquants avant de valider.`)
            });
            return;
        }

        this.submitting.set(true);
        this.inventoryService.validateInventory(inventory.inventoryId).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.messageService.add({
                        severity: 'success',
                        summary: $localize`:@@inventory-wizard.component.summary.Inventaire_valid:Inventaire validé !`,
                        detail: response.data.humanMessage
                    });
                    this.step.set('success');
                }
                this.submitting.set(false);
            },
            error: (err) => {
                this.submitting.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: this.errorHandler.extractErrorMessage(err) ?? $localize`:@@ui.tern.impossible.de.valider.l.inventaire.2555f5:Impossible de valider l'inventaire`
                });
            }
        });
    }

    confirmCancelInventory(): void {
        this.confirmationService.confirm({
            header: 'Annuler l\'inventaire',
            message: 'Les comptages non validés seront perdus. Voulez-vous vraiment annuler cet inventaire ?',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: $localize`:@@inventory-wizard.component.acceptLabel.Annuler_l_invent:Annuler l'inventaire`,
            rejectLabel: $localize`:@@inventory-wizard.component.rejectLabel.Continuer_le_com:Continuer le comptage`,
            acceptButtonStyleClass: 'btn-danger',
            size: 'md',
            accept: () => this.cancelInventory()
        });
    }

    cancelInventory(): void {
        const inventory = this.activeInventory();
        if (!inventory) return;

        this.submitting.set(true);
        this.inventoryService.cancelInventory(inventory.inventoryId).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.messageService.add({
                        severity: 'info',
                        summary: $localize`:@@inventory-wizard.component.summary.Inventaire_annul:Inventaire annulé`,
                        detail: response.data.humanMessage
                    });
                    this.activeInventory.set(null);
                    this.step.set('start');
                }
                this.submitting.set(false);
            },
            error: () => {
                this.submitting.set(false);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-wizard.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@inventory-wizard.component.detail.Impossible_d_ann:Impossible d'annuler l'inventaire`
                });
            }
        });
    }

    goToStock(): void {
        this.router.navigate(['/stock']);
    }

    goToList(): void {
        this.router.navigate(['/inventory'], { replaceUrl: true });
    }

    startNew(): void {
        this.activeInventory.set(null);
        this.inventorySummary.set(null);
        this.step.set('start');
    }

    /**
     * Scan d'un code-barres pendant le comptage.
     *
     * Contrairement aux écrans de document, le scan ne CRÉE rien : le périmètre de
     * l'inventaire est arrêté à son ouverture, et y ajouter une ligne fausserait l'écart
     * théorique/compté. Le scan sert à se positionner — il amène directement sur l'article à
     * compter et met le focus dans le champ de quantité, ce qui évite de le chercher dans une
     * liste de plusieurs centaines de références.
     *
     * Un article hors périmètre est signalé, jamais ajouté silencieusement.
     */
    onBarcodeScanned(code: string): void {
        if (this.step() !== 'count') return;

        this.barcodeLookup
            .resolve(code, { warehouseId: this.activeInventory()?.warehouseId ?? null })
            .subscribe(result => {
                if (result.status !== 'found' || !result.product) {
                    this.barcodeFeedback.report(result);
                    return;
                }

                const product = result.product;
                const products = this.activeInventory()?.products ?? [];
                const index = products.findIndex(p => p.productId === product.id);

                if (index === -1) {
                    this.barcodeFeedback.failure(
                        `« ${product.name} » ne fait pas partie du périmètre de cet inventaire.`,
                        'Hors périmètre'
                    );
                    return;
                }

                this.navigateToProduct(index);
                this.barcodeFeedback.success(product.name);
            });
    }
}
