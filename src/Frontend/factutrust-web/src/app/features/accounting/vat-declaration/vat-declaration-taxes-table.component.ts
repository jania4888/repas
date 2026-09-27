import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { VatDeclarationExtras, VatExtrasKey, VatTaxTableRow, hasSuggestionMismatch } from './vat-declaration.view-model';

@Component({
  selector: 'app-vat-declaration-taxes-table',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule],
  template: `
    <div class="card vat-zone-card">
      <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.3.detail.des.impots.et.taxes.6f5e7faa">3. Détail des impôts et taxes</h3>
      <p-table [value]="rows" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@accounting.vat-declaration.impot.taxe.48a97567">Impôt / Taxe</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.base.imposable.e1baa7e1">Base imposable</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.taux.bb9a8c5a">Taux (%)</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.montant.a.payer.caf88629">Montant à payer</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.montant.deductible.6215a9e6">Montant déductible</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.net.a.payer.7835df38">Net à payer</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr [class.vat-row-highlight]="row.highlight" [class.vat-row-bold]="row.bold">
            <td>{{ row.taxLabel }}</td>
            <td class="text-right tabnum">{{ formatAmount(row.taxableBase) }}</td>
            <td class="text-right tabnum">{{ row.ratePercent != null ? (row.ratePercent | number:'1.0-2') : '—' }}</td>
            <td class="text-right tabnum">
              @if (row.editableKey && row.editableKey !== 'acomptes' && !disabled) {
                <input type="number" class="vat-edit" [ngModel]="getExtra(row.editableKey)" (ngModelChange)="onExtraChange(row.editableKey, $event)" />
                @if (row.suggestedAmount != null) {
                  <div class="vat-suggest" [class.vat-suggest--mismatch]="isMismatch(row)">
                    <span>Suggéré : {{ formatAmount(row.suggestedAmount) }}</span>
                    @if (isMismatch(row)) {
                      <button type="button" class="vat-suggest-apply" (click)="applySuggestion(row)"
                        title="Aligner le montant sur la valeur calculée par les modules" i18n-title="@@accounting.vat-declaration.aligner.le.montant.sur.la.valeur.calculee.par.le.1e7ca34d" i18n="@@accounting.vat-declaration.aligner.4a0642db">Aligner</button>
                    }
                  </div>
                }
              } @else {
                {{ formatAmount(row.amountToPay) }}
              }
            </td>
            <td class="text-right tabnum">
              @if (row.editableKey === 'acomptes' && !disabled) {
                <input type="number" class="vat-edit" [ngModel]="extras.acomptes" (ngModelChange)="onExtraChange('acomptes', $event)" />
              } @else {
                {{ formatAmount(row.deductibleAmount) }}
              }
            </td>
            <td class="text-right tabnum">{{ formatNet(row.netAmount) }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .vat-zone-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .vat-zone-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin: 0 0 var(--spacing-4); color: var(--color-text-primary); }
    .text-right { text-align: right; }
    .tabnum { font-variant-numeric: tabular-nums; }
    .vat-row-highlight { background: var(--color-primary-50,#eff6ff) !important; }
    .vat-row-bold td { font-weight: var(--font-weight-semibold); }
    .vat-edit { text-align: right; font-variant-numeric: tabular-nums; padding: var(--spacing-1) var(--spacing-2); border: 1px solid var(--color-border-default); border-radius: var(--radius-sm); width: 100%; max-width: 8rem; font-size: var(--font-size-sm); }
    .vat-suggest { display: flex; align-items: center; justify-content: flex-end; gap: var(--spacing-2); margin-top: var(--spacing-1); font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .vat-suggest--mismatch { color: var(--color-warning-700,#b45309); font-weight: var(--font-weight-medium); }
    .vat-suggest-apply { border: 1px solid currentColor; background: transparent; color: inherit; border-radius: var(--radius-sm); padding: 0 var(--spacing-2); font-size: var(--font-size-xs); cursor: pointer; line-height: 1.4; }
    .vat-suggest-apply:hover { background: var(--color-warning-50,#fffbeb); }
  `
})
export class VatDeclarationTaxesTableComponent {
  @Input() rows: VatTaxTableRow[] = [];
  @Input() extras: VatDeclarationExtras = { fodec: 0, droitTimbre: 0, tcl: 0, tfp: 0, foprolos: 0, withholdingTax: 0, acomptes: 0 };
  @Input() disabled = false;

  @Output() extraChange = new EventEmitter<{ key: VatExtrasKey; value: unknown }>();

  onExtraChange(key: VatExtrasKey, value: unknown): void {
    this.extraChange.emit({ key, value });
  }

  getExtra(key: VatExtrasKey): number {
    return this.extras[key];
  }

  /** Écart entre le montant saisi et ce que les modules produiraient pour cette ligne. */
  isMismatch(row: VatTaxTableRow): boolean {
    if (!row.editableKey) return false;
    return hasSuggestionMismatch(this.getExtra(row.editableKey), row.suggestedAmount);
  }

  /** Aligne le montant éditable sur la valeur suggérée (action explicite : n'écrase jamais sans clic). */
  applySuggestion(row: VatTaxTableRow): void {
    if (row.editableKey && row.suggestedAmount != null) {
      this.extraChange.emit({ key: row.editableKey, value: row.suggestedAmount });
    }
  }

  formatAmount(value: number | null | undefined): string {
    if (value == null) return '—';
    return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  formatNet(value: number | null | undefined): string {
    if (value == null) return '—';
    return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
}
