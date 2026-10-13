/// <reference types="@angular/localize" />
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BankStatementTabularMapping, TabularDecimalSeparator } from '../bank-statement-import/bank-statement-import.models';
import { TABULAR_DATE_FORMATS, tabularDateFormatLabel } from '../bank-statement-import/bank-statement-tabular-mapping.logic';

/**
 * Réglages de lecture du fichier CSV/XLSX (étape 2) : ligne d'en-tête, format de date fermé,
 * séparateur décimal, feuille (XLSX). Chaque changement remonte un correctif immuable au parent,
 * qui relance l'aperçu (anti-rebond géré par le parent).
 */
@Component({
  selector: 'app-bse-tabular-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bse-settings-grid" data-testid="bse-tabular-settings">
      <div>
        <label class="bse-label" for="bse-header-row" i18n="@@accounting.bank-statement-entries.ligne.d.en.tete.c7a9fd38">Ligne d'en-tête</label>
        <input id="bse-header-row" type="number" min="0" class="bse-input" data-testid="bse-map-header-row"
               [ngModel]="mapping().headerRowIndex" [disabled]="disabled()"
               (ngModelChange)="mappingChange.emit({ headerRowIndex: toNumber($event) })" />
        <p class="bse-hint" i18n="@@accounting.bank-statement-entries.0.premiere.ligne.du.fichier.d496b02b">0 = première ligne du fichier.</p>
      </div>

      <div>
        <label class="bse-label" for="bse-date-format" i18n="@@accounting.bank-statement-entries.format.de.date.5c0a44a1">Format de date</label>
        <select id="bse-date-format" class="bse-input" data-testid="bse-map-date-format"
                [ngModel]="mapping().dateFormat" [disabled]="disabled()"
                (ngModelChange)="mappingChange.emit({ dateFormat: $event })">
          @for (fmt of dateFormats; track fmt) {
            <option [ngValue]="fmt">{{ formatLabel(fmt) }}</option>
          }
        </select>
      </div>

      <div>
        <label class="bse-label" for="bse-decimal-sep" i18n="@@accounting.bank-statement-entries.separateur.decimal.9b2f9a21">Séparateur décimal</label>
        <select id="bse-decimal-sep" class="bse-input" data-testid="bse-map-decimal"
                [ngModel]="mapping().decimalSeparator" [disabled]="disabled()"
                (ngModelChange)="onDecimalSeparatorChange($event)">
          <option ngValue="," i18n="@@accounting.bank-statement-entries.virgule.1.250.000.ea6c9d10">Virgule ( 1 250,000 )</option>
          <option ngValue="." i18n="@@accounting.bank-statement-entries.point.1.250.000.b.5a1d2e44">Point ( 1,250.000 )</option>
        </select>
      </div>

      @if (format() === 'xlsx' && sheetNames().length > 1) {
        <div>
          <label class="bse-label" for="bse-sheet-index" i18n="@@accounting.bank-statement-entries.feuille.excel.4a1f0c56">Feuille Excel</label>
          <select id="bse-sheet-index" class="bse-input" data-testid="bse-map-sheet"
                  [ngModel]="mapping().sheetIndex ?? 0" [disabled]="disabled()"
                  (ngModelChange)="mappingChange.emit({ sheetIndex: toNumber($event) })">
            @for (name of sheetNames(); track name; let i = $index) {
              <option [ngValue]="i">{{ name }}</option>
            }
          </select>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .bse-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem 1.25rem; }
      .bse-label { display: block; margin-top: 0.25rem; font-weight: 600; }
      .bse-input { width: 100%; padding: 0.4rem 0.6rem; margin-top: 0.25rem; }
      .bse-hint { color: #6c757d; font-size: 0.8rem; margin: 0.25rem 0 0; }
    `
  ]
})
export class BseTabularSettingsComponent {
  readonly mapping = input.required<BankStatementTabularMapping>();
  readonly format = input<'csv' | 'xlsx'>('csv');
  readonly sheetNames = input<string[]>([]);
  readonly disabled = input(false);

  readonly mappingChange = output<Partial<BankStatementTabularMapping>>();

  readonly dateFormats = TABULAR_DATE_FORMATS;

  formatLabel(fmt: string): string {
    return tabularDateFormatLabel(fmt);
  }

  toNumber(value: string | number): number {
    return typeof value === 'number' ? value : parseInt(value, 10) || 0;
  }

  onDecimalSeparatorChange(value: TabularDecimalSeparator): void {
    this.mappingChange.emit({ decimalSeparator: value });
  }
}
