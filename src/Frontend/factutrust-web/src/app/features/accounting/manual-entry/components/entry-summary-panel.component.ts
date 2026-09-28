import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntryFormStore } from '../services/entry-form.store';
import { formatPeriodLabel } from '../models/guided-scenarios.catalog';
import { FUNCTIONAL_CURRENCY } from '../models/entry-form.model';

@Component({
  selector: 'app-entry-summary-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="summary-panel card" aria-labelledby="summary-title">
      <h3 id="summary-title" class="summary-panel__title" i18n="@@accounting.manual-entry.recapitulatif.d5b5de6d">Récapitulatif</h3>
      <dl class="summary-panel__list">
        <div class="summary-row">
          <dt i18n="@@accounting.manual-entry.journal.57d7f743">Journal</dt>
          <dd>{{ store.journalCode() }}</dd>
        </div>
        <div class="summary-row">
          <dt i18n="@@accounting.manual-entry.date.eb9a4bc1">Date</dt>
          <dd>{{ store.entryDate() | date:'dd/MM/yyyy' }}</dd>
        </div>
        @if (store.selectedPeriod(); as period) {
          <div class="summary-row">
            <dt i18n="@@accounting.manual-entry.periode.de2110b7">Période</dt>
            <dd>{{ periodLabel(period) }}</dd>
          </div>
        }
        @if (store.pieceRef()) {
          <div class="summary-row">
            <dt i18n="@@accounting.manual-entry.reference.f8130bb0">Référence</dt>
            <dd>{{ store.pieceRef() }}</dd>
          </div>
        }
        @if (store.dominantThirdParty(); as tp) {
          <div class="summary-row">
            <dt i18n="@@accounting.manual-entry.tiers.435080ba">Tiers</dt>
            <dd>{{ tp.name }}</dd>
          </div>
        }
        @if (store.isForeignCurrency()) {
          <div class="summary-row">
            <dt i18n="@@accounting.manual-entry.devise.eb2e42c4">Devise</dt>
            <dd>{{ store.currency() }}</dd>
          </div>
          @if (store.exchangeRate(); as rate) {
            <div class="summary-row">
              <dt i18n="@@accounting.manual-entry.taux.18bc95b8">Taux</dt>
              <dd class="mono">{{ rate }}</dd>
            </div>
          }
        }
        <div class="summary-row">
          <dt i18n="@@accounting.manual-entry.total.debit.ea9c4853">Total débit</dt>
          <dd class="mono">{{ store.totals().debit | number : store.amountFormat() }} {{ store.currency() }}</dd>
        </div>
        <div class="summary-row">
          <dt i18n="@@accounting.manual-entry.total.credit.98c95962">Total crédit</dt>
          <dd class="mono">{{ store.totals().credit | number : store.amountFormat() }} {{ store.currency() }}</dd>
        </div>
        <div class="summary-row" [class.summary-row--highlight]="!store.isForeignCurrency()">
          <dt i18n="@@accounting.manual-entry.solde.e5977cf9">Solde</dt>
          <dd class="mono" [class.balanced]="store.isBalanced()" [class.unbalanced]="!store.isBalanced()">
            {{ store.balance() | number : store.amountFormat() }} {{ store.currency() }}
          </dd>
        </div>
        @if (store.isForeignCurrency()) {
          <!-- Contre-valeur : indicative. Le serveur recalcule et absorbe le résidu d'arrondi. -->
          <div class="summary-row summary-row--highlight">
            <dt i18n="@@accounting.manual-entry.solde.92b840e4">Solde {{ functionalCurrency }}</dt>
            <dd class="mono">{{ store.localBalance() | number:'1.3-3' }} {{ functionalCurrency }}</dd>
          </div>
        }
      </dl>
      @if (store.hasNonPersistedAssistFields()) {
        <p class="summary-panel__warn" role="note" i18n="@@accounting.manual-entry.certaines.colonnes.d.aide.piece.echeance.ne.sero.90877df6"> Certaines colonnes d'aide (pièce, échéance) ne seront pas enregistrées. </p>
      }
    </aside>
  `,
  styles: `
    .summary-panel { padding:var(--spacing-4); }
    .summary-panel__title { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-3); text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-secondary); }
    .summary-panel__list { margin:0; }
    .summary-row { display:flex; justify-content:space-between; gap:var(--spacing-2); padding:var(--spacing-2) 0; border-bottom:1px solid var(--color-border-subtle); font-size:var(--font-size-sm); }
    .summary-row dt { color:var(--color-text-secondary); margin:0; }
    .summary-row dd { margin:0; font-weight:var(--font-weight-medium); text-align:end; }
    .summary-row--highlight { border-bottom:none; padding-top:var(--spacing-3); }
    .mono { font-variant-numeric:tabular-nums; }
    .balanced { color:var(--color-success-600); }
    .unbalanced { color:var(--color-error-600); }
    .summary-panel__warn { font-size:var(--font-size-xs); color:var(--color-warning-700); margin:var(--spacing-3) 0 0; padding:var(--spacing-2); background:var(--color-warning-50); border-radius:var(--radius-sm); }
  `
})
export class EntrySummaryPanelComponent {
  readonly store = inject(EntryFormStore);
  readonly functionalCurrency = FUNCTIONAL_CURRENCY;

  periodLabel(p: { fiscalYear: number; month: number }): string {
    return formatPeriodLabel(p.fiscalYear, p.month);
  }
}
