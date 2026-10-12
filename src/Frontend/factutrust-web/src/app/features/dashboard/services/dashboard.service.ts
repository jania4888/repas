import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { QuoteService, QuoteListItem } from '@core/services/quote.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  computeRevenuePercentChange,
  getMonthToDateRange,
  isRealizedRevenue,
  parseIssueDateLocal,
  revenueAmountHt,
  sumRealizedRevenueHt,
  toIsoDateLocal
} from '@core/utils/invoice-metrics.util';
import { buildKpiSparklines, type KpiSparklines } from './dashboard-kpi-series.util';
import { erpDateLocale } from '@core/i18n/erp-format';

export type { KpiSparklines };

export interface MonthlyRevenueData {
  month: string;
  monthShort: string;
  year: number;
  revenue: number;
  invoiceCount: number;
}

export interface TopClientData {
  id: string;
  name: string;
  invoiceCount: number;
  totalRevenue: number;
  currency: string;
  percentage: number;
}

export interface ActivityItem {
  id: string;
  type: 'invoice' | 'quote' | 'delivery';
  icon: string;
  iconClass: string;
  description: string;
  date: Date;
  relativeDate: string;
  link: string;
}

export interface KpiTrends {
  revenueChange: number | undefined;
  salesTodayChange: number | undefined;
  pendingChange: number | undefined;
}

/**
 * CA HT (Payée + Validée) read from the backend summary endpoint, with exactly the
 * same parameters as the "Factures et avoirs" drill-down (`/invoices/revenue`), so the
 * dashboard card and the detail view are equal by construction. `null` when the
 * permission is missing or the request failed — callers fall back to the client-side
 * computation ({@link sumRealizedRevenueHt}).
 */
export interface RevenueKpis {
  totalHt: number | null;
  monthToDateHt: number | null;
  previousMonthToDateHt: number | null;
}

export interface DashboardAggregatedData {
  allInvoices: InvoiceListItem[];
  recentInvoices: InvoiceListItem[];
  allQuotes: QuoteListItem[];
  recentQuotes: QuoteListItem[];
  topClients: TopClientData[];
  monthlyRevenue: MonthlyRevenueData[];
  recentActivity: ActivityItem[];
  kpiTrends: KpiTrends;
  kpiSparklines: KpiSparklines;
  activeQuotesCount: number;
  revenueKpis: RevenueKpis;
}

const MONTH_NAMES_FR = [
  $localize`:@@dashboard.dashboard.ts.janvier.7a32ae0f:Janvier`, $localize`:@@dashboard.dashboard.ts.fevrier.63fc1803:Février`, $localize`:@@dashboard.dashboard.ts.mars.1778011d:Mars`, $localize`:@@dashboard.dashboard.ts.avril.4efeee46:Avril`, $localize`:@@dashboard.dashboard.ts.mai.afe526a6:Mai`, $localize`:@@dashboard.dashboard.ts.juin.8b1e84b6:Juin`,
  $localize`:@@dashboard.dashboard.ts.juillet.e8e0920c:Juillet`, $localize`:@@dashboard.dashboard.ts.aout.460b6696:Août`, $localize`:@@dashboard.dashboard.ts.septembre.08d23f31:Septembre`, $localize`:@@dashboard.dashboard.ts.octobre.0ed28485:Octobre`, $localize`:@@dashboard.dashboard.ts.novembre.632580af:Novembre`, $localize`:@@dashboard.dashboard.ts.decembre.03bcd9b0:Décembre`
];

const MONTH_SHORT_FR = [
  $localize`:@@dashboard.dashboard.ts.jan.efed3690:Jan`, $localize`:@@dashboard.dashboard.ts.fev.7b8852ec:Fév`, $localize`:@@dashboard.dashboard.ts.mar.c4ba0822:Mar`, $localize`:@@dashboard.dashboard.ts.avr.d648a3b7:Avr`, $localize`:@@dashboard.dashboard.ts.mai.afe526a6:Mai`, $localize`:@@dashboard.dashboard.ts.juin.8b1e84b6:Juin`,
  $localize`:@@dashboard.dashboard.ts.juil.190b5d60:Juil`, $localize`:@@dashboard.dashboard.ts.aout.460b6696:Août`, $localize`:@@dashboard.dashboard.ts.sep.fdd289e3:Sep`, $localize`:@@dashboard.dashboard.ts.oct.51327aef:Oct`, $localize`:@@dashboard.dashboard.ts.nov.bb9bfefd:Nov`, $localize`:@@dashboard.dashboard.ts.dec.2bc2249a:Déc`
];

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private invoiceService = inject(InvoiceService);
  private quoteService = inject(QuoteService);
  private clientService = inject(ClientService);
  private authService = inject(AuthService);

  loadDashboardData(): Observable<DashboardAggregatedData> {
    const canReadInvoices = this.authService.hasPermission(PERMISSIONS.invoices.read);
    const canReadQuotes = this.authService.hasPermission(PERMISSIONS.quotes.read);
    const canReadClients = this.authService.hasPermission(PERMISSIONS.clients.read);

    const now = new Date();
    const { current, previous } = getMonthToDateRange(now);

    return forkJoin({
      invoices: canReadInvoices
        ? this.invoiceService.getInvoices({ pageSize: 1000, skipGlobalErrorUi: true }).pipe(
            catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
          )
        : of({ success: true, data: { items: [] as InvoiceListItem[] } } as any),
      quotes: canReadQuotes
        ? this.quoteService.getQuotes({ pageSize: 200, skipGlobalErrorUi: true }).pipe(
            catchError(() => of({ success: false, data: { items: [] as QuoteListItem[] } } as any))
          )
        : of({ success: true, data: { items: [] as QuoteListItem[] } } as any),
      clients: canReadClients
        ? this.clientService.getClients({
            pageSize: 100,
            sortBy: 'totalRevenue',
            sortOrder: 'desc',
            skipGlobalErrorUi: true
          }).pipe(
            catchError(() => of({ success: false, data: { items: [] as ClientListItem[] } } as any))
          )
        : of({ success: true, data: { items: [] as ClientListItem[] } } as any),
      // CA HT (Payée + Validée) read from the server, with the same filters as the
      // "Factures et avoirs" drill-down — see RevenueKpis for why.
      revenueTotal: canReadInvoices ? this.loadRevenueSummaryHt() : of(null),
      revenueMonthToDate: canReadInvoices
        ? this.loadRevenueSummaryHt(current.from, current.to)
        : of(null),
      revenuePreviousMonthToDate: canReadInvoices
        ? this.loadRevenueSummaryHt(previous.from, previous.to)
        : of(null)
    }).pipe(
      map(({ invoices, quotes, clients, revenueTotal, revenueMonthToDate, revenuePreviousMonthToDate }) => {
        const allInvoices: InvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const allQuotes: QuoteListItem[] = quotes.success ? quotes.data.items : [];
        const allClients: ClientListItem[] = clients.success ? clients.data.items : [];

        const revenueKpis: RevenueKpis = {
          totalHt: revenueTotal,
          monthToDateHt: revenueMonthToDate,
          previousMonthToDateHt: revenuePreviousMonthToDate
        };

        return {
          allInvoices,
          recentInvoices: allInvoices.slice(0, 5),
          allQuotes,
          recentQuotes: allQuotes.slice(0, 5),
          topClients: this.computeTopClients(allClients),
          monthlyRevenue: this.computeMonthlyRevenue(allInvoices, now),
          recentActivity: this.buildRecentActivity(allInvoices, allQuotes),
          kpiTrends: this.computeKpiTrends(allInvoices, revenueKpis, now),
          kpiSparklines: buildKpiSparklines(allInvoices, now),
          activeQuotesCount: this.countActiveQuotes(allQuotes),
          revenueKpis
        };
      })
    );
  }

  /**
   * Server-side CA HT for an optional date range (Payée + Validée, signed HT).
   * `null` on request failure — callers fall back to the client-side sumRealizedRevenueHt.
   * `realizedRevenueHt ?? totalHt`: the two are equal under the filter; totalHt covers an
   * API not yet deployed with the new field.
   */
  private loadRevenueSummaryHt(from?: Date, to?: Date): Observable<number | null> {
    return this.invoiceService.getInvoicesSummary({
      realizedRevenueOnly: true,
      ...(from && to ? { fromDate: toIsoDateLocal(from), toDate: toIsoDateLocal(to) } : {}),
      skipGlobalErrorUi: true
    }).pipe(
      map(res => (res.success && res.data ? res.data.realizedRevenueHt ?? res.data.totalHt : null)),
      catchError(() => of(null))
    );
  }

  private computeTopClients(clients: ClientListItem[]): TopClientData[] {
    const sorted = [...clients]
      .filter(c => c.totalRevenue > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    const maxRevenue = sorted.length > 0 ? sorted[0].totalRevenue : 1;

    return sorted.map(c => ({
      id: c.id,
      name: c.name,
      invoiceCount: c.totalInvoices,
      totalRevenue: c.totalRevenue,
      currency: 'TND',
      percentage: (c.totalRevenue / maxRevenue) * 100
    }));
  }

  private computeMonthlyRevenue(invoices: InvoiceListItem[], now: Date = new Date()): MonthlyRevenueData[] {
    const months: MonthlyRevenueData[] = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: MONTH_NAMES_FR[date.getMonth()],
        monthShort: MONTH_SHORT_FR[date.getMonth()],
        year: date.getFullYear(),
        revenue: 0,
        invoiceCount: 0
      });
    }

    const paidInvoices = invoices.filter(inv => isRealizedRevenue(inv.status));

    paidInvoices.forEach(inv => {
      const invDate = parseIssueDateLocal(inv.issueDate);
      if (!invDate) {
        return;
      }
      const monthEntry = months.find(
        m => m.year === invDate.getFullYear() &&
             MONTH_NAMES_FR[invDate.getMonth()] === m.month
      );
      if (monthEntry) {
        monthEntry.revenue += revenueAmountHt(inv);
        monthEntry.invoiceCount++;
      }
    });

    return months;
  }

  /**
   * `revenueChange` is read from the server summary values (same rule as the card and
   * the drill-down) when available; it falls back to a client-side computation over
   * `invoices` (first 1000 documents) if the server summary is missing (no permission
   * or request failure). `pendingChange` is unaffected (unchanged TTC-agnostic logic).
   */
  private computeKpiTrends(
    invoices: InvoiceListItem[],
    revenueKpis: RevenueKpis,
    now: Date = new Date()
  ): KpiTrends {
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const thisMonthInvoices = invoices.filter(inv => {
      const d = new Date(inv.issueDate);
      return d >= new Date(now.getFullYear(), now.getMonth(), 1) && d <= now;
    });

    const lastMonthInvoices = invoices.filter(inv => {
      const d = new Date(inv.issueDate);
      return d >= lastMonthStart && d <= lastMonthEnd;
    });

    const thisMonthPending = thisMonthInvoices.filter(inv => {
      const s = inv.status?.toLowerCase() || '';
      return s.includes('attente') || s.includes('pending') ||
             s.includes('envoyé') || s.includes('sent');
    }).length;

    const lastMonthPending = lastMonthInvoices.filter(inv => {
      const s = inv.status?.toLowerCase() || '';
      return s.includes('attente') || s.includes('pending') ||
             s.includes('envoyé') || s.includes('sent');
    }).length;

    let revenueChange: number | undefined;
    if (revenueKpis.monthToDateHt !== null && revenueKpis.previousMonthToDateHt !== null) {
      revenueChange = computeRevenuePercentChange(revenueKpis.previousMonthToDateHt, revenueKpis.monthToDateHt);
    } else {
      const { current, previous } = getMonthToDateRange(now);
      const monthToDateHt = sumRealizedRevenueHt(invoices, current);
      const previousMonthToDateHt = sumRealizedRevenueHt(invoices, previous);
      revenueChange = computeRevenuePercentChange(previousMonthToDateHt, monthToDateHt);
    }

    return {
      revenueChange,
      salesTodayChange: undefined,
      pendingChange: this.computePercentChange(lastMonthPending, thisMonthPending)
    };
  }

  private computePercentChange(previous: number, current: number): number | undefined {
    if (previous === 0 && current === 0) return undefined;
    if (previous === 0) return current > 0 ? 100 : undefined;
    return Math.round(((current - previous) / previous) * 100);
  }

  private countActiveQuotes(quotes: QuoteListItem[]): number {
    return quotes.filter(q => {
      const s = q.status?.toLowerCase() || '';
      return s.includes('brouillon') || s.includes('draft') ||
             s.includes('envoyé') || s.includes('sent') ||
             s.includes('en attente') || s.includes('pending');
    }).length;
  }

  private buildRecentActivity(
    invoices: InvoiceListItem[],
    quotes: QuoteListItem[]
  ): ActivityItem[] {
    const activities: ActivityItem[] = [];

    invoices.slice(0, 15).forEach(inv => {
      const status = inv.status?.toLowerCase() || '';
      let description: string;
      let iconClass: string;

      if (status.includes('payé') || status.includes('paid')) {
        description = $localize`:@@dashboard.dashboard.ts.paiement.recu.pour.number.aa5e2d5f:Paiement reçu pour ${inv.number}:number:`;
        iconClass = 'activity-success';
      } else if (status.includes('validé') || status.includes('validated') ||
                 status.includes('signé') || status.includes('signed')) {
        description = $localize`:@@dashboard.dashboard.ts.facture.number.validee.fac00f06:Facture ${inv.number}:number: validée`;
        iconClass = 'activity-primary';
      } else if (status.includes('envoyé') || status.includes('sent')) {
        description = $localize`:@@dashboard.dashboard.ts.facture.number.envoyee.a.clientname.0bc8ea33:Facture ${inv.number}:number: envoyée à ${inv.clientName}:clientName:`;
        iconClass = 'activity-info';
      } else {
        description = $localize`:@@dashboard.dashboard.ts.facture.number.creee.pour.clientname.af9541d5:Facture ${inv.number}:number: créée pour ${inv.clientName}:clientName:`;
        iconClass = 'activity-neutral';
      }

      activities.push({
        id: inv.id,
        type: 'invoice',
        icon: 'pi-file-edit',
        iconClass,
        description,
        date: new Date(inv.issueDate),
        relativeDate: this.formatRelativeDate(new Date(inv.issueDate)),
        link: `/invoices/${inv.id}`
      });
    });

    quotes.slice(0, 10).forEach(q => {
      const status = q.status?.toLowerCase() || '';
      let description: string;
      let iconClass: string;

      if (status.includes('accepté') || status.includes('accepted')) {
        description = $localize`:@@dashboard.dashboard.ts.devis.number.accepte.par.clientname.fb9003ef:Devis ${q.number}:number: accepté par ${q.clientName}:clientName:`;
        iconClass = 'activity-success';
      } else if (status.includes('envoyé') || status.includes('sent')) {
        description = $localize`:@@dashboard.dashboard.ts.devis.number.envoye.a.clientname.311bc806:Devis ${q.number}:number: envoyé à ${q.clientName}:clientName:`;
        iconClass = 'activity-info';
      } else if (status.includes('converti') || status.includes('converted')) {
        description = $localize`:@@dashboard.dashboard.ts.devis.number.converti.en.facture.d1ddf45a:Devis ${q.number}:number: converti en facture`;
        iconClass = 'activity-primary';
      } else {
        description = $localize`:@@dashboard.dashboard.ts.devis.number.cree.pour.clientname.254a3e71:Devis ${q.number}:number: créé pour ${q.clientName}:clientName:`;
        iconClass = 'activity-neutral';
      }

      activities.push({
        id: q.id,
        type: 'quote',
        icon: 'pi-file',
        iconClass,
        description,
        date: new Date(q.issueDate),
        relativeDate: this.formatRelativeDate(new Date(q.issueDate)),
        link: `/quotes/${q.id}`
      });
    });

    return activities
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 8);
  }

  private formatRelativeDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return $localize`:@@dashboard.dashboard.ts.a.l.instant.67cf83bb:À l'instant`;
    if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return $localize`:@@dashboard.dashboard.ts.il.y.a.diffdays.jours.44aa16a2:Il y a ${diffDays}:diffDays: jours`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;

    return date.toLocaleDateString(erpDateLocale('fr-FR'), { day: '2-digit', month: 'short' });
  }
}
