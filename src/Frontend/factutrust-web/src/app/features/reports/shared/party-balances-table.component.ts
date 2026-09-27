import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';

/**
 * Ligne normalisee de solde commercial (client ou fournisseur).
 *
 * Les tranches d'anciennete sont OPTIONNELLES : seul le rapport client les alimente
 * aujourd'hui. Le tableau generique les ignore ; le tableau age dedie s'appuie dessus.
 */
export interface PartyBalanceRow {
  partyId: string;
  partyName: string;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  currency: string;

  /** Tranches d'anciennete (lot 6). Somme = balance. Non fournies pour les fournisseurs. */
  notDue?: number;
  bucket0To30?: number;
  bucket31To60?: number;
  bucket61To90?: number;
  bucketOver90?: number;
}

@Component({
  selector: 'app-party-balances-table',
  standalone: true,
  imports: [CommonModule, TableModule, ButtonComponent],
  template: `
    @if (loading) {
      <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.shared.chargement.a209b664">Chargement...</span></div>
    } @else if (!rows.length) {
      <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p>{{ emptyMessage }}</p></div>
    } @else {
      <p-table
        [value]="rows"
        styleClass="p-datatable-sm reports-table party-balances-table"
        [attr.aria-label]="ariaLabel"
        sortField="balance"
        [sortOrder]="-1">
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="partyName">
              {{ partyLabel }}
              <p-sortIcon field="partyName"></p-sortIcon>
            </th>
            <th class="text-right" pSortableColumn="totalInvoiced">
              <ng-container i18n="@@reports.shared.total.facture.ea06ae9d"> Total facturé </ng-container>
              <p-sortIcon field="totalInvoiced"></p-sortIcon>
            </th>
            <th class="text-right" pSortableColumn="totalPaid">
              <ng-container i18n="@@reports.shared.total.paye.57d30be5"> Total payé </ng-container>
              <p-sortIcon field="totalPaid"></p-sortIcon>
            </th>
            <th class="text-right" pSortableColumn="balance">
              <ng-container i18n="@@reports.shared.solde.e5977cf9"> Solde </ng-container>
              <p-sortIcon field="balance"></p-sortIcon>
            </th>
            @if (showActions) {
              <th style="width: 6rem"></th>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.partyName }}</td>
            <td class="text-right amount">{{ row.totalInvoiced | number:'1.3-3' }} {{ row.currency }}</td>
            <td class="text-right amount">{{ row.totalPaid | number:'1.3-3' }} {{ row.currency }}</td>
            <td class="text-right amount" [class.balance-negative]="row.balance < 0">
              {{ row.balance | number:'1.3-3' }} {{ row.currency }}
            </td>
            @if (showActions) {
              <td class="actions-cell">
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  (click)="viewInvoices.emit(row)"
                  [ariaLabel]="loc_ui_tern_voir_les_factures_de_829a0f + row.partyName">
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-user"
                  [iconOnly]="true"
                  (click)="viewParty.emit(row)"
                  [ariaLabel]="loc_ui_tern_voir_la_fiche_8971db + row.partyName">
                </app-button>
              </td>
            }
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .loading-placeholder,
    .empty-placeholder {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
    }

    .text-right { text-align: right; }
    .amount {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
    .balance-negative { color: var(--color-error-600, #dc2626); }
    .actions-cell {
      display: flex;
      gap: var(--spacing-1);
      justify-content: flex-end;
    }

    :host ::ng-deep .party-balances-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
      }
      .p-datatable-tbody > tr > td {
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 1px solid var(--color-border-subtle);
        font-size: var(--font-size-sm);
        vertical-align: middle;
      }
      .p-datatable-tbody > tr:hover { background: var(--color-primary-50); }
    }
  `]
})
export class PartyBalancesTableComponent {
  readonly loc_ui_tern_voir_les_factures_de_829a0f = $localize`:@@ui.tern.voir.les.factures.de.829a0f:Voir les factures de `;
  readonly loc_ui_tern_voir_la_fiche_8971db = $localize`:@@ui.tern.voir.la.fiche.8971db:Voir la fiche `;
  @Input() rows: PartyBalanceRow[] = [];
  @Input() loading = false;
  @Input() partyLabel: 'Client' | 'Fournisseur' = 'Client';
  @Input() showActions = false;
  @Input() emptyMessage = $localize`:@@reports.party-balances-table.ts.aucun.solde.64a726da:Aucun solde`;
  @Input() ariaLabel = $localize`:@@reports.party-balances-table.ts.soldes.e1c7ce3a:Soldes`;

  @Output() viewParty = new EventEmitter<PartyBalanceRow>();
  @Output() viewInvoices = new EventEmitter<PartyBalanceRow>();
}
