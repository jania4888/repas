import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { QuoteService, QuoteListItem } from '@core/services/quote.service';
import { formatLocalDate } from '@core/utils/date.util';
import { erpPlural, erpPluralLocale } from '@core/i18n/erp-plural';

export type ReportPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all';

export interface ClientStats {
  clientName: string;
  invoiceCount: number;
  totalAmount: number;
  currency: string;
}

export interface RevenueChartData {
  label: string;
  labelShort: string;
  revenue: number;
  invoiceCount: number;
  /** For week: day index, for month: week index, for quarter/year/all: month index */
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
  revenue: number;
  invoiceCount: number;
  paidCount: number;
}

export interface RevenueCrossTabData {
  years: number[];
  monthLabels: string[];
  matrix: Map<number, number[]>;
  rowTotals: Map<number, number>;
  columnTotals: number[];
  grandTotal: number;
  currency: string;
}

export interface CrossTabInsight {
  type: 'period' | 'best_month' | 'worst_month' | 'yoy_growth' | 'seasonality';
  label: string;
  value: string;
  detail?: string;
}

export interface SalesReportsData {
  invoices: InvoiceListItem[];
  totalRevenue: string;
  totalInvoices: number;
  paidInvoices: number;
  paymentRate: string;
  amountToCollect: string;
  overdueInvoicesCount: number;
  overdueInvoices: InvoiceListItem[];
  topClients: ClientStats[];
  statusBreakdown: StatusBreakdownItem[];
  revenueChartData: RevenueChartData[];
  monthlySummary: MonthlySummaryItem[];
  quoteConversionRate: string;
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
export class SalesReportsService {
  private invoiceService = inject(InvoiceService);
  private quoteService = inject(QuoteService);

  loadReportsData(period: ReportPeriod): Observable<SalesReportsData> {
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
      invoices: this.invoiceService.getInvoices(params).pipe(
        catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
      ),
      quotes: this.quoteService.getQuotes({ ...params, pageSize: 500 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as QuoteListItem[] } } as any))
      )
    }).pipe(
      map(({ invoices, quotes }) => {
        const invoiceList: InvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const quoteList: QuoteListItem[] = quotes.success ? quotes.data.items : [];

        return this.computeReportsData(invoiceList, quoteList, period);
      })
    );
  }

  private isPaidStatus(status: string): boolean {
    return status === 'Payée' || status === 'VALIDÉE';
  }

  private isPendingStatus(status: string): boolean {
    const s = status?.toLowerCase() || '';
    return s.includes('attente') || s.includes('pending') ||
           s.includes('envoyé') || s.includes('sent');
  }

  private isOverdueStatus(status: string): boolean {
    const s = status?.toLowerCase() || '';
    return s.includes('retard') || s.includes('overdue');
  }

  private computeReportsData(
    invoices: InvoiceListItem[],
    quotes: QuoteListItem[],
    period: ReportPeriod
  ): SalesReportsData {
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

    const paidInvoices = invoices.filter(inv => this.isPaidStatus(inv.status));
    const totalRevenueAmount = paidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const totalRevenue = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(totalRevenueAmount) + ' ' + currency;

    const totalInvoices = invoices.length;
    const paidCount = paidInvoices.length;
    const paymentRate = totalInvoices === 0
      ? '0%'
      : `${((paidCount / totalInvoices) * 100).toFixed(1)}%`;

    const pendingInvoices = invoices.filter(inv => this.isPendingStatus(inv.status));
    const amountToCollectAmount = pendingInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const amountToCollect = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amountToCollectAmount) + ' ' + currency;

    const overdueInvoices = invoices.filter(inv => inv.isOverdue || this.isOverdueStatus(inv.status));
    const overdueInvoicesCount = overdueInvoices.length;

    const topClients = this.computeTopClients(invoices);
    const statusBreakdown = this.computeStatusBreakdown(invoices);
    const revenueChartData = this.computeRevenueChartData(invoices, period);
    const monthlySummary = this.computeMonthlySummary(invoices);
    const quoteConversionRate = this.computeQuoteConversionRate(quotes);
    const summaryText = this.buildSummaryText(
      pendingInvoices.length,
      amountToCollectAmount,
      overdueInvoicesCount,
      currency
    );

    return {
      invoices,
      totalRevenue,
      totalInvoices,
      paidInvoices: paidCount,
      paymentRate,
      amountToCollect,
      overdueInvoicesCount,
      overdueInvoices: overdueInvoices.slice(0, 5),
      topClients,
      statusBreakdown,
      revenueChartData,
      monthlySummary,
      quoteConversionRate,
      summaryText,
      currency
    };
  }

  private computeTopClients(invoices: InvoiceListItem[]): ClientStats[] {
    const clientMap = new Map<string, ClientStats>();

    invoices.forEach(inv => {
      const existing = clientMap.get(inv.clientName);
      if (existing) {
        existing.invoiceCount++;
        existing.totalAmount += inv.totalAmount;
      } else {
        clientMap.set(inv.clientName, {
          clientName: inv.clientName,
          invoiceCount: 1,
          totalAmount: inv.totalAmount,
          currency: inv.currency
        });
      }
    });

    return Array.from(clientMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }

  private computeStatusBreakdown(invoices: InvoiceListItem[]): StatusBreakdownItem[] {
    const statusMap = new Map<string, { count: number; totalAmount: number; currency: string }>();
    const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

    invoices.forEach(inv => {
      const existing = statusMap.get(inv.status);
      if (existing) {
        existing.count++;
        existing.totalAmount += inv.totalAmount;
      } else {
        statusMap.set(inv.status, {
          count: 1,
          totalAmount: inv.totalAmount,
          currency: inv.currency
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

  private computeRevenueChartData(invoices: InvoiceListItem[], period: ReportPeriod): RevenueChartData[] {
    const paidInvoices = invoices.filter(inv => this.isPaidStatus(inv.status));
    const now = new Date();

    if (period === 'week') {
      const result: RevenueChartData[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        const revenue = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.issueDate);
            return invDate >= dayStart && invDate <= dayEnd;
          })
          .reduce((sum, inv) => sum + inv.totalAmount, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.issueDate);
          return invDate >= dayStart && invDate <= dayEnd;
        }).length;
        result.push({
          label: dayStart.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }),
          labelShort: DAY_NAMES_FR[dayStart.getDay() === 0 ? 6 : dayStart.getDay() - 1],
          revenue,
          invoiceCount,
          sortKey: dayStart.getTime()
        });
      }
      return result;
    }

    if (period === 'month') {
      const result: RevenueChartData[] = [];
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      const weeks = 5;
      const weekMs = 7 * 24 * 60 * 60 * 1000;

      for (let i = 0; i < weeks; i++) {
        const weekStart = new Date(startDate.getTime() + i * weekMs);
        const weekEnd = new Date(weekStart.getTime() + weekMs - 1);
        const revenue = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.issueDate);
            return invDate >= weekStart && invDate <= weekEnd;
          })
          .reduce((sum, inv) => sum + inv.totalAmount, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.issueDate);
          return invDate >= weekStart && invDate <= weekEnd;
        }).length;
        const d1 = weekStart.getDate();
        const d2 = weekEnd.getDate();
        const monthShort = weekStart.toLocaleDateString('fr-FR', { month: 'short' });
        const labelShort = `${d1}-${d2} ${monthShort}`;
        result.push({
          label: $localize`:@@reports.sales-reports.ts.semaine.du.tolocaledatestring.au.tolocal.f7dcfdfa:Semaine du ${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}:toLocaleDateString: au ${weekEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}:toLocaleDateString1:`,
          labelShort,
          revenue,
          invoiceCount,
          sortKey: i
        });
      }
      return result;
    }

    if (period === 'quarter' || period === 'year' || period === 'all') {
      const monthsCount = period === 'quarter' ? 3 : period === 'year' ? 12 : 12;
      const result: RevenueChartData[] = [];

      for (let i = monthsCount - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

        const revenue = paidInvoices
          .filter(inv => {
            const invDate = new Date(inv.issueDate);
            return invDate >= monthStart && invDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.totalAmount, 0);
        const invoiceCount = paidInvoices.filter(inv => {
          const invDate = new Date(inv.issueDate);
          return invDate >= monthStart && invDate <= monthEnd;
        }).length;

        result.push({
          label: `${MONTH_NAMES_FR[date.getMonth()]} ${date.getFullYear()}`,
          labelShort: MONTH_SHORT_FR[date.getMonth()],
          revenue,
          invoiceCount,
          sortKey: date.getFullYear() * 12 + date.getMonth()
        });
      }
      return result;
    }

    return [];
  }

  private computeMonthlySummary(invoices: InvoiceListItem[]): MonthlySummaryItem[] {
    const now = new Date();
    const result: MonthlySummaryItem[] = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

      const monthInvoices = invoices.filter(inv => {
        const invDate = new Date(inv.issueDate);
        return invDate >= monthStart && invDate <= monthEnd;
      });

      const revenue = monthInvoices
        .filter(inv => this.isPaidStatus(inv.status))
        .reduce((sum, inv) => sum + inv.totalAmount, 0);
      const paidCount = monthInvoices.filter(inv => this.isPaidStatus(inv.status)).length;

      result.push({
        month: MONTH_NAMES_FR[date.getMonth()],
        monthShort: MONTH_SHORT_FR[date.getMonth()],
        year: date.getFullYear(),
        revenue,
        invoiceCount: monthInvoices.length,
        paidCount
      });
    }
    return result;
  }

  private computeQuoteConversionRate(quotes: QuoteListItem[]): string {
    if (quotes.length === 0) return '0%';
    const converted = quotes.filter(q => q.isConverted).length;
    return `${((converted / quotes.length) * 100).toFixed(1)}%`;
  }

  private buildSummaryText(
    pendingCount: number,
    amountToCollect: number,
    overdueCount: number,
    currency: string
  ): string {
    const parts: string[] = [];
    if (pendingCount > 0) {
      const amountStr = new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amountToCollect);
      parts.push(erpPlural(pendingCount, {
        zero: $localize`:@@reports.sales-reports.factures.a.encaisser.zero:Vous avez ${pendingCount}:pendingCount: factures à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`,
        one: $localize`:@@reports.sales-reports.factures.a.encaisser.one:Vous avez ${pendingCount}:pendingCount: facture à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`,
        two: $localize`:@@reports.sales-reports.factures.a.encaisser.two:Vous avez ${pendingCount}:pendingCount: factures à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`,
        few: $localize`:@@reports.sales-reports.factures.a.encaisser.few:Vous avez ${pendingCount}:pendingCount: factures à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`,
        many: $localize`:@@reports.sales-reports.factures.a.encaisser.many:Vous avez ${pendingCount}:pendingCount: factures à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`,
        other: $localize`:@@reports.sales-reports.factures.a.encaisser.other:Vous avez ${pendingCount}:pendingCount: factures à encaisser pour ${amountStr}:amountStr: ${currency}:currency:.`
      }, erpPluralLocale()));
    }
    if (overdueCount > 0) {
      parts.push(erpPlural(overdueCount, {
        zero: $localize`:@@reports.sales-reports.factures.en.retard.zero:${overdueCount}:overdueCount: factures sont en retard.`,
        one: $localize`:@@reports.sales-reports.factures.en.retard.one:${overdueCount}:overdueCount: facture est en retard.`,
        two: $localize`:@@reports.sales-reports.factures.en.retard.two:${overdueCount}:overdueCount: factures sont en retard.`,
        few: $localize`:@@reports.sales-reports.factures.en.retard.few:${overdueCount}:overdueCount: factures sont en retard.`,
        many: $localize`:@@reports.sales-reports.factures.en.retard.many:${overdueCount}:overdueCount: factures sont en retard.`,
        other: $localize`:@@reports.sales-reports.factures.en.retard.other:${overdueCount}:overdueCount: factures sont en retard.`
      }, erpPluralLocale()));
    }
    if (parts.length === 0) {
      return $localize`:@@reports.sales-reports.ts.toutes.vos.factures.sont.a.jour.a34df1da:Toutes vos factures sont à jour.`;
    }
    return parts.join(' ');
  }

  loadRevenueCrossTabData(): Observable<RevenueCrossTabData | null> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fromYear = currentYear - (CROSS_TAB_YEARS_WINDOW - 1);
    const params = {
      pageSize: 1000,
      fromDate: `${fromYear}-01-01`,
      toDate: formatLocalDate(now)
    };
    return this.invoiceService.getInvoices(params).pipe(
      catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any)),
      map(response => {
        const invoices = response.success ? response.data.items : [];
        return this.computeRevenueCrossTabulation(invoices);
      })
    );
  }

  computeCrossTabInsights(crossTab: RevenueCrossTabData): CrossTabInsight[] {
    const insights: CrossTabInsight[] = [];
    const fmt = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);

    const periodValue = crossTab.years.length === 1
      ? crossTab.years[0].toString()
      : `${crossTab.years[0]} - ${crossTab.years[crossTab.years.length - 1]}`;
    insights.push({
      type: 'period',
      label: $localize`:@@reports.sales-reports.ts.periode.couverte.e1083b69:Période couverte`,
      value: periodValue,
      detail: $localize`:@@reports.sales-reports.ts.cross.tab.years.window.dernieres.annees.a0329585:${CROSS_TAB_YEARS_WINDOW}:CROSS_TAB_YEARS_WINDOW: dernières années`
    });

    const monthsWithData = crossTab.columnTotals
      .map((v, i) => ({ month: i, total: v }))
      .filter(x => x.total > 0);
    if (monthsWithData.length > 0) {
      const best = monthsWithData.reduce((a, b) => (a.total >= b.total ? a : b));
      const worst = monthsWithData.reduce((a, b) => (a.total <= b.total ? a : b));
      insights.push({
        type: 'best_month',
        label: $localize`:@@reports.sales-reports.ts.meilleur.mois.2a7d82b0:Meilleur mois`,
        value: crossTab.monthLabels[best.month],
        detail: $localize`:@@reports.sales-reports.ts.fmt.currency.total.cumule.b3eb82a2:${fmt(best.total)}:fmt: ${crossTab.currency}:currency: (total cumulé)`
      });
      insights.push({
        type: 'worst_month',
        label: $localize`:@@reports.sales-reports.ts.mois.le.plus.faible.ca012fe9:Mois le plus faible`,
        value: crossTab.monthLabels[worst.month],
        detail: $localize`:@@reports.sales-reports.ts.fmt.currency.total.cumule.b3eb82a2:${fmt(worst.total)}:fmt: ${crossTab.currency}:currency: (total cumulé)`
      });
    }

    if (crossTab.years.length >= 2) {
      const lastYear = crossTab.years[crossTab.years.length - 1];
      const prevYear = crossTab.years[crossTab.years.length - 2];
      const lastTotal = crossTab.rowTotals.get(lastYear) ?? 0;
      const prevTotal = crossTab.rowTotals.get(prevYear) ?? 0;
      const growth = prevTotal > 0
        ? ((lastTotal - prevTotal) / prevTotal) * 100
        : lastTotal > 0 ? 100 : 0;
      const sign = growth >= 0 ? '+' : '';
      insights.push({
        type: 'yoy_growth',
        label: $localize`:@@reports.sales-reports.ts.evolution.prevyear.lastyear.af131747:Évolution ${prevYear}:prevYear: → ${lastYear}:lastYear:`,
        value: `${sign}${growth.toFixed(1)}%`,
        detail: $localize`:@@reports.sales-reports.ts.fmt.vs.fmt1.currency.f10e4d91:${fmt(lastTotal)}:fmt: vs ${fmt(prevTotal)}:fmt1: ${crossTab.currency}:currency:`
      });
    }

    if (crossTab.grandTotal > 0 && monthsWithData.length > 0) {
      const topMonths = crossTab.columnTotals
        .map((v, i) => ({ month: i, total: v, pct: (v / crossTab.grandTotal) * 100 }))
        .filter(x => x.total > 0)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);
      const seasonalityText = topMonths
        .map(m => `${crossTab.monthLabels[m.month]} (${m.pct.toFixed(1)}%)`)
        .join(', ');
      insights.push({
        type: 'seasonality',
        label: $localize`:@@reports.sales-reports.ts.saisonnalite.top.3.mois.a6c7b50a:Saisonnalité (top 3 mois)`,
        value: seasonalityText,
        detail: $localize`:@@reports.sales-reports.ts.part.du.ca.par.mois.sur.les.cross.tab.ye.bb7791cd:Part du CA par mois sur les ${CROSS_TAB_YEARS_WINDOW}:CROSS_TAB_YEARS_WINDOW: dernières années`
      });
    }

    return insights;
  }

  private computeRevenueCrossTabulation(invoices: InvoiceListItem[]): RevenueCrossTabData | null {
    const paidInvoices = invoices.filter(inv => this.isPaidStatus(inv.status));
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

    const yearMonthMap = new Map<number, Map<number, number>>();

    paidInvoices.forEach(inv => {
      const d = new Date(inv.issueDate);
      const year = d.getFullYear();
      const month = d.getMonth();

      if (!yearMonthMap.has(year)) {
        yearMonthMap.set(year, new Map());
      }
      const monthMap = yearMonthMap.get(year)!;
      monthMap.set(month, (monthMap.get(month) ?? 0) + inv.totalAmount);
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
      const monthRevenues: number[] = [];
      let rowTotal = 0;
      for (let m = 0; m < 12; m++) {
        const rev = yearMonthMap.get(year)?.get(m) ?? 0;
        monthRevenues.push(rev);
        rowTotal += rev;
        columnTotals[m] += rev;
      }
      matrix.set(year, monthRevenues);
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
      'VALIDÉE': 'var(--color-success-500)',
      'Validée': 'var(--color-primary-500)',
      'Signée': 'var(--color-primary-500)',
      'En attente': 'var(--color-warning-500)',
      'Brouillon': 'var(--color-neutral-400)',
      'En retard': 'var(--color-error-500)',
      'Annulée': 'var(--color-error-500)'
    };
    return colorMap[status] || 'var(--color-neutral-400)';
  }
}
