import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductListItem } from '@core/services/product.service';

@Component({
  selector: 'app-quick-add-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="quick-add" (click)="onBackdropClick($event)">
      <div
        class="quick-add__content"
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        aria-describedby="quick-add-product">
        <div class="quick-add__header">
          <h3 id="quick-add-title" class="quick-add__title" i18n="@@pos.components.quantite.09a38fda">Quantité</h3>
          <button class="quick-add__close" (click)="onCancel()" type="button" aria-label="Fermer" i18n-aria-label="Fermer">
            <i class="pi pi-times"></i>
          </button>
        </div>
        <div class="quick-add__body">
          <p id="quick-add-product" class="quick-add__product">{{ product.name }}</p>
          @if (product.unitPrice != null) {
            <span class="quick-add__price">{{ product.unitPrice | number:'1.2-2' }} TND</span>
          }
          <div class="quick-add__field">
            <label for="quick-add-qty" i18n="@@pos.components.quantite.09a38fda">Quantité</label>
            <input
              #qtyInput
              id="quick-add-qty"
              type="number"
              [(ngModel)]="quantity"
              (keydown.enter)="onConfirm()"
              (keydown.escape)="onCancel()"
              min="0.001"
              step="0.001"
              class="quick-add__input"
              aria-label="Quantité" i18n-aria-label="Quantité" />
          </div>
        </div>
        <div class="quick-add__actions">
          <button class="quick-add__btn quick-add__btn--secondary" type="button" (click)="onCancel()" i18n="@@pos.components.annuler.49ba3292">Annuler</button>
          <button class="quick-add__btn quick-add__btn--primary" type="button" (click)="onConfirm()" [disabled]="!isValid()" i18n="@@pos.components.ajouter.87c57ed1">Ajouter</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .quick-add {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: quickAddFadeIn 200ms ease-out;
    }

    .quick-add__content {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: 0;
      min-width: 320px;
      max-width: 400px;
      box-shadow: var(--shadow-2xl);
      border: 1px solid var(--color-border-subtle);
      animation: quickAddScaleIn 280ms cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
    }

    .quick-add__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    }

    .quick-add__body {
      padding: var(--spacing-5, 1.25rem);
    }

    .quick-add__title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: var(--color-text-primary);
    }

    .quick-add__close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .quick-add__close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }

    .quick-add__close:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .quick-add__product {
      font-size: var(--font-size-base, 1rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
      margin: 0 0 var(--spacing-2, 0.5rem) 0;
      padding: var(--spacing-3, 0.75rem);
      background: var(--color-neutral-50, #f8fafc);
      border-radius: var(--radius-lg, 0.5rem);
    }

    .quick-add__price {
      display: block;
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #475569);
      margin-bottom: var(--spacing-4, 1rem);
    }

    .quick-add__field {
      margin-bottom: 0;
    }

    .quick-add__field label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .quick-add__input {
      width: 100%;
      padding: var(--spacing-4);
      font-size: var(--font-size-lg);
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-variant-numeric: tabular-nums;
    }

    .quick-add__input:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px var(--color-primary-100);
    }

    .quick-add__actions {
      display: flex;
      gap: var(--spacing-3, 0.75rem);
      justify-content: flex-end;
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f8fafc);
      border-radius: 0 0 var(--radius-2xl) var(--radius-2xl);
    }

    .quick-add__btn {
      min-width: 100px;
      padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      border-radius: var(--radius-md, 0.375rem);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .quick-add__btn:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .quick-add__btn--secondary {
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
      border: none;
    }

    .quick-add__btn--secondary:hover {
      background: var(--color-neutral-200);
    }

    .quick-add__btn--primary {
      background: var(--color-primary-600);
      color: var(--color-white);
      border: none;
    }

    .quick-add__btn--primary:hover:not(:disabled) {
      background: var(--color-primary-700);
    }

    .quick-add__btn--primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @keyframes quickAddFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes quickAddScaleIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `]
})
export class QuickAddModalComponent implements AfterViewInit {
  @Input({ required: true }) product!: ProductListItem;
  @Output() confirm = new EventEmitter<{ product: ProductListItem; quantity: number }>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('qtyInput') qtyInput!: ElementRef<HTMLInputElement>;

  quantity = 1;

  ngAfterViewInit(): void {
    setTimeout(() => this.qtyInput?.nativeElement?.focus(), 50);
  }

  isValid(): boolean {
    const q = Number(this.quantity);
    return !Number.isNaN(q) && q >= 0.001;
  }

  onConfirm(): void {
    if (!this.isValid()) return;
    const q = Number(this.quantity);
    this.confirm.emit({ product: this.product, quantity: q });
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onBackdropClick(event: Event): void {
    if ((event.target as HTMLElement).classList.contains('quick-add')) {
      this.onCancel();
    }
  }
}
