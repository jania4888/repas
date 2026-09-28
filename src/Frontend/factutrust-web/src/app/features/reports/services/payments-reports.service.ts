import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { SupplierInvoiceService, SupplierInvoiceListItem, isSupplierInvoicePaid, isSupplierInvoicePending } from '@core/services/supplier-invoice.service';
import { formatLocalDate } from '@core/utils/date.util';
import { erpDateLocale } from '@core/i18n/erp-format';

export type ReportPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all';

export interface CashFlowChartData {
  label: string;
  labelShort: string;
  inflows: number;
  outflows: number;
  net: number;
  sortKey: number;
}

export interface PaymentsReportsData {
  totalInflows: string;
  totalOutflows: string;
  netCashFlow: string;
  netCashFlowAmount: number;
  pendingClientAmount: string;
  pendingSupplierAmount: string;
  pendingTotal: string;
  paidClientCount: number;
  paidSupplierCount: number;
  pendingClientCount: number;
  pendingSupplierCount: number;
  cashFlowChartData: CashFlowChartData[];
  summaryText: string;
  currency: string;
}

const MONTH_SHORT_FR = [
  $localize`:@@reports.payments-reports.ts.jan.efed3690:Jan`, $localize`:@@reports.payments-reports.ts.fev.7b8852ec:Fév`, $localize`:@@reports.payments-reports.ts.mar.c4ba0822:Mar`, $localize`:@@reports.payments-reports.ts.avr.d648a3b7:Avr`, $localize`:@@reports.payments-reports.ts.mai.afe526a6:Mai`, $localize`:@@reports.payments-reports.ts.juin.8b1e84b6:Juin`,
  $localize`:@@reports.payments-reports.ts.juil.190b5d60:Juil`, $localize`:@@reports.payments-reports.ts.aout.460b6696:Août`, $localize`:@@reports.payments-reports.ts.sep.fdd289e3:Sep`, $localize`:@@reports.payments-reports.ts.oct.51327aef:Oct`, $localize`:@@reports.payments-reports.ts.nov.bb9bfefd:Nov`, $localize`:@@reports.payments-reports.ts.dec.2bc2249a:Déc`
];

@Injectable({ providedIn: 'root' })
export class PaymentsReportsService {
  private invoiceService = inject(InvoiceService);
  private supplierInvoiceService = inject(SupplierInvoiceService);

  loadReportsData(period: ReportPeriod): Observable<PaymentsReportsData> {
    const params: { pageSize: number; fromDate?: string; toDate?: string } = { pageSize: 1000 };

    if (period !== 'all') {
      const daysMap: Record<Exclude<ReportPeriod, 'all'>, number> = {
        week: 7,
        month: 30,
        quarter: 90,
        year: 365
      };
      const days = daysMap[period];
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      params.fromDate = formatLocalDate(fromDate);
      params.toDate = formatLocalDate(new Date());
    }

    return forkJoin({
      clientInvoices: this.invoiceService.getInvoices(params).pipe(
        catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
      ),
      supplierInvoices: this.supplierInvoiceService.getSupplierInvoices(params).pipe(
        catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any))
      )
    }).pipe(
      map(({ clientInvoices, supplierInvoices }) => {
        const clientList: InvoiceListItem[] = clientInvoices.success ? clientInvoices.data.items : [];
        const supplierList: SupplierInvoiceListItem[] = supplierInvoices.success ? supplierInvoices.data.items : [];

        return this.computeReportsData(clientList, supplierList, period);
      })
    );
  }

  private isPaidInvoice(status: string): boolean {
    return status === 'Payée' || status === 'VALIDÉE';
  }

  private computeReportsData(
    clientInvoices: InvoiceListItem[],
    supplierInvoices: SupplierInvoiceListItem[],
    period: ReportPeriod
  ): PaymentsReportsData {
    const currency = 'TND';

    const paidClientInvoices = clientInvoices.filter(inv => this.isPaidInvoice(inv.status));
    const totalInflows = paidClientInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

    const paidSupplierInvoices = supplierInvoices.filter(inv => isSupplierInvoicePaid(inv.status));
    const totalOutflows = paidSupplierInvoices.reduce((sum, inv) => sum + inv.totalTTC, 0);

    const netCashFlow = totalInflows - totalOutflows;

    const pendingClientInvoices = clientInvoices.filter(inv => !this.isPaidInvoice(inv.status));
    const pendingSupplierInvoices = supplierInvoices.filter(inv => isSupplierInvoicePending(inv.status));

    const pendingClientAmount = pendingClientInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const pendingSupplierAmount = pendingSupplierInvoices.reduce((sum, inv) => sum + inv.totalTTC, 0);
    const pendingTotal = pendingClientAmount + pendingSupplierAmount;

    const fmt = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);

    const cashFlowChartData = this.computeCashFlowChart(paidClientInvoices, paidSupplierInvoices, period);

    const summaryParts: string[] = [];
    if (pendingTotal > 0) {
      summaryParts.push($localize`:@@reports.payments-reports.ts.vous.avez.p.facture.s.en.attente.pour.fm.059de647:Vous avez ${pendingClientInvoices.length + pendingSupplierInvoices.length}:p: facture(s) en attente pour ${fmt(pendingTotal)}:fmt: ${currency}:currency:.`);
    }
    if (netCashFlow >= 0 && totalInflows + totalOutflows > 0) {
      summaryParts.push($localize`:@@reports.payments-reports.ts.tresorerie.nette.positive.fmt.currency.s.fba60240:Trésorerie nette positive : ${fmt(netCashFlow)}:fmt: ${currency}:currency: sur la période.`);
    } else if (netCashFlow < 0) {
      summaryParts.push($localize`:@@reports.payments-reports.ts.tresorerie.nette.negative.fmt.currency.s.4a9bbad2:Trésorerie nette négative : ${fmt(netCashFlow)}:fmt: ${currency}:currency: sur la période.`);
    }
    const summaryText = summaryParts.length > 0 ? summaryParts.join(' ') : $localize`:@@reports.payments-reports.ts.aucun.flux.de.tresorerie.sur.cette.perio.34f0f37c:Aucun flux de trésorerie sur cette période.`;

    return {
      totalInflows: fmt(totalInflows) + ' ' + currency,
      totalOutflows: fmt(totalOutflows) + ' ' + currency,
      netCashFlow: fmt(netCashFlow) + ' ' + currency,
      netCashFlowAmount: netCashFlow,
      pendingClientAmount: fmt(pendingClientAmount) + ' ' + currency,
      pendingSupplierAmount: fmt(pendingSupplierAmount) + ' ' + currency,
      pendingTotal: fmt(pendingTotal) + ' ' + currency,
      paidClientCount: paidClientInvoices.length,
      paidSupplierCount: paidSupplierInvoices.length,
      pendingClientCount: pendingClientInvoices.length,
      pendingSupplierCount: pendingSupplierInvoices.length,
      cashFlowChartData,
      summaryText,
      currency
    };
  }

  private computeCashFlowChart(
    clientInvoices: InvoiceListItem[],
    supplierInvoices: SupplierInvoiceListItem[],
    period: ReportPeriod
  ): CashFlowChartData[] {
    const now = new Date();
    const result: CashFlowChartData[] = [];

    const monthsCount = period === 'week' ? 1 : period === 'month' ? 5 : period === 'quarter' ? 3 : period === 'year' ? 12 : 12;

    if (period === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

        const inflows = clientInvoices
          .filter(inv => {
            const invDate = new Date(inv.paidAt || inv.issueDate);
            return invDate >= dayStart && invDate <= dayEnd && this.isPaidInvoice(inv.status);
          })
          .reduce((sum, inv) => sum + inv.totalAmount, 0);

        const outflows = supplierInvoices
          .filter(inv => {
            const invDate = new Date(inv.paidAt || inv.invoiceDate);
            return invDate >= dayStart && invDate <= dayEnd && isSupplierInvoicePaid(inv.status);
          })
          .reduce((sum, inv) => sum + inv.totalTTC, 0);

        result.push({
          label: dayStart.toLocaleDateString(erpDateLocale('fr-FR'), { weekday: 'short', day: 'numeric', month: 'short' }),
          labelShort: dayStart.getDate().toString(),
          inflows,
          outflows,
          net: inflows - outflows,
          sortKey: dayStart.getTime()
        });
      }
      return result;
    }

    for (let i = monthsCount - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

      const inflows = clientInvoices
        .filter(inv => {
          const invDate = new Date(inv.paidAt || inv.issueDate);
          return invDate >= monthStart && invDate <= monthEnd && this.isPaidInvoice(inv.status);
        })
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      const outflows = supplierInvoices
        .filter(inv => {
          const invDate = new Date(inv.paidAt || inv.invoiceDate);
          return invDate >= monthStart && invDate <= monthEnd && isSupplierInvoicePaid(inv.status);
        })
        .reduce((sum, inv) => sum + inv.totalTTC, 0);

      result.push({
        label: `${MONTH_SHORT_FR[date.getMonth()]} ${date.getFullYear()}`,
        labelShort: MONTH_SHORT_FR[date.getMonth()],
        inflows,
        outflows,
        net: inflows - outflows,
        sortKey: date.getFullYear() * 12 + date.getMonth()
      });
    }

    return result;
  }
}
