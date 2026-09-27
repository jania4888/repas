import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { SupplierInvoiceService, SupplierInvoiceListItem, isSupplierInvoicePaid, isSupplierInvoicePending } from '@core/services/supplier-invoice.service';
import { formatLocalDate } from '@core/utils/date.util';

export type ReportPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all';

export interface SupplierStats {
  supplierName: string;
  invoiceCount: number;
  totalAmount: number;
  currency: string;
}

export interface ExpenseChartData {
  label: string;
  labelShort: string;
  amount: number;
  invoiceCount: number;
  sortKey: number;
}

export interface StatusBreakdownItem {
  status: string;
  count: number;
  totalAmount: number;
  currency: string;
  percentage: number;
}

export interface MonthlySummaryItem {
  month: string;
  monthShort: string;
  year: number;
  amount: number;
  invoiceCount: number;
  paidCount: number;
}

export interface ExpenseCrossTabData {
  years: number[];
  monthLabels: string[];
  matrix: Map<number, number[]>;
  rowTotals: Map<number, number>;
  columnTotals: number[];
  grandTotal: number;
  currency: string;
}

export interface PurchasesReportsData {
  invoices: SupplierInvoiceListItem[];
  totalExpenses: string;
  totalInvoices: number;
  paidInvoices: number;
  paymentRate: string;
  amountToPay: string;
  topSuppliers: SupplierStats[];
  statusBreakdown: StatusBreakdownItem[];
  expenseChartData: ExpenseChartData[];
  monthlySummary: MonthlySummaryItem[];
  summaryText: string;
  currency: string;
}

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTH_SHORT_FR = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
];

const DAY_NAMES_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const CROSS_TAB_YEARS_WINDOW = 5;

@Injectable({ providedIn: 'root' })
export class PurchasesReportsService {
  private supplierInvoiceService = inject(SupplierInvoiceService);

  loadReportsData(period: ReportPeriod): Observable<PurchasesReportsData> {
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

    return this.supplierInvoiceService.getSupplierInvoices(params).pipe(
      catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any)),
      map(response => {
        const invoices = response.success ? response.data.items : [];
        return this.computeReportsData(invoices, period);
      })
    );
  }

  private computeReportsData(
    invoices: SupplierInvoiceListItem[],
    period: ReportPeriod
  ): PurchasesReportsData {
    const currency = invoices.length > 0 ? 'TND' : 'TND';

    const paidInvoices = invoices.filter(inv => isSupplierInvoicePaid(inv.status));
    const totalExpensesAmount = paidInvoices.reduce((sum, inv) => sum + inv.totalTTC, 0);
    const totalExpenses = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(totalExpensesAmount) + ' ' + currency;

    const totalInvoices = invoices.length;
    const paidCount = paidInvoices.length;
    const paymentRate = totalInvoices === 0
      ? '0%'
      : `${((paidCount / totalInvoices) * 100).toFixed(1)}%`;

    const pendingInvoices = invoices.filter(inv => isSupplierInvoicePending(inv.status));
    const amountToPayAmount = pendingInvoices.reduce((sum, inv) => sum + inv.totalTTC, 0);
    const amountToPay = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amountToPayAmount) + ' ' + currency;

    const topSuppliers = this.computeTopSuppliers(invoices);
    const statusBreakdown = this.computeStatusBreakdown(invoices);
    const expenseChartData = this.computeExpenseChartData(invoices, period);
    const monthlySummary = this.computeMonthlySummary(invoices);
    const summaryText = this.buildSummaryText(
      pendingInvoices.length,
      amountToPayAmount,
      currency
    );

    return {
      invoices,
      totalExpenses,
      totalInvoices,
      paidInvoices: paidCount,
      paymentRate,
      amountToPay,
      topSuppliers,
      statusBreakdown,
      expenseChartData,
      monthlySummary,
      summaryText,
      currency
    };
  }

  private computeTopSuppliers(invoices: SupplierInvoiceListItem[]): SupplierStats[] {
    const supplierMap = new Map<string, SupplierStats>();

    invoices.forEach(inv => {
      const existing = supplierMap.get(inv.supplierName);
      if (existing) {
        existing.invoiceCount++;
        existing.totalAmount += inv.totalTTC;
      } else {
        supplierMap.set(inv.supplierName, {
          supplierName: inv.supplierName,
          invoiceCount: 1,
          totalAmount: inv.totalTTC,
          currency: 'TND'
        });
      }
    });

    return Array.from(supplierMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }

  private computeStatusBreakdown(invoices: SupplierInvoiceListItem[]): StatusBreakdownItem[] {
    const statusMap = new Map<string, { count: number; totalAmount: number; currency: string }>();
    const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalTTC, 0);
    const currency = 'TND';

    invoices.forEach(inv => {
      const status = inv.statusDisplay || 'Inconnu';
      const existing = statusMap.get(status);
      if (existing) {
        existing.count++;
        existing.totalAmount += inv.totalTTC;
      } else {
        statusMap.set(status, {
          count: 1,
          totalAmount: inv.totalTTC,
          currency
        });
      }
    });

    return Array.from(statusMap.entries()).map(([status, data]) => ({
      status,
      count: data.count,
      totalAmount: data.totalAmount,
      currency: data.currency,
      percentage: totalAmount > 0 ? (data.totalAmount / totalAmount) * 100 : 0
    }));
  }

  private computeExpenseChartData(invoices: SupplierInvoiceListItem[], period: ReportPeriod): ExpenseChartData[] {
    const paidInvoices = invoices.filter(inv => isSupplierInvoicePaid(inv.status));
    const now = new Date();

    if (period === 'week') {
      const result: ExpenseChartData[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        const amount = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.invoiceDate);
            return invDate >= dayStart && invDate <= dayEnd;
          })
          .reduce((sum, inv) => sum + inv.totalTTC, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.invoiceDate);
          return invDate >= dayStart && invDate <= dayEnd;
        }).length;
        result.push({
          label: dayStart.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }),
          labelShort: DAY_NAMES_FR[dayStart.getDay() === 0 ? 6 : dayStart.getDay() - 1],
          amount,
          invoiceCount,
          sortKey: dayStart.getTime()
        });
      }
      return result;
    }

    if (period === 'month') {
      const result: ExpenseChartData[] = [];
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      const weeks = 5;
      const weekMs = 7 * 24 * 60 * 60 * 1000;

      for (let i = 0; i < weeks; i++) {
        const weekStart = new Date(startDate.getTime() + i * weekMs);
        const weekEnd = new Date(weekStart.getTime() + weekMs - 1);
        const amount = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.invoiceDate);
            return invDate >= weekStart && invDate <= weekEnd;
          })
          .reduce((sum, inv) => sum + inv.totalTTC, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.invoiceDate);
          return invDate >= weekStart && invDate <= weekEnd;
        }).length;
        result.push({
          label: $localize`:@@reports.purchases-reports.ts.sem.p.884bf8ca:Sem. ${i + 1}:p:`,
          labelShort: `S${i + 1}`,
          amount,
          invoiceCount,
          sortKey: i
        });
      }
      return result;
    }

    if (period === 'quarter' || period === 'year' || period === 'all') {
      const monthsCount = period === 'quarter' ? 3 : period === 'year' ? 12 : 12;
      const result: ExpenseChartData[] = [];

      for (let i = monthsCount - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

        const amount = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.invoiceDate);
            return invDate >= monthStart && invDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.totalTTC, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.invoiceDate);
          return invDate >= monthStart && invDate <= monthEnd;
        }).length;

        result.push({
          label: `${MONTH_NAMES_FR[date.getMonth()]} ${date.getFullYear()}`,
          labelShort: MONTH_SHORT_FR[date.getMonth()],
          amount,
          invoiceCount,
          sortKey: date.getFullYear() * 12 + date.getMonth()
        });
      }
      return result;
    }

    return [];
  }

  private computeMonthlySummary(invoices: SupplierInvoiceListItem[]): MonthlySummaryItem[] {
    const now = new Date();
    const result: MonthlySummaryItem[] = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

      const monthInvoices = invoices.filter(inv => {
        const invDate = new Date(inv.invoiceDate);
        return invDate >= monthStart && invDate <= monthEnd;
      });

      const amount = monthInvoices
        .filter(inv => isSupplierInvoicePaid(inv.status))
        .reduce((sum, inv) => sum + inv.totalTTC, 0);
      const paidCount = monthInvoices.filter(inv => isSupplierInvoicePaid(inv.status)).length;

      result.push({
        month: MONTH_NAMES_FR[date.getMonth()],
        monthShort: MONTH_SHORT_FR[date.getMonth()],
        year: date.getFullYear(),
        amount,
        invoiceCount: monthInvoices.length,
        paidCount
      });
    }
    return result;
  }

  private buildSummaryText(pendingCount: number, amountToPay: number, currency: string): string {
    if (pendingCount === 0) {
      return 'Toutes vos factures fournisseurs sont à jour.';
    }
    const amountStr = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amountToPay);
    return `Vous avez ${pendingCount} facture${pendingCount > 1 ? 's' : ''} fournisseur${pendingCount > 1 ? 's' : ''} à payer pour ${amountStr} ${currency}.`;
  }

  loadExpenseCrossTabData(): Observable<ExpenseCrossTabData | null> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fromYear = currentYear - (CROSS_TAB_YEARS_WINDOW - 1);
    const params = {
      pageSize: 1000,
      fromDate: `${fromYear}-01-01`,
      toDate: formatLocalDate(now)
    };
    return this.supplierInvoiceService.getSupplierInvoices(params).pipe(
      catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any)),
      map(response => {
        const invoices = response.success ? response.data.items : [];
        return this.computeExpenseCrossTabulation(invoices);
      })
    );
  }

  private computeExpenseCrossTabulation(invoices: SupplierInvoiceListItem[]): ExpenseCrossTabData | null {
    const paidInvoices = invoices.filter(inv => isSupplierInvoicePaid(inv.status));
    const currency = 'TND';

    const yearMonthMap = new Map<number, Map<number, number>>();

    paidInvoices.forEach(inv => {
      const d = new Date(inv.invoiceDate);
      const year = d.getFullYear();
      const month = d.getMonth();

      if (!yearMonthMap.has(year)) {
        yearMonthMap.set(year, new Map());
      }
      const monthMap = yearMonthMap.get(year)!;
      monthMap.set(month, (monthMap.get(month) ?? 0) + inv.totalTTC);
    });

    const allYears = Array.from(yearMonthMap.keys()).sort((a, b) => a - b);
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - (CROSS_TAB_YEARS_WINDOW - 1);
    const years = allYears.filter(y => y >= minYear && y <= currentYear);
    if (years.length === 0) {
      return null;
    }

    const matrix = new Map<number, number[]>();
    const rowTotals = new Map<number, number>();
    const columnTotals = new Array(12).fill(0);
    let grandTotal = 0;

    years.forEach(year => {
      const monthAmounts: number[] = [];
      let rowTotal = 0;
      for (let m = 0; m < 12; m++) {
        const amt = yearMonthMap.get(year)?.get(m) ?? 0;
        monthAmounts.push(amt);
        rowTotal += amt;
        columnTotals[m] += amt;
      }
      matrix.set(year, monthAmounts);
      rowTotals.set(year, rowTotal);
      grandTotal += rowTotal;
    });

    return {
      years,
      monthLabels: [...MONTH_SHORT_FR],
      matrix,
      rowTotals,
      columnTotals,
      grandTotal,
      currency
    };
  }

  getStatusColor(status: string): string {
    const colorMap: Record<string, string> = {
      'Payée': 'var(--color-success-500)',
      'En attente': 'var(--color-warning-500)',
      'Annulée': 'var(--color-error-500)'
    };
    return colorMap[status] || 'var(--color-neutral-400)';
  }
}
