import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { PartyBalanceRow } from './party-balances-table.component';

/**
 * Balance agee commerciale (lot 6) : ventilation du solde par anciennete d'echeance.
 *
 * Complement du tableau de soldes generique, PAS un remplacement : les deux affichent des
 * choses differentes — le premier resume, celui-ci decompose. Volontairement lisible sur
 * mobile : le montant total > 90 j est mis en avant par une couleur, c'est lui qui appelle
 * une action.
 *
 * Pas d'affichage si aucune ligne n'a de tranche : un rapport ancien qui ne les porte pas
 * doit se comporter comme avant, sans zone vide.
 */
@Component({
  selector: 'app-aging-table',
  standalone: true,
  imports: [CommonModule, TableModule, TagModule],
  template: `
    @if (visibleRows.length > 0) {
      <p-table
        [value]="visibleRows"
        [rowHover]="true"
        styleClass="p-datatable-sm reports-table aging-table"
        [attr.aria-label]="'Balance agee ' + partyLabel">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ partyLabel }}</th>
            <th class="text-right" i18n="@@reports.shared.solde.e5977cf9">Solde</th>
            <th class="text-right" i18n="@@reports.shared.non.echu.cb5c1717">Non échu</th>
            <th class="text-right" i18n="@@reports.shared.1.30.j.f6e60eeb">1-30 j</th>
            <th class="text-right" i18n="@@reports.shared.31.60.j.8e913c3e">31-60 j</th>
            <th class="text-right" i18n="@@reports.shared.61.90.j.a4452d3c">61-90 j</th>
            <th class="text-right over-90" i18n="@@reports.shared.gt.90.j.4112cb98">&gt; 90 j</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.partyName }}</td>
            <td class="text-right amount">
              <strong>{{ row.balance | number: '1.3-3' }}</strong> {{ row.currency }}
            </td>
            <td class="text-right amount">{{ (row.notDue ?? 0) | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ (row.bucket0To30 ?? 0) | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ (row.bucket31To60 ?? 0) | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ (row.bucket61To90 ?? 0) | number: '1.3-3' }}</td>
            <td class="text-right amount over-90" [class.has-value]="(row.bucketOver90 ?? 0) > 0">
              {{ (row.bucketOver90 ?? 0) | number: '1.3-3' }}
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="footer">
          <tr class="totals-row">
            <td i18n="@@reports.shared.total.b25928c6">Total</td>
            <td class="text-right amount"><strong>{{ totals.balance | number: '1.3-3' }}</strong></td>
            <td class="text-right amount">{{ totals.notDue | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ totals.bucket0To30 | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ totals.bucket31To60 | number: '1.3-3' }}</td>
            <td class="text-right amount">{{ totals.bucket61To90 | number: '1.3-3' }}</td>
            <td class="text-right amount over-90" [class.has-value]="totals.bucketOver90 > 0">
              <strong>{{ totals.bucketOver90 | number: '1.3-3' }}</strong>
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .amount { font-variant-numeric: tabular-nums; }
    .over-90.has-value { color: var(--color-error-600, #dc2626); font-weight: 500; }
    .totals-row td { background: var(--color-background-subtle, #f9fafb); }
    :host ::ng-deep .aging-table th.over-90 { color: var(--color-error-700, #b91c1c); }
  `]
})
export class AgingTableComponent {
  @Input() rows: PartyBalanceRow[] = [];
  @Input() partyLabel = 'Client';

  /** Balance agee non disponible sur toutes les lignes = on n'affiche rien. */
  get visibleRows(): PartyBalanceRow[] {
    return this.rows.some((r) => r.bucketOver90 !== undefined) ? this.rows : [];
  }

  get totals() {
    return this.rows.reduce(
      (acc, r) => ({
        balance: acc.balance + r.balance,
        notDue: acc.notDue + (r.notDue ?? 0),
        bucket0To30: acc.bucket0To30 + (r.bucket0To30 ?? 0),
        bucket31To60: acc.bucket31To60 + (r.bucket31To60 ?? 0),
        bucket61To90: acc.bucket61To90 + (r.bucket61To90 ?? 0),
        bucketOver90: acc.bucketOver90 + (r.bucketOver90 ?? 0)
      }),
      { balance: 0, notDue: 0, bucket0To30: 0, bucket31To60: 0, bucket61To90: 0, bucketOver90: 0 }
    );
  }
}
