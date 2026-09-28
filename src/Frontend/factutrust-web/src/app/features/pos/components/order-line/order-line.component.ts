import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '@core/services/product.service';
import { PosOrderLine } from '../../services/pos-state.service';

@Component({
  selector: 'app-order-line',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="order-line" [class.order-line--removing]="removing">
      <div class="order-line__info">
        @if (!quickMode) {
        <div class="order-line__thumb">
          @if (resolvedThumbUrl && !imageError) {
            <img [src]="resolvedThumbUrl" [alt]="line.designation" class="order-line__thumb-img" (error)="onImageError()" />
          } @else {
            <i class="pi pi-box order-line__thumb-icon"></i>
          }
        </div>
        }
        <div class="order-line__details">
          <span class="order-line__name" [title]="line.designation">{{ line.designation }}</span>
          @if (!quickMode) {
          <span class="order-line__unit-price">{{ formatPrice(line.unitPriceHT) }} / {{ line.unit }}</span>
          }
          @if (!quickMode && line.discountAmount > 0) {
            <span class="order-line__discount" i18n="@@pos.components.remise.757a6cf3">-{{ formatPrice(line.discountAmount) }} remise</span>
          }
          @if (showDiscountForm) {
            <div class="order-line__discount-form">
              <select [(ngModel)]="discountType">
                <option value="PERCENT">%</option>
                <option value="AMOUNT" i18n="@@pos.components.tnd.51da21a7">TND</option>
              </select>
              <input
                type="number"
                [(ngModel)]="discountValue"
                [min]="0"
                [attr.max]="discountType === 'PERCENT' ? 100 : null"
                step="0.001"
                placeholder="0" i18n-placeholder="@@pos.components.0.b6589fc6" />
              <button type="button" class="order-line__discount-apply" (click)="applyDiscount()" i18n="@@pos.components.ok.9ce3bd42">OK</button>
              @if (line.discountAmount > 0) {
                <button type="button" class="order-line__discount-remove" (click)="removeDiscount()" i18n="@@pos.components.supprimer.1acfc1c7">Supprimer</button>
              }
              <button type="button" class="order-line__discount-cancel" (click)="cancelDiscountForm()" i18n="@@pos.components.annuler.49ba3292">Annuler</button>
            </div>
          }
        </div>
      </div>

      <div class="order-line__controls">
        <div class="order-line__quantity">
          <button
            class="order-line__qty-btn"
            (click)="onDecrement.emit()"
            [disabled]="line.quantity <= 0.001"
            aria-label="Diminuer la quantite" i18n-aria-label="@@pos.components.diminuer.la.quantite.efbcbb8f">
            <i class="pi pi-minus"></i>
          </button>
          <input
            type="number"
            class="order-line__qty-input"
            [value]="displayValue"
            (focus)="startEditing()"
            (blur)="commitEdit()"
            (input)="onInput($event)"
            (keydown.enter)="blurInput($event)"
            min="0.001"
            step="any"
            aria-label="Quantite" i18n-aria-label="@@pos.components.quantite.4b1c4b13" />
          <button
            class="order-line__qty-btn"
            (click)="onIncrement.emit()"
            aria-label="Augmenter la quantite" i18n-aria-label="@@pos.components.augmenter.la.quantite.5b6aeab2">
            <i class="pi pi-plus"></i>
          </button>
        </div>

        <span class="order-line__total">{{ formatPrice(line.totalTTC) }}</span>

        @if (!showDiscountForm) {
          <button
            class="order-line__discount-btn"
            (click)="openDiscountForm()"
            aria-label="Ajouter une remise" i18n-aria-label="@@pos.components.ajouter.une.remise.178fc2c4"
            title="Remise" i18n-title="@@pos.components.remise.ce12d942">
            <i class="pi pi-percentage"></i>
          </button>
        }

        <button
          class="order-line__delete"
          (click)="onRemove.emit()"
          aria-label="Supprimer cette ligne" i18n-aria-label="@@pos.components.supprimer.cette.ligne.df86a218"
          title="Supprimer" i18n-title="@@pos.components.supprimer.1acfc1c7">
          <i class="pi pi-trash"></i>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .order-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: 12px;
      border-bottom: 1px solid var(--color-neutral-100);
      transition: background-color 300ms ease;
      animation: slideInLine 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
      gap: var(--spacing-3);
    }

    .order-line:last-child {
      border-bottom: none;
    }

    .order-line:hover {
      background: var(--color-primary-50);
    }

    .order-line--removing {
      animation: slideOutLine 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    .order-line__info {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      min-width: 0;
      flex: 1;
    }

    .order-line__thumb {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      overflow: hidden;
      background: var(--color-neutral-100);
      flex-shrink: 0;
    }

    .order-line__thumb-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .order-line__thumb-icon {
      color: var(--color-neutral-500);
      font-size: 1rem;
    }

    .order-line__details {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .order-line__name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .order-line__unit-price {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-variant-numeric: tabular-nums;
    }

    .order-line__discount {
      font-size: var(--font-size-xs);
      color: var(--color-success-600);
      font-variant-numeric: tabular-nums;
    }

    .order-line__discount-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-4);
      margin-top: var(--spacing-2);
    }

    .order-line__discount-form select,
    .order-line__discount-form input {
      padding: 4px 8px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      max-width: 80px;
    }

    .order-line__discount-apply,
    .order-line__discount-cancel,
    .order-line__discount-remove {
      padding: 4px 8px;
      border: none;
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      cursor: pointer;
      font-weight: var(--font-weight-medium);
    }

    .order-line__discount-apply {
      background: var(--color-primary-500);
      color: var(--color-white);
    }

    .order-line__discount-cancel,
    .order-line__discount-remove {
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
    }

    .order-line__discount-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-primary-500);
      color: var(--color-white);
      cursor: pointer;
      transition: all 200ms ease;
      font-size: 0.85rem;
      opacity: 1;
    }

    .order-line__discount-btn:hover {
      background: var(--color-primary-600);
      color: var(--color-white);
    }

    .order-line__controls {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      flex-shrink: 0;
      flex-wrap: nowrap;
    }

    .order-line__quantity {
      display: flex;
      align-items: center;
      gap: 0;
      border: 1px solid var(--color-primary-300);
      border-radius: 14px;
      overflow: hidden;
      transition: border-color 300ms ease;
      background: var(--color-white);
    }

    .order-line:hover .order-line__quantity {
      border-color: var(--color-primary-400);
    }

    .order-line__qty-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      background: var(--color-primary-500);
      color: var(--color-white);
      cursor: pointer;
      transition: all 200ms ease;
      font-size: 0.7rem;
    }

    .order-line__qty-btn:hover:not(:disabled) {
      background: var(--color-primary-600);
      color: var(--color-white);
    }

    .order-line__qty-btn:disabled {
      background: var(--color-neutral-100);
      color: var(--color-text-disabled);
      cursor: not-allowed;
      opacity: 0.5;
    }

    .order-line__qty-input {
      min-width: 36px;
      width: 36px;
      height: 32px;
      padding: 0;
      border: none;
      border-inline-start: 1px solid var(--color-border-subtle);
      border-inline-end: 1px solid var(--color-border-subtle);
      background: var(--color-white);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-variant-numeric: tabular-nums;
      text-align: center;
      outline: none;
    }

    .order-line__qty-input::-webkit-outer-spin-button,
    .order-line__qty-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .order-line__qty-input[type="number"] {
      -moz-appearance: textfield;
    }

    .order-line__total {
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      min-width: 90px;
      text-align: end;
    }

    .order-line__delete {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-primary-500);
      color: var(--color-white);
      cursor: pointer;
      transition: opacity 200ms ease, background 200ms ease, color 200ms ease;
      font-size: 0.85rem;
      opacity: 1;
    }

    .order-line__delete:hover {
      background: var(--color-primary-600);
      color: var(--color-white);
      transform: scale(1.1);
    }

    @keyframes slideInLine {
      from {
        opacity: 0;
        transform: translateX(12px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @media (max-width: 768px) {
      .order-line__qty-btn {
        width: 40px;
        height: 40px;
      }

      .order-line__qty-input {
        min-width: 44px;
        width: 44px;
        height: 40px;
      }

      .order-line__discount-btn,
      .order-line__delete {
        width: 44px;
        height: 44px;
        opacity: 1;
      }
    }

    @keyframes slideOutLine {
      from {
        opacity: 1;
        transform: translateX(0);
        max-height: 60px;
      }
      to {
        opacity: 0;
        transform: translateX(-12px);
        max-height: 0;
        padding: 0;
        margin: 0;
      }
    }
  `]
})
export class OrderLineComponent implements OnChanges {
  private readonly productService = inject(ProductService);

  @Input({ required: true }) line!: PosOrderLine;
  @Input() quickMode = false;
  @Output() onIncrement = new EventEmitter<void>();
  @Output() onDecrement = new EventEmitter<void>();
  @Output() onQuantitySet = new EventEmitter<number>();
  @Output() onRemove = new EventEmitter<void>();
  @Output() onDiscountSet = new EventEmitter<{ type: 'PERCENT' | 'AMOUNT'; value: number }>();
  @Output() onDiscountRemove = new EventEmitter<void>();

  removing = false;
  imageError = false;
  showDiscountForm = false;
  discountType: 'PERCENT' | 'AMOUNT' = 'PERCENT';
  discountValue = 0;
  private editingValue: string | null = null;

  onImageError(): void {
    this.imageError = true;
  }

  /** URL absolue vers l’API pour les chemins `/uploads/...` stockés en relatif. */
  get resolvedThumbUrl(): string | null {
    return this.productService.resolveProductImageUrl(this.line.imageUrl ?? null);
  }

  get displayValue(): string {
    return this.editingValue ?? String(this.line.quantity);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['line']) {
      const newLine = changes['line'].currentValue as PosOrderLine | undefined;
      if (newLine) {
        this.imageError = false;
        if (this.editingValue !== null && typeof newLine.quantity === 'number') {
          this.editingValue = String(newLine.quantity);
        }
      }
    }
  }

  startEditing(): void {
    this.editingValue = String(this.line.quantity);
  }

  onInput(event: Event): void {
    this.editingValue = (event.target as HTMLInputElement).value;
  }

  commitEdit(): void {
    if (this.editingValue === null) return;
    const parsed = Number(String(this.editingValue).replace(',', '.'));
    this.editingValue = null;
    if (!Number.isFinite(parsed) || parsed < 0.001) return;
    this.onQuantitySet.emit(parsed);
  }

  blurInput(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  formatPrice(price: number): string {
    return price.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }

  openDiscountForm(): void {
    this.showDiscountForm = true;
    this.discountType = this.line.discountType ?? 'PERCENT';
    this.discountValue = this.line.discountValue ?? 0;
  }

  applyDiscount(): void {
    if (this.discountValue > 0) {
      this.onDiscountSet.emit({ type: this.discountType, value: this.discountValue });
    } else {
      this.onDiscountRemove.emit();
    }
    this.showDiscountForm = false;
  }

  cancelDiscountForm(): void {
    this.showDiscountForm = false;
  }

  removeDiscount(): void {
    this.onDiscountRemove.emit();
    this.showDiscountForm = false;
  }
}
