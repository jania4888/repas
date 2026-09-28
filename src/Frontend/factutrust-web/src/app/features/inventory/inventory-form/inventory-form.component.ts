/// <reference types="@angular/localize" />
import {
    Component,
    OnInit,
    inject,
    signal,
    computed,
    LOCALE_ID,
} from '@angular/core';
import { erpPlural } from '@core/i18n/erp-plural';
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
  protected loc_numero_de_lot_pour_productname_859ef2(p0: unknown): string {
    return $localize`:@@inventory.inventory-form.tpl.numero.de.lot.pour.productname.859ef29d:Numéro de lot pour ${p0}:productName:`;
  }
  protected loc_quantite_comptee_pour_productname_4e025d(p0: unknown): string {
    return $localize`:@@inventory.inventory-form.tpl.quantite.comptee.pour.productname.4e025d28:Quantité comptée pour ${p0}:productName:`;
  }

    private inventoryService = inject(InventoryService);
    private stockService = inject(StockService);
    private toastService = inject(ToastService);
    private errorHandler = inject(ErrorHandlerService);
    private confirmationService = inject(ConfirmationService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private localeId = inject(LOCALE_ID);

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
        { label: $localize`:@@inventory.inventory-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
        { label: $localize`:@@inventory.inventory-form.ts.mon.stock.7d1adf31:Mon Stock`, route: '/stock' },
        { label: $localize`:@@inventory.inventory-form.ts.inventaire.10ad1a54:Inventaire` },
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
                    detail: $localize`:@@inventory.inventory-form.ts.length.comptage.s.enregistre.s.derniere.ce357c66:${queue.length}:length: comptage(s) enregistré(s). Dernière sauvegarde à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}:toLocaleTimeString:`,
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
            detail: $localize`:@@inventory.inventory-form.ts.saisissez.un.numero.de.lot.pour.productn.8cf3f558:Saisissez un numéro de lot pour « ${line.productName}:productName: » (article suivi avec écart).`,
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

        // Une forme par catégorie CLDR : le français n'emploie que one/many/other, l'arabe toutes.
        const implicitPlural = $localize`:@@inventory-form.validate.implicit.plural:${implicitCount}:count: articles non saisis seront confirmés à la quantité système.`;
        const implicitPart = implicitCount > 0
            ? erpPlural(implicitCount, {
                zero: $localize`:@@inventory-form.validate.implicit.zero:${implicitCount}:count: articles non saisis seront confirmés à la quantité système.`,
                one: $localize`:@@inventory-form.validate.implicit.one:${implicitCount}:count: article non saisi seront confirmés à la quantité système.`,
                two: $localize`:@@inventory-form.validate.implicit.two:${implicitCount}:count: articles non saisis seront confirmés à la quantité système.`,
                few: $localize`:@@inventory-form.validate.implicit.few:${implicitCount}:count: articles non saisis seront confirmés à la quantité système.`,
                many: $localize`:@@inventory-form.validate.implicit.many:${implicitCount}:count: articles non saisis seront confirmés à la quantité système.`,
                other: implicitPlural
            }, this.localeId)
            : $localize`:@@ui.tern.tous.les.articles.saisis.seront.enregistre.fdf8dc:Tous les articles saisis seront enregistrés.`;
        const variancePlural = $localize`:@@inventory-form.validate.variance.plural:${varianceCount}:count: écarts seront appliqués au stock.`;
        const variancePart = varianceCount > 0
            ? erpPlural(varianceCount, {
                zero: $localize`:@@inventory-form.validate.variance.zero:${varianceCount}:count: écarts seront appliqués au stock.`,
                one: $localize`:@@inventory-form.validate.variance.one:${varianceCount}:count: écart sera appliqué au stock.`,
                two: $localize`:@@inventory-form.validate.variance.two:${varianceCount}:count: écarts seront appliqués au stock.`,
                few: $localize`:@@inventory-form.validate.variance.few:${varianceCount}:count: écarts seront appliqués au stock.`,
                many: $localize`:@@inventory-form.validate.variance.many:${varianceCount}:count: écarts seront appliqués au stock.`,
                other: variancePlural
            }, this.localeId)
            : $localize`:@@ui.tern.aucun.ajustement.de.stock.6f28b5:Aucun ajustement de stock.`;

        this.confirmationService.confirm({
            header: $localize`:@@inventory.inventory-form.ts.valider.l.inventaire.85adc87d:Valider l'inventaire`,
            message: `${implicitPart} ${variancePart}`,
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
