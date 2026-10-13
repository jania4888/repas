/// <reference types="@angular/localize" />
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BankStatementTabularColumn, BankStatementTabularRow } from '../bank-statement-import/bank-statement-import.models';

/**
 * Aperçu brut des lignes du fichier (étape 2), au plus 20 lignes fournies par le backend
 * (`tabularPreview.rows`). La ligne d'en-tête est mise en évidence selon `headerRowIndex`.
 */
@Component({
  selector: 'app-bse-tabular-rows-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="bse-rows-wrap" data-testid="bse-tabular-rows-preview">
      <table class="bse-rows-table">
        <thead>
          <tr>
            <th class="bse-rn" i18n="@@accounting.bank-statement-entries.ligne.95ab6e68">Ligne</th>
            @for (col of columns(); track col.index) {
              <th>{{ col.letter }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.rowNumber) {
            <tr [class.bse-row-header]="isHeaderRow(row)">
              <td class="bse-rn">{{ row.rowNumber }}</td>
              @for (cell of row.cells; track $index) {
                <td>{{ cell }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
      <p class="bse-hint" i18n="@@accounting.bank-statement-entries.apercu.limite.aux.20.premieres.lignes.du.fichi.a1c9b240">Aperçu limité aux 20 premières lignes du fichier.</p>
    </div>
  `,
  styles: [
    `
      .bse-rows-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
      .bse-rows-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      .bse-rows-table th, .bse-rows-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eef2f6; white-space: nowrap; text-align: start; }
      .bse-rows-table th { background: #f8fafc; }
      .bse-rn { width: 3.5rem; text-align: center; color: #64748b; background: #f8fafc; }
      .bse-row-header td { background: #f1f5f9; font-weight: 700; color: #334155; }
      .bse-hint { color: #6c757d; font-size: 0.8rem; margin: 0.4rem 0 0; }
    `
  ]
})
export class BseTabularRowsPreviewComponent {
  readonly rows = input<BankStatementTabularRow[]>([]);
  readonly columns = input<BankStatementTabularColumn[]>([]);
  readonly headerRowIndex = input(0);

  isHeaderRow(row: BankStatementTabularRow): boolean {
    return row.rowNumber === this.headerRowIndex() + 1;
  }
}
