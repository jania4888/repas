import { Component, Input, inject, ElementRef, ViewChild, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { EntryFormStore } from '../services/entry-form.store';
import { EntryReferenceStore, AccountSuggestion } from '../services/entry-reference.store';
import { VatAssistService } from '../services/vat-assist.service';
import { EntryGridNavigationService } from '../services/entry-grid-navigation.service';
import { BalanceIndicatorComponent } from './balance-indicator.component';
import { AccountingAmountInputComponent } from '../../shared/accounting-amount-input.component';
import { FUNCTIONAL_CURRENCY, ThirdPartyRef } from '../models/entry-form.model';

@Component({
  selector: 'app-entry-lines-grid',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, AutoCompleteModule, BalanceIndicatorComponent, AccountingAmountInputComponent],
  template: `
    <section class="lines-grid card" aria-labelledby="lines-title">
      <div class="lines-grid__header">
        <h2 id="lines-title" class="lines-grid__title">{{ title() }}</h2>
        @if (store.totals().debit > 0 || store.totals().credit > 0) {
          <span class="lines-grid__balance-chip"
                [class.balanced]="store.isBalanced()"
                [class.unbalanced]="!store.isBalanced()"
                aria-live="polite">
            <ng-container i18n="@@accounting.manual-entry.solde.e5977cf9"> Solde </ng-container> <strong>{{ store.balance() | number : store.amountFormat() }}</strong> {{ store.currency() }}
          </span>
        }
      </div>

      <div class="lines-grid__actions" role="toolbar" aria-label="Actions sur les lignes" i18n-aria-label="@@accounting.manual-entry.actions.sur.les.lignes.faee0f63">
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="store.addLine()" i18n="@@accounting.manual-entry.ajouter.une.ligne.999d5dd7">+ Ajouter une ligne</button>
        <button type="button" class="btn btn-outline-secondary btn-sm"
                (click)="store.duplicateSelectedLines()"
                [disabled]="store.selectedLineIndexes().size === 0" i18n="@@accounting.manual-entry.dupliquer.c5e1d3f1">Dupliquer</button>
        <button type="button" class="btn btn-outline-secondary btn-sm"
                (click)="removeSelected()"
                [disabled]="store.selectedLineIndexes().size === 0 || store.lines().length <= 2" i18n="@@accounting.manual-entry.supprimer.1acfc1c7">Supprimer</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" disabled
                title="Le lettrage est disponible après enregistrement de l'écriture" i18n-title="@@accounting.manual-entry.le.lettrage.est.disponible.apres.enregistrement.d4109c88" i18n="@@accounting.manual-entry.lettrer.387be9d0">Lettrer</button>
        @if (!hideAnalyzeSlot()) {
          <ng-content select="[entryAnalyzeAction]"></ng-content>
        }
      </div>

      <div class="lines-grid__table-wrap" #gridContainer>
        <p-table
          [value]="store.lines()"
          dataKey="clientLineId"
          [scrollable]="true"
          [scrollHeight]="compactMode() ? '35vh' : '55vh'"
          styleClass="p-datatable-sm entry-lines-table">
          <ng-template pTemplate="header">
            <tr>
              <th class="col-check" style="width:2.5%">
                <input type="checkbox" [checked]="allSelected()"
                       (change)="store.selectAllLines($any($event.target).checked)"
                       aria-label="Sélectionner toutes les lignes" i18n-aria-label="@@accounting.manual-entry.selectionner.toutes.les.lignes.b850c313" />
              </th>
              <th class="col-num" style="width:2.5%" i18n="@@accounting.manual-entry.text.d08f88df">#</th>
              <th class="col-account" style="width:14%" i18n="@@accounting.manual-entry.compte.general.f5c91797">Compte général</th>
              <th class="col-label" style="width:22%" i18n="@@accounting.manual-entry.libelle.f5485bba">Libellé</th>
              <th class="col-aux" style="width:16%" i18n="@@accounting.manual-entry.auxiliaire.b8c6c266">Auxiliaire</th>
              <th class="col-amount text-right" style="width:11%">Débit{{ currencySuffix() }}</th>
              <th class="col-amount text-right" style="width:11%">Crédit{{ currencySuffix() }}</th>
              @if (store.isForeignCurrency()) {
                <th class="col-amount text-right" style="width:11%">Débit ({{ functionalCurrency }})</th>
                <th class="col-amount text-right" style="width:11%">Crédit ({{ functionalCurrency }})</th>
              }
              @if (store.columnVisibility().piece) {
                <th style="width:8%"><ng-container i18n="@@accounting.manual-entry.piece.954bbc8c">Pièce </ng-container> <span class="assist-hint" title="Aide à la saisie — non comptabilisé" i18n-title="@@accounting.manual-entry.aide.a.la.saisie.non.comptabilise.17a2df8c" i18n="@@accounting.manual-entry.text.f77b6fef">ⓘ</span></th>
              }
              @if (store.columnVisibility().dueDate) {
                <th style="width:9%"><ng-container i18n="@@accounting.manual-entry.echeance.f9a77ff6">Échéance </ng-container> <span class="assist-hint" title="Aide à la saisie — non comptabilisé" i18n-title="@@accounting.manual-entry.aide.a.la.saisie.non.comptabilise.17a2df8c" i18n="@@accounting.manual-entry.text.f77b6fef">ⓘ</span></th>
              }
              @if (store.columnVisibility().vat) {
                <th style="width:7%" i18n="@@accounting.manual-entry.tva.fb62cb5d">TVA</th>
              }
              @if (store.columnVisibility().lettering) {
                <th style="width:6%" i18n="@@accounting.manual-entry.lettrage.cfcdd333">Lettrage</th>
              }
              <th class="col-actions" style="width:5%" i18n="@@accounting.manual-entry.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line let-i="rowIndex">
            <tr [class.vat-generated]="line.isVatGenerated">
              <td class="col-check">
                <input type="checkbox" [checked]="store.selectedLineIndexes().has(i)"
                       (change)="store.toggleLineSelection(i)" [attr.aria-label]="loc_ui_tern_selectionner_ligne_c6d73c + (i+1)" />
              </td>
              <td class="text-center me-line-number col-num">{{ i + 1 }}</td>
              <td class="me-cell-account col-account"
                  [attr.data-row]="i"
                  data-field="account"
                  [class.me-cell-unknown]="store.getLineStatus(line) === 'unknown'"
                  [class.me-cell-inactive]="store.getLineStatus(line) === 'inactive'">
                <div class="me-account-wrapper">
                  <p-autoComplete
                    class="me-autocomplete"
                    [(ngModel)]="line.accountNumber"
                    [suggestions]="accountSuggestions"
                    (completeMethod)="onFilterAccounts($event)"
                    (onSelect)="onAccountSelect($event, i)"
                    [field]="'display'"
                    [minLength]="1"
                    [forceSelection]="false"
                    placeholder="N° compte" i18n-placeholder="@@accounting.manual-entry.n.compte.bfe01281"
                    appendTo="body"
                    panelStyleClass="me-autocomplete-panel"
                    [disabled]="line.isVatGenerated"
                  />
                  @if (store.getAccountClass(line); as cls) {
                    <span class="me-class-badge" [class]="'me-class-' + cls">{{ cls }}</span>
                  }
                </div>
              </td>
              <td class="col-label">
                <input type="text" [(ngModel)]="line.lineLabel" class="me-line-input" placeholder="Libellé" i18n-placeholder="@@accounting.manual-entry.libelle.f5485bba"
                       (ngModelChange)="store.updateLine(i, { lineLabel: $event })" />
              </td>
              <td class="col-aux">
                <p-autoComplete
                  class="me-autocomplete"
                  [(ngModel)]="line.thirdParty"
                  [suggestions]="refs.thirdPartySuggestions()"
                  (completeMethod)="onFilterThirdParties($event)"
                  [field]="'display'"
                  [minLength]="2"
                  [forceSelection]="true"
                  [showClear]="true"
                  placeholder="Tiers" i18n-placeholder="@@accounting.manual-entry.tiers.435080ba"
                  appendTo="body"
                  panelStyleClass="me-autocomplete-panel"
                  (ngModelChange)="onThirdPartyChange(i, $event)"
                />
              </td>
              <td class="col-amount me-amount-debit"
                  [attr.data-row]="i"
                  data-field="debit">
                <app-accounting-amount-input
                  [(ngModel)]="line.debit"
                  [compact]="true"
                  [navigateOnTab]="true"
                  [rowIndex]="i"
                  side="debit"
                  [fractionDigits]="store.currencyDecimals()"
                  [inputId]="'debit-' + i"
                  [ariaLabel]="loc_ui_tern_debit_ligne_3bdc7d + (i + 1)"
                  [disabled]="!!line.isVatGenerated"
                  (amountChange)="onDebitPreview(i)"
                  (amountCommitted)="onDebitCommit(i)"
                  (enterPressed)="onAmountEnter(i, 'debit', line)"
                  (tabFromAmount)="onAmountTab(i, 'debit', line, $event.shiftKey)" />
              </td>
              <td class="col-amount me-amount-credit"
                  [attr.data-row]="i"
                  data-field="credit">
                <app-accounting-amount-input
                  [(ngModel)]="line.credit"
                  [compact]="true"
                  [navigateOnTab]="true"
                  [rowIndex]="i"
                  side="credit"
                  [fractionDigits]="store.currencyDecimals()"
                  [inputId]="'credit-' + i"
                  [ariaLabel]="loc_ui_tern_credit_ligne_05f325 + (i + 1)"
                  [disabled]="!!line.isVatGenerated"
                  (amountChange)="onCreditPreview(i)"
                  (amountCommitted)="onCreditCommit(i)"
                  (enterPressed)="onAmountEnter(i, 'credit', line)"
                  (tabFromAmount)="onAmountTab(i, 'credit', line, $event.shiftKey)" />
              </td>
              @if (store.isForeignCurrency()) {
                <td class="col-amount text-right me-amount-cell me-amount-local">
                  {{ store.toLocalAmount(line.debit) | number : '1.3-3' }}
                </td>
                <td class="col-amount text-right me-amount-cell me-amount-local">
                  {{ store.toLocalAmount(line.credit) | number : '1.3-3' }}
                </td>
              }
              @if (store.columnVisibility().piece) {
                <td>
                  <input type="text" [(ngModel)]="line.pieceRef" class="me-line-input"
                         (ngModelChange)="store.updateLine(i, { pieceRef: $event })" />
                </td>
              }
              @if (store.columnVisibility().dueDate) {
                <td>
                  <input type="date" [(ngModel)]="line.dueDate" class="me-line-input"
                         (ngModelChange)="store.updateLine(i, { dueDate: $event })" />
                </td>
              }
              @if (store.columnVisibility().vat) {
                <td>
                  <select class="me-line-input" [ngModel]="line.vatRatePercent"
                          (ngModelChange)="onVatChange(i, $event)">
                    <option [ngValue]="null" i18n="@@accounting.manual-entry.text.1b93795b">—</option>
                    @for (r of refs.vatRates(); track r.id) {
                      <option [ngValue]="r.percent">{{ r.percent }}%</option>
                    }
                  </select>
                </td>
              }
              @if (store.columnVisibility().lettering) {
                <td><span class="lettering-disabled" title="Après enregistrement" i18n-title="@@accounting.manual-entry.apres.enregistrement.86edb723" i18n="@@accounting.manual-entry.text.1b93795b">—</span></td>
              }
              <td class="me-row-actions col-actions">
                <button type="button" class="btn btn-sm btn-outline-secondary me-row-action-btn"
                        (click)="store.duplicateLine(i)" title="Dupliquer" i18n-title="@@accounting.manual-entry.dupliquer.c5e1d3f1" i18n="@@accounting.manual-entry.text.2bdc5ad0">⎘</button>
                <button type="button" class="btn btn-sm btn-outline-danger me-row-action-btn"
                        (click)="store.removeLine(i)" [disabled]="store.lines().length <= 2" i18n="@@accounting.manual-entry.text.0951b9a0">✕</button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="lines-grid__footer-totals">
              <td [attr.colspan]="footerColspan()" i18n="@@accounting.manual-entry.totaux.a1ca02f8">Totaux</td>
              <td class="text-right me-amount-cell">{{ store.totals().debit | number : store.amountFormat() }}</td>
              <td class="text-right me-amount-cell">{{ store.totals().credit | number : store.amountFormat() }}</td>
              @if (store.isForeignCurrency()) {
                <td class="text-right me-amount-cell me-amount-local">{{ store.localTotals().debit | number : '1.3-3' }}</td>
                <td class="text-right me-amount-cell me-amount-local">{{ store.localTotals().credit | number : '1.3-3' }}</td>
              }
              @if (store.columnVisibility().piece) { <td></td> }
              @if (store.columnVisibility().dueDate) { <td></td> }
              @if (store.columnVisibility().vat) { <td></td> }
              @if (store.columnVisibility().lettering) { <td></td> }
              <td></td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <app-balance-indicator
        [totalDebit]="store.totals().debit"
        [totalCredit]="store.totals().credit"
        [currencyCode]="store.currency()"
        [amountFormat]="store.amountFormat()"
        [canAutoBalance]="store.canAutoBalance()"
        (autoBalance)="store.autoBalance()" />
    </section>
  `,
  styles: `
    .lines-grid { padding:var(--spacing-5); margin-bottom:var(--spacing-4); display:flex; flex-direction:column; min-width:0; }
    .lines-grid__header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--spacing-3); margin-bottom:var(--spacing-3); }
    .lines-grid__title { font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); margin:0; }
    .lines-grid__balance-chip { font-size:var(--font-size-sm); padding:var(--spacing-1) var(--spacing-3); border-radius:var(--radius-full); background:var(--color-background-subtle); }
    .lines-grid__balance-chip.balanced strong { color:var(--color-success-600); }
    .lines-grid__balance-chip.unbalanced strong { color:var(--color-error-600); }
    .lines-grid__actions { display:flex; flex-wrap:wrap; gap:var(--spacing-2); margin-bottom:var(--spacing-3); }
    .lines-grid__table-wrap { overflow-x:auto; overflow-y:visible; min-width:0; border-radius:var(--radius-md); }
    .lines-grid__footer-totals { font-weight:700; }
    .me-line-input { width:100%; min-width:0; padding:var(--spacing-1) var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-sm); font-size:var(--font-size-sm); box-sizing:border-box; }
    .me-line-input--amount { font-variant-numeric:tabular-nums; }
    .me-amount-debit { background: color-mix(in srgb, var(--color-primary-500, #3b82f6) 6%, transparent); }
    .me-amount-credit { background: color-mix(in srgb, var(--color-success-500, #22c55e) 6%, transparent); }
    .me-amount-cell { font-variant-numeric:tabular-nums; }
    .me-amount-local { color:var(--color-text-secondary); background:var(--color-background-subtle); }
    .text-right { text-align:right; }
    .text-center { text-align:center; }
    .me-row-actions { display:flex; gap:var(--spacing-1); justify-content:center; }
    .me-row-action-btn { min-width:2rem; }
    .me-line-number { color:var(--color-text-tertiary); font-weight:var(--font-weight-semibold); }
    .me-cell-unknown { background:var(--color-error-50); }
    .me-cell-inactive { background:var(--color-warning-50); }
    .me-account-wrapper { display:flex; align-items:center; gap:var(--spacing-1); min-width:0; }
    .me-class-badge { flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; width:1.25rem; height:1.25rem; border-radius:var(--radius-sm); font-size:0.7rem; font-weight:bold; color:#fff; font-family:monospace; }
    .me-class-1{background:#7c3aed}.me-class-2{background:#0891b2}.me-class-3{background:#65a30d}.me-class-4{background:#d97706}
    .me-class-5{background:#0284c7}.me-class-6{background:#dc2626}.me-class-7{background:#16a34a}.me-class-8{background:#64748b}.me-class-9{background:#475569}
    .assist-hint { color:var(--color-text-tertiary); cursor:help; font-size:var(--font-size-xs); }
    .lettering-disabled { color:var(--color-text-tertiary); }
    .vat-generated { background:var(--color-background-subtle); }

    :host ::ng-deep .entry-lines-table .p-datatable-table { table-layout:fixed; width:100%; min-width:52rem; }
    :host ::ng-deep .entry-lines-table .p-datatable-thead > tr > th {
      font-size:var(--font-size-xs); text-transform:uppercase; letter-spacing:0.02em;
      padding:var(--spacing-2) var(--spacing-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    :host ::ng-deep .entry-lines-table .p-datatable-tbody > tr > td {
      padding:var(--spacing-1) var(--spacing-2); vertical-align:middle; overflow:hidden;
    }
    :host ::ng-deep .entry-lines-table .p-datatable-tbody > tr > td .me-autocomplete,
    :host ::ng-deep .entry-lines-table .p-datatable-tbody > tr > td .p-autocomplete {
      width:100%; max-width:100%; min-width:0;
    }
    :host ::ng-deep .entry-lines-table .p-datatable-tbody > tr > td .p-autocomplete-input {
      width:100%; min-width:0; box-sizing:border-box;
    }
    :host ::ng-deep .me-autocomplete-panel {
      min-width:22rem; max-width:min(32rem, 90vw); z-index:1100;
    }
    :host ::ng-deep .me-autocomplete-panel .p-autocomplete-item {
      white-space:normal; word-break:break-word;
    }
  `
})
export class EntryLinesGridComponent {
  readonly loc_ui_tern_selectionner_ligne_c6d73c = $localize`:@@ui.tern.selectionner.ligne.c6d73c:Sélectionner ligne `;
  readonly loc_ui_tern_debit_ligne_3bdc7d = $localize`:@@ui.tern.debit.ligne.3bdc7d:Débit ligne `;
  readonly loc_ui_tern_credit_ligne_05f325 = $localize`:@@ui.tern.credit.ligne.05f325:Crédit ligne `;
  readonly store = inject(EntryFormStore);
  readonly refs = inject(EntryReferenceStore);
  private readonly vatAssist = inject(VatAssistService);
  private readonly gridNav = inject(EntryGridNavigationService);

  @ViewChild('gridContainer') gridContainer?: ElementRef<HTMLElement>;

  @Input() vatSide: 'deductible' | 'collected' = 'deductible';

  readonly compactMode = input(false);
  readonly hideAnalyzeSlot = input(false);
  readonly functionalCurrency = FUNCTIONAL_CURRENCY;
  readonly title = input('Lignes d\'écriture');

  accountSuggestions: AccountSuggestion[] = [];

  allSelected(): boolean {
    const n = this.store.lines().length;
    return n > 0 && this.store.selectedLineIndexes().size === n;
  }

  /** Suffixe « (EUR) » sur les colonnes saisies, vide en mono-devise. */
  currencySuffix(): string {
    return this.store.isForeignCurrency() ? ` (${this.store.currency()})` : '';
  }

  footerColspan(): number {
    let c = 5;
    if (this.store.columnVisibility().piece) c++;
    if (this.store.columnVisibility().dueDate) c++;
    return c;
  }

  removeSelected(): void {
    if (this.store.lines().length - this.store.selectedLineIndexes().size < 2) return;
    this.store.removeSelectedLines();
  }

  onFilterAccounts(event: { query: string }): void {
    this.accountSuggestions = this.refs.filterAccounts(event.query);
  }

  onAccountSelect(event: { value: AccountSuggestion }, index: number): void {
    this.store.updateLine(index, { accountNumber: event.value.number });
  }

  onFilterThirdParties(event: { query: string }): void {
    this.refs.searchThirdParties(event.query);
  }

  onThirdPartyChange(index: number, tp: ThirdPartyRef | null): void {
    this.store.updateLine(index, { thirdParty: tp });
  }

  onDebitPreview(index: number): void {
    this.store.onDebitPreview(index);
  }

  onCreditPreview(index: number): void {
    this.store.onCreditPreview(index);
  }

  onDebitCommit(index: number): void {
    this.store.onDebitChange(index);
    const line = this.store.lines()[index];
    if (line?.vatRatePercent) this.onVatChange(index, line.vatRatePercent);
  }

  onCreditCommit(index: number): void {
    this.store.onCreditChange(index);
    const line = this.store.lines()[index];
    if (line?.vatRatePercent) this.onVatChange(index, line.vatRatePercent);
  }

  onAmountEnter(index: number, field: 'debit' | 'credit', line: { debit: number | null; credit: number | null }): void {
    const container = this.gridContainer?.nativeElement;
    if (!container) return;
    this.gridNav.handleAmountEnter({
      container,
      rowIndex: index,
      field,
      debit: line.debit,
      credit: line.credit,
      totalRows: this.store.lines().length,
      onAddLine: () => this.store.addLine()
    });
  }

  onAmountTab(
    index: number,
    field: 'debit' | 'credit',
    line: { debit: number | null; credit: number | null },
    shiftKey: boolean
  ): void {
    const container = this.gridContainer?.nativeElement;
    if (!container) return;
    this.gridNav.handleAmountTab({
      container,
      rowIndex: index,
      field,
      debit: line.debit,
      credit: line.credit,
      totalRows: this.store.lines().length,
      onAddLine: () => this.store.addLine()
    }, shiftKey);
  }

  onVatChange(index: number, rate: number | null): void {
    this.vatAssist.applyVatToLine(
      this.store,
      index,
      rate,
      this.vatSide,
      this.refs.accounts()
    );
  }
}
