/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';

// Services
import {
    StockService,
    SimpleStockOverview,
    SimpleStockItem,
    SimpleStockAlert,
    QuickCountResult
} from '@core/services/stock.service';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { RippleModule } from 'primeng/ripple';
import { BadgeModule } from 'primeng/badge';

// Shared Components
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';

@Component({
    selector: 'app-stock-simple',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        ButtonModule,
        DialogModule,
        InputNumberModule,
        InputTextModule,
        ToastModule,
        ProgressSpinnerModule,
        RippleModule,
        BadgeModule,
        PageHeaderComponent,
        BreadcrumbComponent,
        EmptyStateComponent,
        WarehouseSelectorComponent,
        AnalyzeWithAiButtonComponent
    ],
    templateUrl: './stock-simple.component.html',
    styleUrl: './stock-simple.component.scss'
})
export class StockSimpleComponent implements OnInit {
    private stockService = inject(StockService);
    private messageService = inject(MessageService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private elementRef = inject(ElementRef<HTMLElement>);
    readonly warehouseContext = inject(WarehouseContextService);
    private auth = inject(AuthService);

    canCreateStockMovement = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.create));

    // Data
    overview = signal<SimpleStockOverview | null>(null);
    loading = signal(true);
    searchTerm = '';

    // Quick Count Dialog
    countDialogVisible = false;
    submitting = false;
    selectedProduct: SimpleStockItem | null = null;
    actualQuantity = 0;
    countResult: QuickCountResult | null = null;

    // Breadcrumb
    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Mon Stock' }
    ];

    private pendingAlertsScroll = false;

    ngOnInit(): void {
        this.route.queryParamMap.subscribe((paramMap) => {
            this.pendingAlertsScroll = paramMap.get('alerts') === '1';
        });

        this.loadOverview();

        // Check if we need to open adjust dialog from query param
        this.route.queryParams.subscribe(params => {
            if (params['adjust']) {
                setTimeout(() => {
                    const item = this.overview()?.items.find(i => i.productId === params['adjust']);
                    if (item) this.openCountDialog(item);
                }, 500);
            }
        });
    }

    private scrollToAlertsSection(): void {
        const section = this.elementRef.nativeElement.querySelector('.alerts-section');
        if (!section) {
            return;
        }
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.classList.add('alerts-section--highlight');
        setTimeout(() => section.classList.remove('alerts-section--highlight'), 2000);
    }

    loadOverview(): void {
        this.loading.set(true);
        this.stockService.getSimpleOverview(
            this.searchTerm || undefined,
            false,
            this.warehouseContext.selectedWarehouseId() ?? undefined
        ).subscribe({
            next: (response) => {
                if (response.success && response.data) {
                    this.overview.set(response.data);
                }
                this.loading.set(false);
                if (this.pendingAlertsScroll) {
                    this.pendingAlertsScroll = false;
                    setTimeout(() => this.scrollToAlertsSection(), 100);
                }
            },
            error: (err) => {
                console.error('Error loading stock overview', err);
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@stock-simple.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@stock-simple.component.detail.impossible.de.charger.le.stock.4b95c144:Impossible de charger le stock`
                });
                this.loading.set(false);
            }
        });
    }

    onSearch(): void {
        this.loadOverview();
    }

    clearSearch(): void {
        this.searchTerm = '';
        this.loadOverview();
    }

    // =====================================================
    // QUICK COUNT DIALOG - "Compter mon stock"
    // =====================================================

    openCountDialog(item: SimpleStockItem): void {
        this.selectedProduct = item;
        this.actualQuantity = item.quantityAvailable;
        this.countResult = null;
        this.countDialogVisible = true;
    }

    openCountDialogForProduct(productId: string): void {
        const item = this.overview()?.items.find(i => i.productId === productId);
        if (item) {
            this.openCountDialog(item);
        }
    }

    closeCountDialog(): void {
        this.countDialogVisible = false;
        this.selectedProduct = null;
        this.countResult = null;
    }

    submitCount(): void {
        if (!this.selectedProduct) return;

        this.submitting = true;
        this.stockService.quickCount({
            productId: this.selectedProduct.productId,
            actualQuantity: this.actualQuantity,
            warehouseId: this.warehouseContext.selectedWarehouseId() ?? undefined
        }).subscribe({
            next: (response) => {
                this.submitting = false;
                if (response.success && response.data) {
                    this.countResult = response.data;
                    this.messageService.add({
                        severity: 'success',
                        summary: $localize`:@@stock-simple.component.summary.Stock mis à :Stock mis à jour`,
                        detail: response.data.humanMessage
                    });
                    // Reload after showing result
                    setTimeout(() => {
                        this.loadOverview();
                    }, 1500);
                }
            },
            error: (err) => {
                this.submitting = false;
                this.messageService.add({
                    severity: 'error',
                    summary: $localize`:@@stock-simple.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@stock-simple.component.detail.impossible.de.mettre.a.jour.le.stock.d4d50f5b:Impossible de mettre à jour le stock`
                });
            }
        });
    }

    // =====================================================
    // HELPERS
    // =====================================================

    readonly buildStockAnalyzePayload = (): unknown => {
        const o = this.overview();
        const wh = this.warehouseContext.selectedWarehouseId();
        if (!o) {
            return wrapLegacyAnalyzePayload(
                'stock-simple',
                { screen: 'stock-simple', warehouseId: wh, loading: this.loading() } as Record<string, unknown>
            );
        }
        return wrapLegacyAnalyzePayload(
            'stock-simple',
            {
                screen: 'stock-simple',
                warehouseId: wh,
                searchTerm: this.searchTerm || null,
                summary: {
                    totalProducts: o.totalProducts,
                    productsInStock: o.productsInStock,
                    productsRunningLow: o.productsRunningLow,
                    productsOutOfStock: o.productsOutOfStock
                },
                alerts: o.alerts.map(a => ({
                    productId: a.productId,
                    productName: a.productName,
                    message: a.message,
                    severity: a.severity
                })),
                items: o.items.map(i => ({
                    productCode: i.productCode,
                    productName: i.productName,
                    quantityAvailable: i.quantityAvailable,
                    statusLabel: i.statusLabel,
                    minimumThreshold: i.minimumThreshold,
                    alertMessage: i.alertMessage
                }))
            } as Record<string, unknown>,
            { rowsKey: 'items' }
        );
    };

    getStatusClass(status: string): string {
        switch (status) {
            case 'InStock': return 'status-in-stock';
            case 'RunningLow': return 'status-running-low';
            case 'OutOfStock': return 'status-out-of-stock';
            default: return '';
        }
    }

    getAlertSeverityClass(severity: string): string {
        return severity === 'danger' ? 'alert-danger' : 'alert-warning';
    }

    navigateToAdvanced(): void {
        this.router.navigate(['/stock/advanced']);
    }

    onWarehouseChange(warehouseId: string | null): void {
        if (warehouseId) {
            this.warehouseContext.setSelectedWarehouse(warehouseId);
            this.loadOverview();
        }
    }
}
