/// <reference types="@angular/localize" />
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BankStatementTabularColumn, BankStatementTabularMapping, TabularSignConvention } from '../bank-statement-import/bank-statement-import.models';
import { columnLabel, labelColumnSlot, withLabelColumnSlot } from '../bank-statement-import/bank-statement-tabular-mapping.logic';

/**
 * Sélecteurs de rôle de colonne optionnels (étape 2) non couverts par les champs obligatoires
 * du composant parent : date de valeur, libellé (2ᵉ et 3ᵉ colonne), référence, colonne solde,
 * et sens des montants négatifs quand `amountMode = signed`.
 */
@Component({
  selector: 'app-bse-tabular-column-roles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bse-roles-grid" data-testid="bse-tabular-column-roles">
      <div>
        <label class="bse-label" for="bse-value-date-column" i18n="@@accounting.bank-statement-entries.date.de.valeur.optionnel.5a9b1c0e">Date de valeur (optionnel)</label>
        <select id="bse-value-date-column" class="bse-input" data-testid="bse-map-value-date"
                [ngModel]="mapping().valueDateColumn ?? null" [disabled]="disabled()"
                (ngModelChange)="mappingChange.emit({ valueDateColumn: $event })">
          <option [ngValue]="null" i18n="@@accounting.bank-statement-entries.aucune.9c3e0a1b">Aucune</option>
          @for (col of columns(); track col.index) {
            <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
          }
        </select>
      </div>

      <div>
        <label class="bse-label" for="bse-reference-column" i18n="@@accounting.bank-statement-entries.reference.optionnel.2e7b4f1d">Référence (optionnel)</label>
        <select id="bse-reference-column" class="bse-input" data-testid="bse-map-reference"
                [ngModel]="mapping().referenceColumn ?? null" [disabled]="disabled()"
                (ngModelChange)="mappingChange.emit({ referenceColumn: $event })">
          <option [ngValue]="null" i18n="@@accounting.bank-statement-entries.aucune.2.4b8a9c2f">Aucune</option>
          @for (col of columns(); track col.index) {
            <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
          }
        </select>
      </div>

      <div>
        <label class="bse-label" for="bse-label-column-2" i18n="@@accounting.bank-statement-entries.libelle.complementaire.1.6c2e9a4d">Libellé complémentaire 1 (optionnel)</label>
        <select id="bse-label-column-2" class="bse-input" data-testid="bse-map-label-2"
                [ngModel]="labelSlot(1)" [disabled]="disabled()"
                (ngModelChange)="emitLabelSlot(1, $event)">
          <option [ngValue]="null" i18n="@@accounting.bank-statement-entries.aucune.3.0b7f3e5a">Aucune</option>
          @for (col of columns(); track col.index) {
            <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
          }
        </select>
      </div>

      <div>
        <label class="bse-label" for="bse-label-column-3" i18n="@@accounting.bank-statement-entries.libelle.complementaire.2.7d1a2f6b">Libellé complémentaire 2 (optionnel)</label>
        <select id="bse-label-column-3" class="bse-input" data-testid="bse-map-label-3"
                [ngModel]="labelSlot(2)" [disabled]="disabled() || labelSlot(1) == null"
                (ngModelChange)="emitLabelSlot(2, $event)">
          <option [ngValue]="null" i18n="@@accounting.bank-statement-entries.aucune.4.9e2c5a7d">Aucune</option>
          @for (col of columns(); track col.index) {
            <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
          }
        </select>
      </div>

      <div>
        <label class="bse-label" for="bse-balance-column" i18n="@@accounting.bank-statement-entries.colonne.solde.5f0d8b2c">Colonne solde</label>
        <select id="bse-balance-column" class="bse-input" data-testid="bse-map-balance"
                [ngModel]="mapping().balanceColumn ?? null" [disabled]="disabled()"
                (ngModelChange)="mappingChange.emit({ balanceColumn: $event })">
          <option [ngValue]="null" i18n="@@accounting.bank-statement-entries.aucune.saisie.manuelle.des.soldes.3c9a1e7f">Aucune — saisie manuelle des soldes</option>
          @for (col of columns(); track col.index) {
            <option [ngValue]="col.index">{{ columnLabel(col) }}</option>
          }
        </select>
      </div>

      @if (mapping().amountMode === 'signed') {
        <div>
          <label class="bse-label" i18n="@@accounting.bank-statement-entries.sens.du.montant.negatif.8a3f0d2e">Sens du montant négatif</label>
          <label>
            <input type="radio" name="bse-sign-convention" value="negativeIsDebit" data-testid="bse-map-sign-debit"
                   [ngModel]="mapping().signConvention ?? 'negativeIsDebit'" [disabled]="disabled()"
                   (ngModelChange)="emitSignConvention($event)" />
            <span i18n="@@accounting.bank-statement-entries.negatif.debit.sortie.1a7c3e9f">Négatif = débit (sortie)</span>
          </label>
          <label>
            <input type="radio" name="bse-sign-convention" value="negativeIsCredit" data-testid="bse-map-sign-credit"
                   [ngModel]="mapping().signConvention ?? 'negativeIsDebit'" [disabled]="disabled()"
                   (ngModelChange)="emitSignConvention($event)" />
            <span i18n="@@accounting.bank-statement-entries.negatif.credit.entree.2b8d4f0a">Négatif = crédit (entrée)</span>
          </label>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .bse-roles-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem 1.25rem; margin-top: 0.75rem; }
      .bse-label { display: block; margin-top: 0.25rem; font-weight: 600; }
      .bse-input { width: 100%; padding: 0.4rem 0.6rem; margin-top: 0.25rem; }
    `
  ]
})
export class BseTabularColumnRolesComponent {
  readonly mapping = input.required<BankStatementTabularMapping>();
  readonly columns = input<BankStatementTabularColumn[]>([]);
  readonly disabled = input(false);

  readonly mappingChange = output<Partial<BankStatementTabularMapping>>();

  /** Libellé affiché d'une colonne, partagé avec le composant parent (helper pur). */
  readonly columnLabel = columnLabel;

  labelSlot(slot: 0 | 1 | 2): number | null {
    return labelColumnSlot(this.mapping(), slot);
  }

  emitLabelSlot(slot: 0 | 1 | 2, value: number | null): void {
    this.mappingChange.emit({ labelColumns: withLabelColumnSlot(this.mapping(), slot, value) });
  }

  emitSignConvention(value: TabularSignConvention): void {
    this.mappingChange.emit({ signConvention: value });
  }
}
