import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { CommercialProfitReportRow } from '@core/services/reports-api.service';

@Component({
  selector: 'app-profit-table',
  standalone: true,
  imports: [CommonModule, TableModule],
  template: `
    @if (loading) {
      <div class="loading-placeholder" i18n="@@reports.profit.chargement.4bf1fb6b"><i class="pi pi-spin pi-spinner"></i> Chargement...</div>
    } @else if (!rows.length) {
      <div class="empty-placeholder" i18n="@@reports.profit.aucune.donnee.pour.cette.periode.174260ce"><i class="pi pi-info-circle"></i> Aucune donnée pour cette période.</div>
    } @else {
      <div role="region" [attr.aria-label]="mode === 'line' ? loc_ui_tern_benefice_par_ligne_fbe640 : mode === 'piece' ? loc_ui_tern_benefice_par_piece_929041 : mode === 'product' ? loc_ui_tern_benefice_par_produit_2e34eb : loc_ui_tern_benefice_mensuel_65f82a">
        <p-table [value]="rows" styleClass="p-datatable-sm reports-table">
        <ng-template pTemplate="header">
          <tr>
            @if (mode === 'line') {
              <th i18n="@@reports.profit.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.profit.facture.3953b9f5">Facture</th>
              <th i18n="@@reports.profit.date.eb9a4bc1">Date</th>
            }
            @if (mode === 'piece') {
              <th i18n="@@reports.profit.facture.3953b9f5">Facture</th>
              <th i18n="@@reports.profit.date.eb9a4bc1">Date</th>
            }
            @if (mode === 'product') {
              <th i18n="@@reports.profit.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.profit.code.adac6937">Code</th>
            }
            @if (mode === 'month') {
              <th i18n="@@reports.profit.periode.de2110b7">Période</th>
            }
            <th class="text-right" i18n="@@reports.profit.quantite.09a38fda">Quantité</th>
            <th class="text-right" i18n="@@reports.profit.ca.net.ht.6fe960cc">CA net HT</th>
            <th class="text-right" i18n="@@reports.profit.cout.4a4aa395">Coût</th>
            <th class="text-right" i18n="@@reports.profit.benefice.111823af">Bénéfice</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            @if (mode === 'line') {
              <td>{{ row.productName ?? '-' }}</td>
              <td>{{ row.invoiceNumber ?? '-' }}</td>
              <td>{{ row.issueDate | date:'dd/MM/yyyy' }}</td>
            }
            @if (mode === 'piece') {
              <td>{{ row.invoiceNumber ?? '-' }}</td>
              <td>{{ row.issueDate | date:'dd/MM/yyyy' }}</td>
            }
            @if (mode === 'product') {
              <td>{{ row.productName ?? '-' }}</td>
              <td>{{ row.productCode ?? '-' }}</td>
            }
            @if (mode === 'month') {
              <td>{{ row.period ?? '-' }}</td>
            }
            <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
            <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
            <td class="text-right amount">{{ row.cost | number:'1.3-3' }} {{ row.currency }}</td>
            <td class="text-right amount" [class.profit-negative]="row.profit < 0">{{ row.profit | number:'1.3-3' }} {{ row.currency }}</td>
          </tr>
        </ng-template>
      </p-table>
      </div>
    }
  `,
  styles: [`
    .loading-placeholder, .empty-placeholder { padding: var(--spacing-8); text-align: center; color: var(--color-text-secondary); }
    .text-right { text-align: end; }
    .amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); }
    .profit-negative { color: var(--color-error-600, #dc2626); }
    :host ::ng-deep .reports-table .p-datatable-thead > tr > th { background: var(--color-neutral-50); font-size: var(--font-size-sm); text-transform: uppercase; padding: var(--spacing-4) var(--spacing-3); }
    :host ::ng-deep .reports-table .p-datatable-tbody > tr > td { padding: var(--spacing-4) var(--spacing-3); font-size: var(--font-size-sm); vertical-align: middle; }
  `]
})
export class ProfitTableComponent {
  readonly loc_ui_tern_benefice_par_ligne_fbe640 = $localize`:@@ui.tern.benefice.par.ligne.fbe640:Bénéfice par ligne`;
  readonly loc_ui_tern_benefice_par_piece_929041 = $localize`:@@ui.tern.benefice.par.piece.929041:Bénéfice par pièce`;
  readonly loc_ui_tern_benefice_par_produit_2e34eb = $localize`:@@ui.tern.benefice.par.produit.2e34eb:Bénéfice par produit`;
  readonly loc_ui_tern_benefice_mensuel_65f82a = $localize`:@@ui.tern.benefice.mensuel.65f82a:Bénéfice mensuel`;
  @Input() rows: CommercialProfitReportRow[] = [];
  @Input() loading = false;
  @Input() mode: 'piece' | 'line' | 'product' | 'month' = 'product';
}
