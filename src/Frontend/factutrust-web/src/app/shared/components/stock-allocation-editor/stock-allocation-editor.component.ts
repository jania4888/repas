import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
  DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  StockService,
  StockFeatures,
  StockLotBalance,
  ProductSerial
} from '@core/services/stock.service';
import {
  AllocationRow,
  needsManualLotPicker,
  showLotSection,
  showSerialSection,
  allocationSum,
  createDefaultLotRow,
  createDefaultSerialRow,
  coerceTrackingMode,
  ExitLotAvailability,
  LotStockValidity,
  remainingLotAvailable,
  capQuantityToRemaining,
  exitAllocationsExceedLotStock,
  lotStockExceedances,
  isLotExpired,
  shouldBlockExpiredLotsOnExit,
  TRACKING_MODE_LOT,
  TRACKING_MODE_SERIAL
} from '@shared/utils/stock-traceability.utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-stock-allocation-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    ButtonComponent
  ],
  template: `
    @if (visible()) {
      <div class="alloc-editor">
        <span class="alloc-label">{{ labelText() }}</span>

        @if (lotMode()) {
          @if (mode === 'exit') {
            @if (lotOptions().length > 0) {
              @for (alloc of allocations; track $index; let ai = $index) {
                <div class="alloc-row">
                  <p-select
                    styleClass="alloc-field-lot"
                    class="alloc-field-lot"
                    [options]="lotOptions()"
                    [(ngModel)]="alloc.productLotId"
                    [ngModelOptions]="{ standalone: true }"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Lot" i18n-placeholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.lot.4a211932"
                    [filter]="true"
                    filterBy="label"
                    filterPlaceholder="Rechercher un lot…" i18n-filterPlaceholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.rechercher.un.lot.c23d8d0f"
                    [showClear]="true"
                    appendTo="body"
                    (onChange)="onLotPicked(alloc, $event.value)">
                  </p-select>
                  <p-inputNumber
                    styleClass="alloc-field-qty"
                    inputStyleClass="alloc-qty-input"
                    [class.alloc-qty-over]="isLotQtyOverAvailable(alloc)"
                    [(ngModel)]="alloc.quantity"
                    [ngModelOptions]="{ standalone: true }"
                    [min]="0"
                    [max]="lotQtyMax(alloc, ai)"
                    mode="decimal"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="3"
                    (ngModelChange)="onExitLotQtyChange(alloc, ai)">
                  </p-inputNumber>
                  <button type="button" class="btn-icon" (click)="removeRow(ai)" aria-label="Retirer" i18n-aria-label="@@shared.components.stock-allocation-editor.stock-allocation-editor.retirer.54ec24a1">
                    <i class="pi pi-times"></i>
                  </button>
                </div>
              }
              <app-button type="button" variant="ghost" size="sm" icon="pi-plus" iconPos="left" (clicked)="addLotRow()" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.ajouter.un.lot.5e4bc959"> Ajouter un lot </app-button>
            } @else if (lotsLoaded()) {
              <span class="alloc-empty">
                @if (excludedExpiredCount() > 0) {<ng-container i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.tous.les.lots.de.cet.entrepot.sont.perim.041b1395">
                  Tous les lots de cet entrepôt sont périmés et ne peuvent pas sortir.
                </ng-container>} @else {<ng-container i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.aucun.lot.disponible.dans.cet.entrepot.r.1323495e">
                  Aucun lot disponible dans cet entrepôt. Réceptionnez d'abord le stock avec un n° de lot.
                </ng-container>}
              </span>
            }
          } @else {
            @for (alloc of allocations; track $index; let ai = $index) {
              <div class="alloc-row alloc-row--entry">
                <input pInputText class="alloc-field-lot" placeholder="N° lot" i18n-placeholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.n.lot.487dbd0f" [(ngModel)]="alloc.lotNumber" [ngModelOptions]="{ standalone: true }" />
                <p-datepicker
                  styleClass="alloc-field-dluo"
                  class="alloc-field-dluo"
                  [(ngModel)]="alloc.expiryDate"
                  [ngModelOptions]="{ standalone: true }"
                  dateFormat="dd/mm/yy"
                  placeholder="DLUO" i18n-placeholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.dluo.d342f6a4"
                  [showIcon]="true"
                  appendTo="body">
                </p-datepicker>
                <p-inputNumber
                  styleClass="alloc-field-qty"
                  inputStyleClass="alloc-qty-input"
                  [(ngModel)]="alloc.quantity"
                  [ngModelOptions]="{ standalone: true }"
                  [min]="0"
                  mode="decimal"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3">
                </p-inputNumber>
                <button type="button" class="btn-icon" (click)="removeRow(ai)" aria-label="Retirer" i18n-aria-label="@@shared.components.stock-allocation-editor.stock-allocation-editor.retirer.54ec24a1">
                  <i class="pi pi-times"></i>
                </button>
              </div>
            }
            <app-button type="button" variant="ghost" size="sm" icon="pi-plus" iconPos="left" (clicked)="addLotRow()" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.ajouter.un.lot.5e4bc959"> Ajouter un lot </app-button>
          }
        }

        @if (serialMode()) {
          @if (mode === 'exit') {
            @if (availableSerials().length > 0) {
              @for (alloc of allocations; track $index; let ai = $index) {
                <div class="alloc-row alloc-row--serial">
                  <p-select
                    styleClass="alloc-field-lot"
                    class="alloc-field-lot"
                    [options]="serialOptions()"
                    [(ngModel)]="alloc.serialId"
                    [ngModelOptions]="{ standalone: true }"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="N° série" i18n-placeholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.n.serie.8c333421"
                    [filter]="true"
                    filterBy="label"
                    filterPlaceholder="Rechercher un n° de série…" i18n-filterPlaceholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.rechercher.un.n.de.serie.4d58c90c"
                    [showClear]="true"
                    appendTo="body"
                    (onChange)="onSerialPicked(alloc, $event.value)">
                  </p-select>
                  <button type="button" class="btn-icon" (click)="removeRow(ai)" aria-label="Retirer" i18n-aria-label="@@shared.components.stock-allocation-editor.stock-allocation-editor.retirer.54ec24a1">
                    <i class="pi pi-times"></i>
                  </button>
                </div>
              }
            } @else if (serialsLoaded()) {
              <span class="alloc-empty" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.aucun.numero.de.serie.disponible.dans.cet.entrep.62ba2244"> Aucun numéro de série disponible dans cet entrepôt. </span>
            }
          } @else {
            @for (alloc of allocations; track $index; let ai = $index) {
              <div class="alloc-row alloc-row--serial">
                <input pInputText class="alloc-field-lot" placeholder="N° série" i18n-placeholder="@@shared.components.stock-allocation-editor.stock-allocation-editor.n.serie.8c333421" [(ngModel)]="alloc.serialNumber" [ngModelOptions]="{ standalone: true }" />
                <button type="button" class="btn-icon" (click)="removeRow(ai)" aria-label="Retirer" i18n-aria-label="@@shared.components.stock-allocation-editor.stock-allocation-editor.retirer.54ec24a1">
                  <i class="pi pi-times"></i>
                </button>
              </div>
            }
            <app-button type="button" variant="ghost" size="sm" icon="pi-plus" iconPos="left" (clicked)="addSerialRow()" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.ajouter.un.n.de.serie.e0aad4b5"> Ajouter un n° de série </app-button>
          }
        }

        @if (excludedExpiredCount() > 0 && lotOptions().length > 0) {
          <span class="alloc-hint" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.lot.s.perime.s.exclus.de.la.sortie.fad026b7">
            {{ excludedExpiredCount() }} lot(s) périmé(s) exclus de la sortie
          </span>
        }
        @if (lotStockWarning(); as warn) {
          <span class="alloc-over" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.quantite.superieure.au.disponible.du.lot.125e0aee">
            Quantité supérieure au disponible du lot ({{ warn.available | number:'1.0-3' }})
          </span>
        }
        @if (showSumWarning()) {
          <span class="alloc-warning" i18n="@@shared.components.stock-allocation-editor.stock-allocation-editor.somme.quantite.ligne.33c3cef0">
            Somme {{ allocationSum(allocations) | number:'1.0-3' }} ≠ quantité ligne {{ lineQuantity | number:'1.0-3' }}
          </span>
        }
      </div>
    }
  `,
  styles: [`
    .alloc-editor {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
      width: 100%;
      max-width: 36rem;
      padding: 0.25rem 0;
    }
    .alloc-editor:has(.alloc-row--entry) {
      max-width: 42rem;
    }
    .alloc-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: #64748b;
    }
    .alloc-row {
      display: grid;
      grid-template-columns: minmax(12rem, 22rem) 6rem auto;
      gap: 0.5rem;
      align-items: center;
      width: 100%;
      max-width: 36rem;
    }
    .alloc-row--entry {
      grid-template-columns: minmax(8rem, 14rem) 9.5rem 6rem auto;
      max-width: 42rem;
    }
    .alloc-row--serial {
      grid-template-columns: minmax(12rem, 22rem) auto;
    }
    .alloc-field-lot {
      min-width: 0;
      width: 100%;
    }
    .alloc-field-dluo {
      width: 100%;
    }
    .alloc-field-qty {
      width: 100%;
    }
    .btn-icon {
      justify-self: start;
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
    }
    .alloc-warning,
    .alloc-empty,
    .alloc-hint {
      color: #b45309;
      font-size: 0.75rem;
    }
    .alloc-over {
      color: #b91c1c;
      font-size: 0.75rem;
    }
    @media (max-width: 520px) {
      .alloc-row,
      .alloc-row--entry {
        grid-template-columns: minmax(0, 1fr) 6rem auto;
      }
      .alloc-row--entry .alloc-field-dluo {
        grid-column: 1 / -1;
      }
    }
    :host ::ng-deep {
      .p-datepicker { display: flex; width: 100%; }
      .alloc-field-lot,
      .alloc-field-lot .p-select,
      .alloc-field-lot.p-select {
        width: 100%;
      }
      .alloc-field-dluo .p-datepicker,
      .alloc-field-dluo.p-datepicker {
        width: 100%;
      }
      .alloc-field-qty.p-inputnumber,
      .alloc-field-qty .p-inputnumber,
      .alloc-qty-input {
        width: 100%;
      }
      .alloc-qty-over .p-inputnumber-input,
      .alloc-field-qty.alloc-qty-over .p-inputnumber-input {
        border-color: #dc2626;
      }
    }
  `]
})
export class StockAllocationEditorComponent implements OnChanges {
  @Input({ required: true }) mode!: 'entry' | 'exit';
  @Input({ required: true }) productId!: string;
  @Input({ required: true }) warehouseId!: string;
  @Input({ required: true }) lineQuantity!: number;
  @Input() trackingMode: number | string = 0;
  @Input() pickingPolicy: number | string = 0;
  @Input() features: StockFeatures | null = null;
  @Input() hasExpiryTracking = false;
  @Input() allocations: AllocationRow[] = [];
  @Input() optionalOverride = false;
  @Output() availabilityChange = new EventEmitter<ExitLotAvailability>();
  @Output() lotStockValidChange = new EventEmitter<LotStockValidity>();

  private stockService = inject(StockService);
  private destroyRef = inject(DestroyRef);

  visible = signal(false);
  lotMode = signal(false);
  serialMode = signal(false);
  availableLots = signal<StockLotBalance[]>([]);
  availableSerials = signal<ProductSerial[]>([]);
  lotsLoaded = signal(false);
  serialsLoaded = signal(false);

  lotOptions = signal<{ label: string; value: string }[]>([]);
  serialOptions = signal<{ label: string; value: string }[]>([]);
  excludedExpiredCount = signal(0);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['trackingMode'] || changes['features'] || changes['productId']
      || changes['warehouseId'] || changes['mode'] || changes['hasExpiryTracking']) {
      this.refreshVisibility();
      this.loadAvailability();
    } else if (changes['lineQuantity'] || changes['allocations']) {
      this.recapSelectedAllocations();
      this.emitLotStockValidity();
    }
  }

  labelText(): string {
    if (this.serialMode()) return 'N° de série';
    if (this.mode === 'entry') return 'Lots';
    if (this.optionalOverride || !needsManualLotPicker(this.pickingPolicy)) {
      return 'Lots (optionnel — sinon FEFO)';
    }
    return 'Lots (obligatoire)';
  }

  showSumWarning(): boolean {
    if (!this.visible()) return false;
    if (this.mode === 'exit' && this.lotMode() && this.lotOptions().length === 0) return false;
    if (this.mode === 'exit' && this.serialMode() && this.availableSerials().length === 0) return false;
    if (this.serialMode()) {
      return this.allocations.length !== Math.round(this.lineQuantity);
    }
    return Math.abs(allocationSum(this.allocations) - this.lineQuantity) > 0.0001
      && allocationSum(this.allocations) > 0;
  }

  allocationSum(rows: AllocationRow[]): number {
    return allocationSum(rows);
  }

  addLotRow(): void {
    this.allocations.push(createDefaultLotRow(0));
    this.emitLotStockValidity();
  }

  addSerialRow(): void {
    this.allocations.push(createDefaultSerialRow());
  }

  removeRow(index: number): void {
    if (this.allocations.length <= 1) return;
    this.allocations.splice(index, 1);
    this.recapSelectedAllocations();
    this.emitLotStockValidity();
  }

  lotQtyMax(alloc: AllocationRow, index: number): number | undefined {
    if (this.mode !== 'exit' || !this.lotMode() || !this.lotsLoaded() || !alloc.productLotId) {
      return undefined;
    }
    return remainingLotAvailable(this.lotsForExitStock(), this.allocations, alloc.productLotId, index);
  }

  onExitLotQtyChange(alloc: AllocationRow, index: number): void {
    if (this.lotsLoaded() && alloc.productLotId) {
      const remaining = remainingLotAvailable(
        this.lotsForExitStock(),
        this.allocations,
        alloc.productLotId,
        index
      );
      alloc.quantity = capQuantityToRemaining(alloc.quantity ?? 0, remaining);
    }
    this.emitLotStockValidity();
  }

  lotStockWarning(): { lotNumber: string; available: number; requested: number } | null {
    if (this.mode !== 'exit' || !this.lotMode() || !this.lotsLoaded()) return null;
    const first = lotStockExceedances(this.allocations, this.lotsForExitStock())[0];
    return first ?? null;
  }

  isLotQtyOverAvailable(alloc: AllocationRow): boolean {
    if (!alloc.productLotId || this.mode !== 'exit' || !this.lotsLoaded()) return false;
    return lotStockExceedances(this.allocations, this.lotsForExitStock())
      .some(e => e.productLotId === alloc.productLotId);
  }

  onLotPicked(alloc: AllocationRow, lotId: string | null): void {
    if (!lotId) {
      alloc.productLotId = null;
      alloc.lotNumber = '';
      alloc.expiryDate = null;
      this.emitLotStockValidity();
      return;
    }
    const lot = this.lotsForExitStock().find(l => l.productLotId === lotId);
    if (lot) {
      alloc.productLotId = lot.productLotId;
      alloc.lotNumber = lot.lotNumber;
      if (lot.expiryDate) alloc.expiryDate = new Date(lot.expiryDate);
    }
    const index = this.allocations.indexOf(alloc);
    const remaining = remainingLotAvailable(
      this.lotsForExitStock(),
      this.allocations,
      alloc.productLotId ?? lotId,
      index >= 0 ? index : undefined
    );
    alloc.quantity = capQuantityToRemaining(alloc.quantity ?? 0, remaining);
    this.emitLotStockValidity();
  }

  onSerialPicked(alloc: AllocationRow, serialId: string | null): void {
    if (!serialId) {
      alloc.serialId = null;
      alloc.serialNumber = '';
      return;
    }
    const serial = this.availableSerials().find(s => s.id === serialId);
    if (serial) {
      alloc.serialId = serial.id;
      alloc.serialNumber = serial.serialNumber;
      alloc.quantity = 1;
    }
  }

  private refreshVisibility(): void {
    const lot = showLotSection(this.trackingMode, this.features);
    const serial = showSerialSection(this.trackingMode, this.features);
    this.lotMode.set(lot);
    this.serialMode.set(serial);
    this.visible.set(lot || serial);
  }

  private loadAvailability(): void {
    this.availableLots.set([]);
    this.lotOptions.set([]);
    this.availableSerials.set([]);
    this.serialOptions.set([]);
    this.excludedExpiredCount.set(0);
    this.lotsLoaded.set(false);
    this.serialsLoaded.set(false);

    if (!this.productId || !this.warehouseId || !this.visible() || this.mode !== 'exit') return;

    const tracking = coerceTrackingMode(this.trackingMode);

    if (tracking === TRACKING_MODE_LOT) {
      this.emitAvailability('lot', false, 0);
      this.stockService.getLotsByProduct(this.productId, this.warehouseId)
        .pipe(
          catchError(() => of({ success: false, data: [] as StockLotBalance[], message: null, errors: [] })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(res => {
          const data = res.success && res.data ? res.data : [];
          this.availableLots.set(data);
          const inStock = data.filter(l => l.quantityAvailable > 0);
          const blockExpired = shouldBlockExpiredLotsOnExit(this.features, this.hasExpiryTracking);
          const expired = blockExpired ? inStock.filter(l => isLotExpired(l.expiryDate)) : [];
          const pickable = blockExpired ? inStock.filter(l => !isLotExpired(l.expiryDate)) : inStock;
          this.excludedExpiredCount.set(expired.length);
          this.lotOptions.set(pickable.map(l => ({
            value: l.productLotId,
            label: `${l.lotNumber} (${l.quantityAvailable})${l.expiryDate ? ' · ' + l.expiryDate.slice(0, 10) : ''}`
          })));
          this.applyKnownLotsToAllocations();
          this.clearBlockedExpiredAllocations();
          this.lotsLoaded.set(true);
          this.recapSelectedAllocations();
          this.emitAvailability('lot', true, pickable.length, expired.length);
          this.emitLotStockValidity();
        });
    }

    if (tracking === TRACKING_MODE_SERIAL) {
      this.emitAvailability('serial', false, 0);
      this.stockService.getSerialsByProduct(this.productId, this.warehouseId)
        .pipe(
          catchError(() => of({ success: false, data: [] as ProductSerial[], message: null, errors: [] })),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(res => {
          const data = res.success && res.data ? res.data : [];
          this.availableSerials.set(data);
          this.serialOptions.set(
            data.map(s => ({
              value: s.id,
              label: s.lotNumber ? `${s.serialNumber} (${s.lotNumber})` : s.serialNumber
            }))
          );
          this.serialsLoaded.set(true);
          this.emitAvailability('serial', true, data.length);
        });
    }
  }

  private applyKnownLotsToAllocations(): void {
    const lots = this.availableLots();
    for (const alloc of this.allocations) {
      if (alloc.productLotId) {
        const byId = lots.find(l => l.productLotId === alloc.productLotId);
        if (byId) alloc.lotNumber = byId.lotNumber;
        continue;
      }
      const typed = alloc.lotNumber?.trim();
      if (!typed) continue;
      const needle = typed.toUpperCase();
      const matches = lots.filter(l => l.lotNumber.trim().toUpperCase() === needle);
      if (matches.length === 1) {
        alloc.productLotId = matches[0].productLotId;
        alloc.lotNumber = matches[0].lotNumber;
        if (matches[0].expiryDate) alloc.expiryDate = new Date(matches[0].expiryDate);
      }
    }
  }

  private recapSelectedAllocations(): void {
    if (this.mode !== 'exit' || !this.lotMode() || !this.lotsLoaded()) return;
    this.allocations.forEach((alloc, index) => {
      if (!alloc.productLotId) return;
      const remaining = remainingLotAvailable(
        this.lotsForExitStock(),
        this.allocations,
        alloc.productLotId,
        index
      );
      alloc.quantity = capQuantityToRemaining(alloc.quantity ?? 0, remaining);
    });
  }

  emitLotStockValidity(): void {
    if (this.mode !== 'exit' || !this.lotMode()) {
      this.lotStockValidChange.emit({ productId: this.productId, valid: true });
      return;
    }
    if (!this.lotsLoaded()) {
      this.lotStockValidChange.emit({ productId: this.productId, valid: true });
      return;
    }
    this.lotStockValidChange.emit({
      productId: this.productId,
      valid: !exitAllocationsExceedLotStock(this.allocations, this.lotsForExitStock())
    });
  }

  private lotsForExitStock(): StockLotBalance[] {
    const lots = this.availableLots();
    if (!shouldBlockExpiredLotsOnExit(this.features, this.hasExpiryTracking)) {
      return lots;
    }
    return lots.filter(l => !isLotExpired(l.expiryDate));
  }

  private clearBlockedExpiredAllocations(): void {
    if (!shouldBlockExpiredLotsOnExit(this.features, this.hasExpiryTracking)) return;
    for (const alloc of this.allocations) {
      if (!alloc.productLotId) continue;
      const lot = this.availableLots().find(l => l.productLotId === alloc.productLotId);
      if (lot && isLotExpired(lot.expiryDate)) {
        alloc.productLotId = null;
        alloc.lotNumber = '';
        alloc.expiryDate = null;
      }
    }
  }

  private emitAvailability(
    kind: ExitLotAvailability['kind'],
    loaded: boolean,
    availableCount: number,
    expiredExcludedCount = 0
  ): void {
    this.availabilityChange.emit({
      productId: this.productId,
      kind,
      loaded,
      availableCount,
      expiredExcludedCount: kind === 'lot' ? expiredExcludedCount : undefined
    });
  }
}
