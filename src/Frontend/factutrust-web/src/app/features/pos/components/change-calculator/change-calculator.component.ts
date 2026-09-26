import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-change-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="change-calc">
      <div class="change-calc__content">
        <h3 class="change-calc__title" i18n="@@pos.components.rendu.de.monnaie.96ba5322">Rendu de monnaie</h3>
        <p class="change-calc__total">Total a payer : {{ formatAmount(totalToPay) }} TND</p>

        <div class="change-calc__field">
          <label for="amount-received" i18n="@@pos.components.montant.recu.236b7f76">Montant recu</label>
          <input
            #amountInput
            id="amount-received"
            type="number"
            [(ngModel)]="amountReceived"
            (ngModelChange)="onAmountChange()"
            [min]="0"
            step="0.001"
            placeholder="0.000" i18n-placeholder="0.000"
            class="change-calc__input" />
        </div>

        @if (amountReceived > 0) {
          <div class="change-calc__result">
            <span class="change-calc__result-label" i18n="@@pos.components.rendu.c05eb967">Rendu :</span>
            <span class="change-calc__result-value">{{ formatAmount(changeAmount) }} TND</span>
          </div>

          @if (changeBreakdown().length > 0) {
            <div class="change-calc__breakdown">
              @for (item of changeBreakdown(); track item.label) {
                <span class="change-calc__breakdown-item">{{ item.count }} x {{ item.label }}</span>
              }
            </div>
          }
        }

        <div class="change-calc__suggestions">
          @for (s of suggestedAmounts(); track s) {
            <button type="button" class="change-calc__suggestion" (click)="setAmount(s)">
              {{ formatAmount(s) }}
            </button>
          }
        </div>

        <button type="button" class="change-calc__close" [disabled]="disableFinish" (click)="onClose.emit()">
          @if (disableFinish) {
            <i class="pi pi-spin pi-spinner"></i> Enregistrement...
          } @else {
            <i class="pi pi-check"></i> Terminer
          }
        </button>
      </div>
    </div>
  `,
  styles: [`
    .change-calc {
      position: fixed;
      inset: 0;
      z-index: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.35);
      backdrop-filter: blur(6px);
      animation: fadeIn 200ms ease-out;
    }

    .change-calc__content {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      max-width: 400px;
      width: 90%;
      box-shadow: var(--shadow-2xl);
      animation: scaleIn 250ms cubic-bezier(0.34, 1.2, 0.64, 1);
    }

    .change-calc__title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      margin: 0 0 var(--spacing-4) 0;
      color: var(--color-text-primary);
    }

    .change-calc__total {
      font-size: var(--font-size-base);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-5) 0;
    }

    .change-calc__field {
      margin-bottom: var(--spacing-4);
    }

    .change-calc__field label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-2);
    }

    .change-calc__input {
      width: 100%;
      padding: var(--spacing-4);
      font-size: 1.5rem;
      font-weight: var(--font-weight-bold);
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
      border: 2px solid var(--color-border-default);
      border-radius: var(--radius-xl);
      text-align: center;
    }

    .change-calc__input:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px var(--color-primary-100);
    }

    .change-calc__result {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4);
      background: var(--color-success-50);
      border-radius: var(--radius-xl);
      margin-bottom: var(--spacing-4);
    }

    .change-calc__result-label {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .change-calc__result-value {
      font-size: 1.5rem;
      font-weight: var(--font-weight-bold);
      font-family: 'JetBrains Mono', monospace;
      color: var(--color-success-700);
    }

    .change-calc__breakdown {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .change-calc__breakdown-item {
      padding: 4px 8px;
      background: var(--color-neutral-100);
      border-radius: var(--radius-md);
    }

    .change-calc__suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-5);
    }

    .change-calc__suggestion {
      padding: var(--spacing-2) var(--spacing-4);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .change-calc__suggestion:hover {
      background: var(--color-primary-50);
      border-color: var(--color-primary-300);
      color: var(--color-primary-700);
    }

    .change-calc__close {
      width: 100%;
      padding: var(--spacing-4);
      border: none;
      border-radius: var(--radius-xl);
      background: linear-gradient(135deg, #1a5c4c 0%, #0f4c3d 100%);
      color: var(--color-white);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      transition: all 200ms ease;
    }

    .change-calc__close:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(26, 92, 76, 0.3);
    }

    .change-calc__close:disabled {
      opacity: 0.8;
      cursor: not-allowed;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `]
})
export class ChangeCalculatorComponent implements AfterViewInit {
  @Input() totalToPay = 0;
  /** Désactive le bouton Terminer (ex. pendant l'enregistrement du paiement). */
  @Input() disableFinish = false;
  @Output() onClose = new EventEmitter<void>();

  @ViewChild('amountInput') amountInput!: ElementRef<HTMLInputElement>;

  amountReceived = 0;

  ngAfterViewInit(): void {
    setTimeout(() => this.amountInput?.nativeElement?.focus(), 100);
  }

  get changeAmount(): number {
    return Math.max(0, this.amountReceived - this.totalToPay);
  }

  suggestedAmounts(): number[] {
    const total = this.totalToPay;
    const decimals = total % 1;
    const base = Math.ceil(total);
    const suggestions: number[] = [];
    if (base > 0) suggestions.push(base);
    const next = Math.ceil(base / 10) * 10;
    if (next > base && !suggestions.includes(next)) suggestions.push(next);
    const next50 = Math.ceil(base / 50) * 50;
    if (next50 > base && !suggestions.includes(next50)) suggestions.push(next50);
    const next100 = Math.ceil(base / 100) * 100;
    if (next100 > base && !suggestions.includes(next100)) suggestions.push(next100);
    return [...new Set(suggestions)].sort((a, b) => a - b).slice(0, 5);
  }

  changeBreakdown(): { label: string; count: number }[] {
    const change = this.changeAmount;
    if (change <= 0) return [];
    const result: { label: string; count: number }[] = [];
    const units = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
    let remaining = Math.round(change * 1000) / 1000;
    for (const u of units) {
      if (remaining <= 0) break;
      const count = Math.floor(remaining / u);
      if (count > 0) {
        result.push({ label: `${u} TND`, count });
        remaining = Math.round((remaining - count * u) * 1000) / 1000;
      }
    }
    return result;
  }

  onAmountChange(): void {}

  setAmount(amount: number): void {
    this.amountReceived = amount;
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }
}
