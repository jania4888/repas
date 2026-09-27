import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FUNCTIONAL_CURRENCY, MILLIME_DECIMALS } from '../models/entry-form.model';

@Component({
  selector: 'app-balance-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="me-balance-indicator"
         role="status"
         aria-live="polite"
         [class.me-empty]="isEmpty()"
         [class.me-balanced]="isBalanced()"
         [class.me-unbalanced]="isUnbalanced()">
      <div class="me-balance-text">
        <span class="me-balance-icon" aria-hidden="true">{{ balanceIcon() }}</span>
        @if (isEmpty()) {
          <span class="me-balance-label" i18n="@@accounting.manual-entry.saisissez.vos.lignes.d.ecriture.bd13992e">Saisissez vos lignes d'écriture</span>
        } @else if (isBalanced()) {
          <span class="me-balance-label" i18n="@@accounting.manual-entry.ecriture.equilibree.vous.pouvez.enregistrer.45eefb66">Écriture équilibrée — vous pouvez enregistrer</span>
        } @else {
          <span class="me-balance-label">
            <ng-container i18n="@@accounting.manual-entry.ecart.c3b7ae14"> Écart : </ng-container>
            <strong>{{ gap() | number : amountFormat() }}</strong>
            <span class="me-balance-currency"> {{ currencyCode() }}</span>
          </span>
        }
      </div>
      @if (canAutoBalance()) {
        <button type="button"
                class="btn btn-outline-primary btn-sm me-auto-balance-btn"
                (click)="autoBalance.emit()"
                aria-label="Équilibrer automatiquement l'écriture" i18n-aria-label="@@accounting.manual-entry.equilibrer.automatiquement.l.ecriture.0aa4aea5" i18n="@@accounting.manual-entry.equilibrer.auto.1d16ebc0"> ⇆ Équilibrer auto </button>
      }
    </div>
  `,
  styles: `
    .me-balance-indicator { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-3); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); font-weight:var(--font-weight-semibold); margin:var(--spacing-3) 0 0; }
    .me-empty { background:var(--color-background-subtle); color:var(--color-text-secondary); border:1px solid var(--color-border-subtle); font-weight:var(--font-weight-medium); }
    .me-balanced { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200,#bbf7d0); }
    .me-unbalanced { background:var(--color-error-50,#fef2f2); color:var(--color-error-700,#b91c1c); border:1px solid var(--color-error-200,#fecaca); }
    .me-balance-text { display:flex; align-items:center; gap:var(--spacing-2); flex-wrap:wrap; }
    .me-balance-icon { font-size:1.1em; font-weight:var(--font-weight-bold); }
    .me-balance-currency { font-weight:var(--font-weight-normal); opacity:0.75; }
    .me-auto-balance-btn { white-space:nowrap; }
  `
})
export class BalanceIndicatorComponent {
  readonly totalDebit = input.required<number>();
  readonly totalCredit = input.required<number>();
  readonly canAutoBalance = input<boolean>(false);

  /**
   * Devise de l'écart : celle de la SAISIE, jamais la devise de tenue. L'équilibre s'apprécie sur
   * les montants saisis, et « Équilibrer auto » y place bien son montant — afficher un autre
   * libellé donnerait un nombre qui n'existe dans aucune des deux devises. La contre-valeur en
   * dinar, elle, est portée par le récapitulatif.
   *
   * Les deux valeurs par défaut reproduisent l'affichage mono-devise : un appelant qui ne les
   * passe pas est rigoureusement inchangé.
   */
  readonly currencyCode = input<string>(FUNCTIONAL_CURRENCY);
  readonly amountFormat = input<string>(`1.${MILLIME_DECIMALS}-${MILLIME_DECIMALS}`);

  readonly autoBalance = output<void>();

  readonly isEmpty = computed(() => {
    const d = this.totalDebit();
    const c = this.totalCredit();
    return Math.round(d * 1000) === 0 && Math.round(c * 1000) === 0;
  });

  readonly isBalanced = computed(() => {
    const d = this.totalDebit();
    const c = this.totalCredit();
    return Math.round(d * 1000) === Math.round(c * 1000) && d > 0;
  });

  readonly isUnbalanced = computed(() => !this.isEmpty() && !this.isBalanced());

  readonly gap = computed(() => this.totalDebit() - this.totalCredit());

  balanceIcon(): string {
    if (this.isEmpty()) return '○';
    if (this.isBalanced()) return '✓';
    return '⚠';
  }
}
