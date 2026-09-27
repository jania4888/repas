import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PosStateService } from '../../services/pos-state.service';
import { PaymentMethod } from '../../../invoices/invoice-wizard/models/invoice-wizard.models';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.Cash]: $localize`:@@ui.tern.especes.958d74:Especes`,
  [PaymentMethod.Card]: $localize`:@@ui.tern.carte.8bb683:Carte`,
  [PaymentMethod.BankTransfer]: $localize`:@@ui.tern.virement.afbaf9:Virement`,
  [PaymentMethod.Check]: $localize`:@@ui.tern.cheque.6c0a13:Cheque`,
  [PaymentMethod.Effect]: $localize`:@@ui.tern.effet.3b25c0:Effet`
};

@Component({
  selector: 'app-split-payment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="split-payment">
      <div class="split-payment__header">
        <div class="split-payment__header-text">
          <span class="split-payment__title" i18n="@@pos.components.paiement.fractionne.fe60f8f8">Paiement fractionné</span>
          <span class="split-payment__hint" i18n="@@pos.components.repartir.le.montant.entre.plusieurs.moyens.de.pa.7454250d">Répartir le montant entre plusieurs moyens de paiement</span>
        </div>
        <span class="split-payment__remaining" [class.split-payment__remaining--ok]="posState.remainingAmount() <= 0" i18n="@@pos.components.reste.b47d15f8">
          Reste : {{ posState.formatAmountWithCurrency(maxRemaining()) }}
        </span>
      </div>

      <div class="split-payment__list">
        @if (posState.paymentSplits().length === 0) {
          <p class="split-payment__empty" i18n="@@pos.components.aucun.paiement.ajoute.choisissez.un.moyen.et.un..71e82d27">Aucun paiement ajouté. Choisissez un moyen et un montant ci-dessous.</p>
        }
        @for (split of posState.paymentSplits(); track split; let i = $index) {
          <div class="split-payment__row">
            <span class="split-payment__method">{{ METHOD_LABELS[split.method] }}</span>
            <input
              type="number"
              [ngModel]="split.amount"
              (ngModelChange)="posState.updatePaymentSplit(i, $event)"
              min="0"
              step="0.001"
              class="split-payment__input" />
            <button type="button" class="split-payment__remove" (click)="posState.removePaymentSplit(i)" aria-label="Supprimer" i18n-aria-label="@@pos.components.supprimer.1acfc1c7">
              <i class="pi pi-times"></i>
            </button>
          </div>
        }
      </div>

      <div class="split-payment__add">
        <select #methodSelect class="split-payment__select">
          @for (m of availableMethods; track m.value) {
            <option [value]="m.value">{{ m.label }}</option>
          }
        </select>
        <input #amountInput type="number" min="0" step="0.001" placeholder="Montant" i18n-placeholder="@@pos.components.montant.4adcd9fc" class="split-payment__input" />
        <button type="button" class="split-payment__add-btn" (click)="addSplit(methodSelect.value, amountInput.value)" i18n="@@pos.components.ajouter.33e2b019">
          <i class="pi pi-plus"></i> Ajouter
        </button>
      </div>

      <button type="button" class="split-payment__cancel" (click)="posState.disableSplitPayment()" i18n="@@pos.components.annuler.le.paiement.fractionne.82548779"> Annuler le paiement fractionné </button>
    </div>
  `,
  styles: [`
    .split-payment {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      background: var(--color-background-subtle, #faf8f5);
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-border-subtle);
    }

    .split-payment__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--spacing-3);
    }

    .split-payment__header-text {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .split-payment__title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .split-payment__hint {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-normal);
      color: var(--color-text-tertiary);
    }

    .split-payment__remaining {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      flex-shrink: 0;
      color: var(--color-error-600);
      font-variant-numeric: tabular-nums;
    }

    .split-payment__remaining--ok {
      color: var(--color-success-600);
    }

    .split-payment__empty {
      margin: 0;
      padding: var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      background: var(--color-white);
      border-radius: var(--radius-lg);
      border: 1px dashed var(--color-border-default);
    }

    .split-payment__list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .split-payment__row {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .split-payment__method {
      min-width: 80px;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .split-payment__input {
      flex: 1;
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-variant-numeric: tabular-nums;
    }

    .split-payment__remove {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-error-50);
      color: var(--color-error-600);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .split-payment__add {
      display: flex;
      gap: var(--spacing-2);
      align-items: center;
    }

    .split-payment__select {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      min-width: 100px;
    }

    .split-payment__add-btn {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-primary-500);
      color: var(--color-white);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .split-payment__cancel {
      padding: var(--spacing-2);
      border: none;
      background: transparent;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
      cursor: pointer;
      text-decoration: underline;
    }
  `]
})
export class SplitPaymentComponent {
  readonly posState = inject(PosStateService);

  readonly METHOD_LABELS = METHOD_LABELS;

  readonly availableMethods = [
    { value: PaymentMethod.Cash, label: 'Especes' },
    { value: PaymentMethod.Card, label: 'Carte' },
    { value: PaymentMethod.BankTransfer, label: 'Virement' },
    { value: PaymentMethod.Check, label: 'Cheque' }
  ];

  maxRemaining(): number {
    return Math.max(0, this.posState.remainingAmount());
  }

  addSplit(methodValue: string, amountStr: string): void {
    const amount = parseFloat(amountStr) || 0;
    if (amount <= 0) return;
    const method = methodValue as PaymentMethod;
    this.posState.addPaymentSplit(method, amount);
  }
}
