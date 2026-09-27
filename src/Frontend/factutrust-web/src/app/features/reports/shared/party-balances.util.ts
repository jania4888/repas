import { PartyBalanceRow } from './party-balances-table.component';
import { ClientBalanceReportRow, SupplierBalanceReportRow } from '@core/services/reports-api.service';
import { TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';

export function mapClientBalanceRows(rows: ClientBalanceReportRow[]): PartyBalanceRow[] {
  return rows.map((r) => {
    const base: PartyBalanceRow = {
      partyId: r.clientId,
      partyName: r.clientName,
      totalInvoiced: r.totalInvoiced,
      totalPaid: r.totalPaid,
      balance: r.balance,
      currency: r.currency
    };
    // Tranches d'ancienneté (lot 6). Ajoutées uniquement quand le backend les fournit :
    // un backend ancien renverrait tout à undefined et le tableau âge ne montrerait rien.
    if (r.notDue !== undefined) base.notDue = r.notDue;
    if (r.bucket0To30 !== undefined) base.bucket0To30 = r.bucket0To30;
    if (r.bucket31To60 !== undefined) base.bucket31To60 = r.bucket31To60;
    if (r.bucket61To90 !== undefined) base.bucket61To90 = r.bucket61To90;
    if (r.bucketOver90 !== undefined) base.bucketOver90 = r.bucketOver90;
    return base;
  });
}

export function mapSupplierBalanceRows(rows: SupplierBalanceReportRow[]): PartyBalanceRow[] {
  return rows.map((r) => ({
    partyId: r.supplierId,
    partyName: r.supplierName,
    totalInvoiced: r.totalInvoiced,
    totalPaid: r.totalPaid,
    balance: r.balance,
    currency: r.currency
  }));
}

export function filterPartyBalanceRows(
  rows: PartyBalanceRow[],
  search: string,
  hideZeroBalances: boolean
): PartyBalanceRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (hideZeroBalances && r.balance === 0) {
      return false;
    }
    if (q && !r.partyName.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function buildPartyBalanceSummaryMetrics(rows: PartyBalanceRow[]): TotalMetric[] {
  const currency = rows[0]?.currency ?? 'TND';
  const totalInvoiced = rows.reduce((sum, r) => sum + r.totalInvoiced, 0);
  const totalPaid = rows.reduce((sum, r) => sum + r.totalPaid, 0);
  const totalBalance = rows.reduce((sum, r) => sum + r.balance, 0);
  const positiveCount = rows.filter((r) => r.balance > 0).length;

  const metrics: TotalMetric[] = [
    { label: $localize`:@@reports.party-balances.ts.tiers.435080ba:Tiers`, value: rows.length, format: 'number', icon: 'pi-users', tone: 'primary' },
    { label: $localize`:@@reports.party-balances.ts.total.facture.ea06ae9d:Total facturé`, value: totalInvoiced, format: 'currency', currency, icon: 'pi-file', tone: 'cyan' },
    { label: $localize`:@@reports.party-balances.ts.total.paye.57d30be5:Total payé`, value: totalPaid, format: 'currency', currency, icon: 'pi-check', tone: 'emerald' },
    { label: $localize`:@@reports.party-balances.ts.solde.total.e8f8a268:Solde total`, value: totalBalance, format: 'currency', currency, icon: 'pi-wallet', tone: 'amber' },
    { label: $localize`:@@reports.party-balances.ts.soldes.0.2fef81aa:Soldes > 0`, value: positiveCount, format: 'number', icon: 'pi-exclamation-circle', tone: 'rose' }
  ];

  // Echu > 90 j : la valeur qui appelle une action ferme, mise en avant si le rapport
  // porte les tranches. Absent quand le backend ne les renvoie pas encore.
  const hasAging = rows.some((r) => r.bucketOver90 !== undefined);
  if (hasAging) {
    const over90 = rows.reduce((sum, r) => sum + (r.bucketOver90 ?? 0), 0);
    metrics.push({
      label: $localize`:@@reports.party-balances.ts.echu.90.j.f355b0aa:Échu > 90 j`,
      value: over90,
      format: 'currency',
      currency,
      icon: 'pi-clock',
      tone: over90 > 0 ? 'rose' : 'emerald',
      hint: $localize`:@@reports.party-balances.ts.a.relancer.en.priorite.44d22202:À relancer en priorité`
    });
  }

  return metrics;
}

export function exportPartyBalancesCsv(
  rows: PartyBalanceRow[],
  partyLabel: string,
  filenamePrefix: string
): void {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const hasAging = rows.some((r) => r.bucketOver90 !== undefined);

  const header = [partyLabel, 'Total facturé', 'Total payé', 'Solde', 'Devise'];
  if (hasAging) header.push('Non échu', '1-30 j', '31-60 j', '61-90 j', '> 90 j');

  const lines = [
    header.map(escape).join(';'),
    ...rows.map((r) => {
      const base = [
        r.partyName,
        r.totalInvoiced.toFixed(3),
        r.totalPaid.toFixed(3),
        r.balance.toFixed(3),
        r.currency
      ];
      if (hasAging) {
        base.push(
          (r.notDue ?? 0).toFixed(3),
          (r.bucket0To30 ?? 0).toFixed(3),
          (r.bucket31To60 ?? 0).toFixed(3),
          (r.bucket61To90 ?? 0).toFixed(3),
          (r.bucketOver90 ?? 0).toFixed(3)
        );
      }
      return base.map(escape).join(';');
    })
  ];
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  link.download = `${filenamePrefix}-${y}-${m}-${d}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
