/// <reference types="@angular/localize" />
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BankStatementTabularIssue, BankStatementTabularParsedLine } from '../bank-statement-import/bank-statement-import.models';

/**
 * Aperçu des lignes interprétées avec le mappage courant (étape 2, `tabularPreview.parsedLines`),
 * avec mise en évidence des lignes en erreur (`error`) et la liste des anomalies détectées (`issues`).
 */
@Component({
  selector: 'app-bse-tabular-parsed-lines',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="bse-parsed-wrap" data-testid="bse-tabular-parsed-lines">
      <table class="bse-parsed-table">
        <thead>
          <tr>
            <th class="bse-rn" i18n="@@accounting.bank-statement-entries.ligne.0e1cce93">Ligne</th>
            <th i18n="@@accounting.bank-statement-entries.date.d.operation.2.ea3a5c22">Date d'opération</th>
            <th i18n="@@accounting.bank-statement-entries.date.de.valeur.3f5a1b4a">Date de valeur</th>
            <th i18n="@@accounting.bank-statement-entries.libelle.2.b9eb9e4b">Libellé</th>
            <th class="bse-right" i18n="@@accounting.bank-statement-entries.montant.2.9e4e9f33">Montant</th>
            <th i18n="@@accounting.bank-statement-entries.anomalie.aa4bb1c9">Anomalie</th>
          </tr>
        </thead>
        <tbody>
          @for (line of parsedLines(); track line.rowNumber) {
            <tr [class.bse-line-error]="!!line.error">
              <td class="bse-rn">{{ line.rowNumber }}</td>
              <td>{{ line.transactionDate ?? '—' }}</td>
              <td>{{ line.valueDate ?? '—' }}</td>
              <td>{{ line.label ?? '—' }}</td>
              <td class="bse-right" [class.bse-debit]="line.isDebit === true" [class.bse-credit]="line.isDebit === false">
                {{ line.amount ?? '—' }}
              </td>
              <td>{{ line.error ?? '' }}</td>
            </tr>
          }
        </tbody>
      </table>

      @if (issues().length > 0) {
        <ul class="bse-issue-list" data-testid="bse-tabular-issues">
          @for (issue of issues(); track issue.code + issue.rowNumber) {
            <li [class.bse-issue-error]="issue.severity === 'Blocking'" [class.bse-issue-warning]="issue.severity === 'Warning'">
              {{ issue.code }} @if (issue.rowNumber != null) { — <span i18n="@@accounting.bank-statement-entries.ligne.2.6a26d3e2">ligne</span> {{ issue.rowNumber }} }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .bse-parsed-wrap { margin-top: 0.75rem; }
      .bse-parsed-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      .bse-parsed-table th, .bse-parsed-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eef2f6; text-align: start; }
      .bse-parsed-table th { background: #f8fafc; }
      .bse-rn { width: 3.5rem; text-align: center; color: #64748b; }
      .bse-right { text-align: end; }
      .bse-debit { color: #dc2626; }
      .bse-credit { color: #16a34a; }
      .bse-line-error td { background: #fef2f2; color: #b91c1c; }
      .bse-issue-list { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
      .bse-issue-list li { padding: 0.4rem 0.75rem; border-radius: 0 6px 6px 0; border-left: 3px solid #94a3b8; background: #f8fafc; font-size: 0.85rem; }
      .bse-issue-error { border-color: #dc2626; background: #fef2f2; color: #7f1d1d; }
      .bse-issue-warning { border-color: #d97706; background: #fffbeb; color: #78350f; }
    `
  ]
})
export class BseTabularParsedLinesComponent {
  readonly parsedLines = input<BankStatementTabularParsedLine[]>([]);
  readonly issues = input<BankStatementTabularIssue[]>([]);
}
