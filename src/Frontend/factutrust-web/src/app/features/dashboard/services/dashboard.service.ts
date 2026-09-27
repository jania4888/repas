import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { QuoteService, QuoteListItem } from '@core/services/quote.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { isRealizedRevenue } from '@core/utils/invoice-metrics.util';
import { buildKpiSparklines, type KpiSparklines } from './dashboard-kpi-series.util';

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
}

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTH_SHORT_FR = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
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
        : of({ success: true, data: { items: [] as ClientListItem[] } } as any)
    }).pipe(
      map(({ invoices, quotes, clients }) => {
        const allInvoices: InvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const allQuotes: QuoteListItem[] = quotes.success ? quotes.data.items : [];
        const allClients: ClientListItem[] = clients.success ? clients.data.items : [];

        return {
          allInvoices,
          recentInvoices: allInvoices.slice(0, 5),
          allQuotes,
          recentQuotes: allQuotes.slice(0, 5),
          topClients: this.computeTopClients(allClients),
          monthlyRevenue: this.computeMonthlyRevenue(allInvoices),
          recentActivity: this.buildRecentActivity(allInvoices, allQuotes),
          kpiTrends: this.computeKpiTrends(allInvoices),
          kpiSparklines: buildKpiSparklines(allInvoices),
          activeQuotesCount: this.countActiveQuotes(allQuotes)
        };
      })
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

  private computeMonthlyRevenue(invoices: InvoiceListItem[]): MonthlyRevenueData[] {
    const now = new Date();
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
      const invDate = new Date(inv.issueDate);
      const monthEntry = months.find(
        m => m.year === invDate.getFullYear() &&
             MONTH_NAMES_FR[invDate.getMonth()] === m.month
      );
      if (monthEntry) {
        monthEntry.revenue += inv.totalAmount;
        monthEntry.invoiceCount++;
      }
    });

    return months;
  }

  private computeKpiTrends(invoices: InvoiceListItem[]): KpiTrends {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const thisMonthInvoices = invoices.filter(inv => {
      const d = new Date(inv.issueDate);
      return d >= thisMonthStart && d <= now;
    });

    const lastMonthInvoices = invoices.filter(inv => {
      const d = new Date(inv.issueDate);
      return d >= lastMonthStart && d <= lastMonthEnd;
    });

    const thisMonthRevenue = thisMonthInvoices
      .filter(inv => isRealizedRevenue(inv.status))
      .reduce((sum, inv) => sum + inv.totalAmount, 0);

    const lastMonthRevenue = lastMonthInvoices
      .filter(inv => isRealizedRevenue(inv.status))
      .reduce((sum, inv) => sum + inv.totalAmount, 0);

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

    return {
      revenueChange: this.computePercentChange(lastMonthRevenue, thisMonthRevenue),
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

    if (diffMinutes < 1) return "À l'instant";
    if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;

    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }
}
