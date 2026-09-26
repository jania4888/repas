import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { SalesRevenueReportRow } from '@core/services/reports-api.service';

@Component({
  selector: 'app-revenue-table',
  standalone: true,
  imports: [CommonModule, TableModule],
  template: `
    @if (loading) {
      <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i> Chargement...</div>
    } @else if (!rows.length) {
      <div class="empty-placeholder"><i class="pi pi-info-circle"></i> Aucune donnée pour cette période.</div>
    } @else {
      <div role="region" [attr.aria-label]="showClientColumn ? 'CA par produit et client' : 'CA'">
        <p-table [value]="rows" styleClass="p-datatable-sm reports-table">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ showClientColumn ? 'Produit' : 'Libellé' }}</th>
            @if (showClientColumn) { <th i18n="@@reports.sales-by-line.client.1bdd79b1">Client</th> }
            <th class="text-right" i18n="@@reports.sales-by-line.quantite.09a38fda">Quantité</th>
            <th class="text-right" i18n="@@reports.sales-by-line.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.groupKey }}</td>
            @if (showClientColumn) { <td>{{ row.groupKey2 ?? '-' }}</td> }
            <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
            <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency || 'TND' }}</td>
          </tr>
        </ng-template>
      </p-table>
      </div>
    }
  `,
  styles: [`
    .loading-placeholder, .empty-placeholder { padding: var(--spacing-8); text-align: center; color: var(--color-text-secondary); }
    .text-right { text-align: right; }
    .amount { font-family: 'JetBrains Mono', monospace; font-weight: var(--font-weight-semibold); }
    :host ::ng-deep .reports-table .p-datatable-thead > tr > th { background: var(--color-neutral-50); font-size: var(--font-size-sm); text-transform: uppercase; padding: var(--spacing-4) var(--spacing-3); }
    :host ::ng-deep .reports-table .p-datatable-tbody > tr > td { padding: var(--spacing-4) var(--spacing-3); font-size: var(--font-size-sm); vertical-align: middle; }
  `]
})
export class RevenueTableComponent {
  @Input() rows: SalesRevenueReportRow[] = [];
  @Input() loading = false;
  @Input() currency = 'TND';
  @Input() showClientColumn = false;
}
