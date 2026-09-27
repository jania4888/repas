import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { VatDeclarationDto } from '../services/accounting.service';
import { computeTotalCollected, computeTotalDeductible } from './vat-declaration.view-model';

interface VatDetailRow {
  designation: string;
  taxableBase: number | null;
  vatAmount: number | null;
  highlight?: boolean;
  bold?: boolean;
}

@Component({
  selector: 'app-vat-declaration-vat-detail-table',
  standalone: true,
  imports: [CommonModule, TableModule],
  template: `
    <div class="card vat-zone-card">
      <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.4.detail.de.la.tva.4d4901c6">4. Détail de la TVA</h3>
      <p-table [value]="detailRows" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@accounting.vat-declaration.designation.63a9062c">Désignation</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.base.imposable.e1baa7e1">Base imposable</th>
            <th class="text-right" i18n="@@accounting.vat-declaration.montant.tva.f0c1b7cc">Montant TVA</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr [class.vat-row-highlight]="row.highlight" [class.vat-row-bold]="row.bold">
            <td>{{ row.designation }}</td>
            <td class="text-right tabnum">{{ formatAmount(row.taxableBase) }}</td>
            <td class="text-right tabnum">{{ formatAmount(row.vatAmount) }}</td>
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
  `
})
export class VatDeclarationVatDetailTableComponent {
  @Input() declaration: VatDeclarationDto | null = null;

  get detailRows(): VatDetailRow[] {
    const d = this.declaration;
    if (!d) return [];

    const rateLabels: Record<number, string> = {
      19: 'Taux normal 19 %',
      13: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.taux.reduit.13.b48b26d9:Taux réduit 13 %`,
      7: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.taux.reduit.7.3e5d1b2b:Taux réduit 7 %`
    };

    const breakdown = d.collectedVatBreakdown ?? [];
    const hasBreakdown = breakdown.length > 0;

    const rows: VatDetailRow[] = hasBreakdown
      ? breakdown.map(b => ({
          designation: rateLabels[b.ratePercent] ?? $localize`:@@ui.tern.tva.ph.412aab:TVA ${b.ratePercent}:p0: %`,
          taxableBase: b.taxableBase,
          vatAmount: b.vatAmount
        }))
      : [
          { designation: 'Taux normal 19 %', taxableBase: null, vatAmount: d.collectedVat19 },
          { designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.taux.reduit.13.b48b26d9:Taux réduit 13 %`, taxableBase: null, vatAmount: d.collectedVat13 },
          { designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.taux.reduit.7.3e5d1b2b:Taux réduit 7 %`, taxableBase: null, vatAmount: d.collectedVat7 }
        ];

    const totalBase = hasBreakdown
      ? breakdown.reduce((s, b) => s + b.taxableBase, 0)
      : null;
    rows.push({
      designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.total.tva.collectee.bf91cd22:Total TVA collectée`,
      taxableBase: totalBase,
      vatAmount: computeTotalCollected(d),
      bold: true
    });

    rows.push({
      designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.tva.deductible.7d6d74f6:TVA déductible`,
      taxableBase: d.deductiblePurchasesTaxableBase ?? null,
      vatAmount: computeTotalDeductible(d)
    });

    rows.push({
      designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.tva.a.payer.2094edec:TVA à payer`,
      taxableBase: null,
      vatAmount: d.vatDue,
      highlight: true,
      bold: true
    });

    if (d.creditToCarry > 0) {
      rows.push({
        designation: $localize`:@@accounting.vat-declaration-vat-detail-table.ts.credit.a.reporter.631d54c5:Crédit à reporter`,
        taxableBase: null,
        vatAmount: d.creditToCarry
      });
    }

    return rows;
  }

  formatAmount(value: number | null | undefined): string {
    if (value == null) return '—';
    return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
}
