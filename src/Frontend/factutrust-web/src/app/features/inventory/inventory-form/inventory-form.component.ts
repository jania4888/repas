/// <reference types="@angular/localize" />
import {
    Component,
    OnInit,
    inject,
    signal,
    computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import {
    InventoryService,
    InventoryType,
    ActiveInventoryDto,
    InventoryProductItem,
    RecordCountRequest,
} from '@core/services/inventory.service';
import { StockService, Warehouse } from '@core/services/stock.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { TRACKING_MODE_LOT, coerceTrackingMode } from '@shared/utils/stock-traceability.utils';

import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { RippleModule } from 'primeng/ripple';

import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';

/** Line with local count and last saved value for dirty detection */
export interface InventoryFormLine extends InventoryProductItem {
    /** User input (counted quantity) */
    countedInput: number;
    /** Last value successfully saved to API */
    lastSavedCount: number | null;
    /** Lot number for opening inventory on lot-tracked products */
    lotNumberInput: string;
}

@Component({
    selector: 'app-inventory-form',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        SelectModule,
        InputNumberModule,
        InputTextModule,
        Textarea,
        ButtonModule,
        RippleModule,
        PageHeaderComponent,
        BreadcrumbComponent,
        FormSectionComponent,
        ButtonComponent,
    ],
    templateUrl: './inventory-form.component.html',
    styleUrl: './inventory-form.component.scss',
})
export class InventoryFormComponent implements OnInit {
    private inventoryService = inject(InventoryService);
    private stockService = inject(StockService);
    private toastService = inject(ToastService);
    private errorHandler = inject(ErrorHandlerService);
    private confirmationService = inject(ConfirmationService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    loading = signal(true);
    starting = signal(false);
    saving = signal(false);
    validating = signal(false);
    cancelling = signal(false);

    activeInventory = signal<ActiveInventoryDto | null>(null);
    warehouses: Warehouse[] = [];
    selectedWarehouse = signal<Warehouse | null>(null);
    notes = signal('');

    /** Editable lines derived from active inventory (countedInput + lastSavedCount) */
    lines = signal<InventoryFormLine[]>([]);

    lastSavedAt = signal<Date | null>(null);

    breadcrumbItems: BreadcrumbItem[] = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'Mon Stock', route: '/stock' },
        { label: 'Inventaire' },
    ];

    hasActiveInventory = computed(() => this.activeInventory() !== null);

    /** Whether any line has unsaved count */
    hasDirtyLines = computed(() => this.lines().some((line) => this.isDirtyLine(line)));

    /** Active inventory with at least one line, not already saving/validating. */
    canValidate = computed(() => {
        const inv = this.activeInventory();
        if (!inv) return false;
        return this.lines().length > 0 && !this.validating() && !this.saving();
    });

    documentDate = computed(() => {
        const inv = this.activeInventory();
        if (inv?.startedAt) {
            return new Date(inv.startedAt);
        }
        return new Date();
    });

    ngOnInit(): void {
        this.loadWarehouses();
    }

    loadWarehouses(): void {
        this.stockService.getWarehouses(true).subscribe({
            next: (res) => {
                if (res.success && res.data?.length) {
                    this.warehouses = res.data;
                    const warehouseIdFromRoute = this.route.snapshot.queryParamMap.get('warehouseId');
                    const targetWh = warehouseIdFromRoute
                        ? res.data.find((w) => w.id === warehouseIdFromRoute)
                        : null;
                    const defaultWh = targetWh ?? res.data.find((w) => w.isDefault) ?? res.data[0];
                    this.selectedWarehouse.set(defaultWh);
                    this.loadActiveInventory(defaultWh.id);
                } else {
                    this.loading.set(false);
                }
            },
            error: (err) => {
                this.errorHandler.logError('Failed warehouses', err);
                this.loading.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                    detail: this.errorHandler.extractErrorMessage(err) ?? $localize`:@@ui.tern.impossible.de.charger.les.entrepots.349245:Impossible de charger les entrepôts`,
                });
            },
        });
    }

    onWarehouseChange(warehouse: Warehouse | null): void {
        this.selectedWarehouse.set(warehouse ?? null);
        if (warehouse) {
            this.loadActiveInventory(warehouse.id);
        } else {
            this.activeInventory.set(null);
            this.lines.set([]);
            this.loading.set(false);
        }
    }

    loadActiveInventory(warehouseId: string): void {
        this.loading.set(true);
        this.inventoryService.getActiveInventory(warehouseId).subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.activeInventory.set(res.data);
                    this.buildLines(res.data);
                } else {
                    this.activeInventory.set(null);
                    this.lines.set([]);
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                    detail: $localize`:@@inventory-form.component.detail.Impossible_de_ch:Impossible de charger l'inventaire actif`,
                });
            },
        });
    }

    private buildLines(data: ActiveInventoryDto): void {
        const newLines: InventoryFormLine[] = data.products.map((p) => ({
            ...p,
            countedInput:
                p.countedQuantity !== null ? p.countedQuantity : p.theoreticalQuantity,
            lastSavedCount: p.countedQuantity,
            lotNumberInput: p.lotNumber ?? '',
        }));
        this.lines.set(newLines);
    }

    startInventory(): void {
        const warehouse = this.selectedWarehouse();
        if (!warehouse) {
            this.toastService.add({
                severity: 'warn',
                summary: $localize`:@@inventory-form.component.summary.Attention:Attention`,
                detail: $localize`:@@inventory-form.component.detail.Veuillez_s_lecti:Veuillez sélectionner un entrepôt`,
            });
            return;
        }

        this.starting.set(true);
        this.inventoryService
            .startInventory({
                type: InventoryType.Complete,
                warehouseId: warehouse.id,
                notes: this.notes()?.trim() || undefined,
            })
            .subscribe({
                next: (res) => {
                    if (res.success && res.data) {
                        this.toastService.add({
                            severity: 'success',
                            summary: $localize`:@@inventory-form.component.summary.Inventaire_d_mar:Inventaire démarré`,
                            detail: res.data.humanMessage,
                        });
                        this.loadActiveInventory(warehouse.id);
                    } else {
                        this.toastService.add({
                            severity: 'error',
                            summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                            detail: res.errors?.join(', ') ?? $localize`:@@ui.tern.impossible.de.demarrer.l.inventaire.8110bf:Impossible de démarrer l'inventaire`,
                        });
                    }
                    this.starting.set(false);
                },
                error: (err) => {
                    const msg = this.errorHandler.extractErrorMessage(err);
                    this.toastService.add({
                        severity: 'error',
                        summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                        detail: msg ?? $localize`:@@ui.tern.impossible.de.demarrer.l.inventaire.8110bf:Impossible de démarrer l'inventaire`,
                    });
                    this.errorHandler.logError('Start inventory failed', err);
                    this.starting.set(false);
                },
            });
    }

    updateLineCount(line: InventoryFormLine, value: number | null): void {
        const key = this.lineKey(line);
        this.lines.update((list) =>
            list.map((item) =>
                this.lineKey(item) === key
                    ? { ...item, countedInput: value ?? item.theoreticalQuantity }
                    : item
            )
        );
    }

    lineKey(line: { productId: string; productLotId?: string | null }): string {
        return `${line.productId}::${line.productLotId ?? ''}`;
    }

    needsOpeningLotForLine(line: InventoryFormLine): boolean {
        return coerceTrackingMode(line.trackingMode) === TRACKING_MODE_LOT && !line.productLotId;
    }

    requiresLotNumberForLine(line: InventoryFormLine): boolean {
        return this.needsOpeningLotForLine(line)
            && this.resolveCountedInput(line) !== line.theoreticalQuantity;
    }

    hasOpeningLotLines = computed(() => this.lines().some((line) => this.needsOpeningLotForLine(line)));

    updateLineLotNumber(line: InventoryFormLine, value: string): void {
        const key = this.lineKey(line);
        this.lines.update((list) =>
            list.map((item) =>
                this.lineKey(item) === key ? { ...item, lotNumberInput: value ?? '' } : item
            )
        );
    }

    private countPayload(line: InventoryFormLine): RecordCountRequest {
        const countedQuantity = this.resolveCountedInput(line);
        const payload: RecordCountRequest = { productId: line.productId, countedQuantity };
        if (line.productLotId) {
            payload.productLotId = line.productLotId;
        } else if (this.needsOpeningLotForLine(line) && line.lotNumberInput.trim()) {
            payload.lotNumber = line.lotNumberInput.trim();
        }
        return payload;
    }

    isDirtyLine(line: InventoryFormLine): boolean {
        if (line.lastSavedCount === null) {
            return line.countedInput !== line.theoreticalQuantity;
        }
        return line.countedInput !== line.lastSavedCount;
    }

    getDirtyLines(): InventoryFormLine[] {
        return this.lines().filter((line) => this.isDirtyLine(line));
    }

    resolveCountedInput(line: InventoryFormLine): number {
        const value = line.countedInput;
        return value == null || Number.isNaN(Number(value))
            ? line.theoreticalQuantity
            : Number(value);
    }

    saveCounts(): void {
        const inv = this.activeInventory();
        if (!inv) return;

        const toSave = this.getDirtyLines();

        if (toSave.length === 0) {
            this.toastService.add({
                severity: 'info',
                summary: $localize`:@@inventory-form.component.summary.Rien_enregistr:Rien à enregistrer`,
                detail: $localize`:@@inventory-form.component.detail.Aucune_modificat:Aucune modification à sauvegarder`,
            });
            return;
        }

        const missingLot = this.findMissingLotLine(toSave);
        if (missingLot) {
            this.warnMissingLot(missingLot);
            return;
        }

        this.saving.set(true);
        const queue = [...toSave];
        let index = 0;

        const runNext = (): void => {
            if (index >= queue.length) {
                this.saving.set(false);
                this.lastSavedAt.set(new Date());
                this.toastService.add({
                    severity: 'success',
                    summary: $localize`:@@inventory-form.component.summary.Enregistrement_t:Enregistrement terminé`,
                    detail: `${queue.length} comptage(s) enregistré(s). Dernière sauvegarde à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
                });
                this.loadActiveInventory(inv.warehouseId);
                return;
            }

            const line = queue[index];
            this.inventoryService
                .recordCount(inv.inventoryId, this.countPayload(line))
                .subscribe({
                    next: () => {
                        index++;
                        runNext();
                    },
                    error: (err) => {
                        this.saving.set(false);
                        this.toastService.add({
                            severity: 'error',
                            summary: $localize`:@@inventory-form.component.summary.Erreur_d_enregis:Erreur d'enregistrement`,
                            detail:
                                this.errorHandler.extractErrorMessage(err) ??
                                $localize`:@@ui.tern.impossible.d.enregistrer.le.comptage.b4a869:Impossible d'enregistrer le comptage`,
                        });
                        this.errorHandler.logError('Record count failed', err);
                    },
                });
        };

        runNext();
    }

    private findMissingLotLine(lines: InventoryFormLine[] = this.lines()): InventoryFormLine | undefined {
        return lines.find(
            (line) => this.requiresLotNumberForLine(line) && !line.lotNumberInput.trim()
        );
    }

    private warnMissingLot(line: InventoryFormLine): void {
        this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@inventory-form.component.summary.N° de lot re:N° de lot requis`,
            detail: `Saisissez un numéro de lot pour « ${line.productName} » (article suivi avec écart).`,
        });
    }

    validateInventory(): void {
        const inv = this.activeInventory();
        if (!inv || !this.canValidate()) return;

        const missingLot = this.findMissingLotLine();
        if (missingLot) {
            this.warnMissingLot(missingLot);
            return;
        }

        const implicitCount = this.lines().filter((l) => !l.isCounted && !this.isDirtyLine(l)).length;
        const varianceCount = this.lines().filter(
            (l) => this.resolveCountedInput(l) !== l.theoreticalQuantity
        ).length;

        const implicitPart = implicitCount > 0
            ? $localize`:@@ui.tern.ph.article.ph.non.saisi.ph.seront.confirme.023e2c:${implicitCount}:p0: article${implicitCount > 1 ? 's' : ''}:p1: non saisi${implicitCount > 1 ? 's' : ''}:p2: seront confirmés à la quantité système.`
            : $localize`:@@ui.tern.tous.les.articles.saisis.seront.enregistre.fdf8dc:Tous les articles saisis seront enregistrés.`;
        const variancePart = varianceCount > 0
            ? ` ${varianceCount} écart${varianceCount > 1 ? 's' : ''} ${varianceCount > 1 ? $localize`:@@ui.tern.seront.appliques.cad5b3:seront appliqués` : $localize`:@@ui.tern.sera.applique.c08e44:sera appliqué`} au stock.`
            : $localize`:@@ui.tern.aucun.ajustement.de.stock.6f28b5: Aucun ajustement de stock.`;

        this.confirmationService.confirm({
            header: 'Valider l\'inventaire',
            message: `${implicitPart}${variancePart}`,
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: $localize`:@@inventory-form.component.acceptLabel.Valider:Valider`,
            rejectLabel: $localize`:@@inventory-form.component.rejectLabel.Retour:Retour`,
            size: 'md',
            accept: () => this.executeValidate()
        });
    }

    private executeValidate(): void {
        const inv = this.activeInventory();
        if (!inv || !this.canValidate()) return;

        const missingLot = this.findMissingLotLine();
        if (missingLot) {
            this.warnMissingLot(missingLot);
            return;
        }

        const pendingCounts = this.getDirtyLines().map((line) => this.countPayload(line));

        this.validating.set(true);
        this.inventoryService.validateInventory(inv.inventoryId, { pendingCounts }).subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.toastService.add({
                        severity: 'success',
                        summary: $localize`:@@inventory-form.component.summary.Inventaire_valid:Inventaire validé`,
                        detail: res.data.humanMessage,
                    });
                    this.activeInventory.set(null);
                    this.lines.set([]);
                    this.router.navigate(['/inventory'], { replaceUrl: true });
                }
                this.validating.set(false);
            },
            error: (err) => {
                this.validating.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                    detail:
                        this.errorHandler.extractErrorMessage(err) ??
                        $localize`:@@ui.tern.impossible.de.valider.l.inventaire.2555f5:Impossible de valider l'inventaire`,
                });
                this.errorHandler.logError('Validate inventory failed', err);
            },
        });
    }

    cancelInventory(): void {
        const inv = this.activeInventory();
        if (!inv) return;

        this.cancelling.set(true);
        this.inventoryService.cancelInventory(inv.inventoryId).subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.toastService.add({
                        severity: 'info',
                        summary: $localize`:@@inventory-form.component.summary.Inventaire_annul:Inventaire annulé`,
                        detail: res.data.humanMessage,
                    });
                    this.activeInventory.set(null);
                    this.lines.set([]);
                }
                this.cancelling.set(false);
            },
            error: (err) => {
                this.cancelling.set(false);
                this.toastService.add({
                    severity: 'error',
                    summary: $localize`:@@inventory-form.component.summary.Erreur:Erreur`,
                    detail:
                        this.errorHandler.extractErrorMessage(err) ??
                        $localize`:@@ui.tern.impossible.d.annuler.l.inventaire.40980e:Impossible d'annuler l'inventaire`,
                });
                this.errorHandler.logError('Cancel inventory failed', err);
            },
        });
    }

    goToStock(): void {
        this.router.navigate(['/stock']);
    }
}
