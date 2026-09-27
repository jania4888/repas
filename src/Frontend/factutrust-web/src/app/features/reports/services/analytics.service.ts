import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { QuoteService, QuoteListItem } from '@core/services/quote.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { isRealizedRevenue, getPeriodRange, RevenuePeriod } from '@core/utils/invoice-metrics.util';

// ── Types ──────────────────────────────────────────────────────────────

export type AnalyticsPeriod = RevenuePeriod;

export interface PeriodComparison {
  currentValue: number;
  previousValue: number;
  changePercent: number;
  changeDirection: 'up' | 'down' | 'stable';
  message: string;
}

export interface RevenueByClient {
  clientName: string;
  totalAmount: number;
  invoiceCount: number;
  currency: string;
  percentOfTotal: number;
}

export interface RevenueByProduct {
  productName: string;
  productCode: string;
  totalAmount: number;
  quantitySold: number;
  currency: string;
  percentOfTotal: number;
}

export interface RevenueChartPoint {
  label: string;
  labelShort: string;
  revenue: number;
  invoiceCount: number;
}

export interface RevenueData {
  totalRevenue: number;
  totalInvoices: number;
  currency: string;
  comparison: PeriodComparison;
  chartData: RevenueChartPoint[];
  byClient: RevenueByClient[];
  byProduct: RevenueByProduct[];
}

export interface ProductPerformance {
  productName: string;
  productCode: string;
  quantitySold: number;
  totalRevenue: number;
  purchasePrice: number | null;
  unitPrice: number;
  marginPercent: number | null;
  marginAmount: number | null;
  currency: string;
  rank: number;
}

export interface SalesData {
  topProducts: ProductPerformance[];
  worstProducts: ProductPerformance[];
  conversionRate: number;
  convertedQuotes: number;
  totalQuotes: number;
  averageBasket: number;
  totalInvoices: number;
  currency: string;
  alerts: SalesAlert[];
  recommendations: string[];
}

export interface SalesAlert {
  type: 'warning' | 'danger' | 'info' | 'success';
  icon: string;
  title: string;
  message: string;
}

export interface ClientAnalyticsItem {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  totalInvoices: number;
  totalRevenue: number;
  unpaidCount: number;
  unpaidAmount: number;
  lastInvoiceDate: string | null;
  currency: string;
}

export interface ClientsData {
  activeCount: number;
  inactiveCount: number;
  totalClients: number;
  activePercent: number;
  clientRanking: ClientAnalyticsItem[];
  clientsWithUnpaid: ClientAnalyticsItem[];
  currency: string;
  alerts: SalesAlert[];
}

// ── French labels ──────────────────────────────────────────────────────

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTH_SHORT_FR = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
];

const DAY_NAMES_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// ── Service ────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private invoiceService = inject(InvoiceService);
  private quoteService = inject(QuoteService);
  private productService = inject(ProductService);
  private clientService = inject(ClientService);

  private fmt(n: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(n);
  }

  private isPaid(status: string): boolean {
    // Realized revenue = Payée + Validée (shared canonical rule, diacritic/case-insensitive).
    return isRealizedRevenue(status);
  }

  private isPending(status: string): boolean {
    const s = status?.toLowerCase() || '';
    return s.includes('attente') || s.includes('pending') ||
           s.includes('envoyé') || s.includes('sent');
  }

  private isOverdue(invoice: InvoiceListItem): boolean {
    const s = invoice.status?.toLowerCase() || '';
    return invoice.isOverdue || s.includes('retard') || s.includes('overdue');
  }

  // ── Revenue (CA) ──────────────────────────────────────────────────

  loadRevenueData(period: AnalyticsPeriod): Observable<RevenueData> {
    const { currentFrom, currentTo, previousFrom, previousTo } = this.getDateRanges(period);

    return forkJoin({
      allInvoices: this.invoiceService.getInvoices({ pageSize: 2000 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
      )
    }).pipe(
      map(({ allInvoices }) => {
        const invoices: InvoiceListItem[] = allInvoices.success ? allInvoices.data.items : [];
        const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

        // Filter current + previous periods
        const currentInvoices = invoices.filter(inv => {
          const d = new Date(inv.issueDate);
          return d >= currentFrom && d <= currentTo;
        });
        const previousInvoices = invoices.filter(inv => {
          const d = new Date(inv.issueDate);
          return d >= previousFrom && d <= previousTo;
        });

        const currentPaid = currentInvoices.filter(inv => this.isPaid(inv.status));
        const previousPaid = previousInvoices.filter(inv => this.isPaid(inv.status));

        const currentRevenue = currentPaid.reduce((s, inv) => s + inv.totalAmount, 0);
        const previousRevenue = previousPaid.reduce((s, inv) => s + inv.totalAmount, 0);

        const comparison = this.buildComparison(currentRevenue, previousRevenue, period, currency);
        const chartData = this.buildRevenueChart(currentPaid, period);
        const byClient = this.buildRevenueByClient(currentPaid, currentRevenue, currency);
        const byProduct = this.buildRevenueByProduct(currentInvoices, currentRevenue, currency);

        return {
          totalRevenue: currentRevenue,
          totalInvoices: currentInvoices.length,
          currency,
          comparison,
          chartData,
          byClient,
          byProduct
        };
      })
    );
  }

  private getDateRanges(period: AnalyticsPeriod): {
    currentFrom: Date; currentTo: Date; previousFrom: Date; previousTo: Date;
  } {
    // Canonical period bounds shared with the dashboard (incl. 'all' = cumulative).
    return getPeriodRange(period);
  }

  private buildComparison(current: number, previous: number, period: AnalyticsPeriod, currency: string): PeriodComparison {
    // Cumulative view has no comparable prior period.
    if (period === 'all') {
      return {
        currentValue: current,
        previousValue: 0,
        changePercent: 0,
        changeDirection: 'stable',
        message: $localize`:@@reports.analytics.ts.chiffre.d.affaires.cumule.depuis.l.origi.11ee98f2:Chiffre d'affaires cumulé depuis l'origine.`
      };
    }

    let changePercent = 0;
    if (previous > 0) {
      changePercent = ((current - previous) / previous) * 100;
    } else if (current > 0) {
      changePercent = 100;
    }

    const direction: 'up' | 'down' | 'stable' =
      changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable';

    const periodLabel = period === 'day' ? 'aujourd\'hui' : period === 'month' ? $localize`:@@reports.analytics.ts.ce.mois.ci.f30c2ac7:ce mois-ci` : $localize`:@@reports.analytics.ts.cette.annee.9909e9db:cette année`;
    const prevLabel = period === 'day' ? 'hier' : period === 'month' ? $localize`:@@reports.analytics.ts.le.mois.dernier.15ecb0a2:le mois dernier` : $localize`:@@reports.analytics.ts.l.annee.derniere.372514a8:l'année dernière`;

    let message: string;
    if (direction === 'up') {
      message = $localize`:@@reports.analytics.ts.votre.chiffre.d.affaires.a.augmente.de.t.14e75341:Votre chiffre d'affaires a augmenté de ${Math.abs(changePercent).toFixed(1)}:toFixed: % ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    } else if (direction === 'down') {
      message = $localize`:@@reports.analytics.ts.votre.chiffre.d.affaires.a.baisse.de.tof.bc243bee:Votre chiffre d'affaires a baissé de ${Math.abs(changePercent).toFixed(1)}:toFixed: % ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    } else {
      message = $localize`:@@reports.analytics.ts.votre.chiffre.d.affaires.est.stable.peri.85052562:Votre chiffre d'affaires est stable ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    }

    return { currentValue: current, previousValue: previous, changePercent, changeDirection: direction, message };
  }

  private buildRevenueChart(paidInvoices: InvoiceListItem[], period: AnalyticsPeriod): RevenueChartPoint[] {
    const now = new Date();

    if (period === 'day') {
      // 24 hours
      const result: RevenueChartPoint[] = [];
      for (let h = 0; h < 24; h++) {
        const inv = paidInvoices.filter(i => new Date(i.issueDate).getHours() === h);
        result.push({
          label: `${h}h`,
          labelShort: `${h}h`,
          revenue: inv.reduce((s, i) => s + i.totalAmount, 0),
          invoiceCount: inv.length
        });
      }
      return result;
    }

    if (period === 'month') {
      // Days of the current month
      const result: RevenueChartPoint[] = [];
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), d);
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), d, 23, 59, 59);
        const inv = paidInvoices.filter(i => {
          const dt = new Date(i.issueDate);
          return dt >= dayStart && dt <= dayEnd;
        });
        result.push({
          label: `${d} ${MONTH_SHORT_FR[now.getMonth()]}`,
          labelShort: `${d}`,
          revenue: inv.reduce((s, i) => s + i.totalAmount, 0),
          invoiceCount: inv.length
        });
      }
      return result;
    }

    if (period === 'all') {
      // Cumulative: one bucket per calendar year present in the data.
      const byYear = new Map<number, { revenue: number; invoiceCount: number }>();
      paidInvoices.forEach(i => {
        const y = new Date(i.issueDate).getFullYear();
        const e = byYear.get(y) ?? { revenue: 0, invoiceCount: 0 };
        e.revenue += i.totalAmount;
        e.invoiceCount++;
        byYear.set(y, e);
      });
      return Array.from(byYear.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([y, e]) => ({
          label: String(y),
          labelShort: String(y),
          revenue: e.revenue,
          invoiceCount: e.invoiceCount
        }));
    }

    // Year: 12 months
    const result: RevenueChartPoint[] = [];
    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(now.getFullYear(), m, 1);
      const monthEnd = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59);
      const inv = paidInvoices.filter(i => {
        const dt = new Date(i.issueDate);
        return dt >= monthStart && dt <= monthEnd;
      });
      result.push({
        label: MONTH_NAMES_FR[m],
        labelShort: MONTH_SHORT_FR[m],
        revenue: inv.reduce((s, i) => s + i.totalAmount, 0),
        invoiceCount: inv.length
      });
    }
    return result;
  }

  private buildRevenueByClient(paidInvoices: InvoiceListItem[], totalRevenue: number, currency: string): RevenueByClient[] {
    const clientMap = new Map<string, RevenueByClient>();
    paidInvoices.forEach(inv => {
      const existing = clientMap.get(inv.clientName);
      if (existing) {
        existing.totalAmount += inv.totalAmount;
        existing.invoiceCount++;
      } else {
        clientMap.set(inv.clientName, {
          clientName: inv.clientName,
          totalAmount: inv.totalAmount,
          invoiceCount: 1,
          currency,
          percentOfTotal: 0
        });
      }
    });
    const result = Array.from(clientMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 15);
    result.forEach(r => r.percentOfTotal = totalRevenue > 0 ? (r.totalAmount / totalRevenue) * 100 : 0);
    return result;
  }

  private buildRevenueByProduct(invoices: InvoiceListItem[], totalRevenue: number, currency: string): RevenueByProduct[] {
    // We cannot get product-level details from InvoiceListItem (no lines).
    // So we estimate by counting unique invoices. This is a placeholder;
    // in production, a backend endpoint would provide this.
    // For now, return empty – the UI will handle it gracefully.
    return [];
  }

  // ── Sales Analytics ───────────────────────────────────────────────

  loadSalesData(): Observable<SalesData> {
    return forkJoin({
      invoices: this.invoiceService.getInvoices({ pageSize: 2000 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
      ),
      quotes: this.quoteService.getQuotes({ pageSize: 1000 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as QuoteListItem[] } } as any))
      ),
      products: this.productService.getProducts({ pageSize: 500 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as ProductListItem[] } } as any))
      )
    }).pipe(
      map(({ invoices, quotes, products }) => {
        const invList: InvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const quoteList: QuoteListItem[] = quotes.success ? quotes.data.items : [];
        const prodList: ProductListItem[] = products.success ? products.data.items : [];
        const currency = invList.length > 0 ? invList[0].currency : 'TND';

        // Products performance (from product data + invoices)
        const paidInvoices = invList.filter(inv => this.isPaid(inv.status));
        const productPerf = this.computeProductPerformance(prodList, paidInvoices, currency);

        const topProducts = productPerf.slice(0, 10);
        const worstProducts = productPerf
          .filter(p => p.quantitySold > 0)
          .slice(-5)
          .reverse();

        // Conversion rate
        const convertedQuotes = quoteList.filter(q => q.isConverted).length;
        const totalQuotes = quoteList.length;
        const conversionRate = totalQuotes > 0 ? (convertedQuotes / totalQuotes) * 100 : 0;

        // Average basket
        const totalInvoices = paidInvoices.length;
        const totalRevenue = paidInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
        const averageBasket = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

        // Alerts & recommendations
        const alerts: SalesAlert[] = [];
        const recommendations: string[] = [];

        if (conversionRate < 30 && totalQuotes > 5) {
          alerts.push({
            type: 'warning',
            icon: 'pi-exclamation-triangle',
            title: $localize`:@@reports.analytics.ts.taux.de.conversion.faible.eda966dc:Taux de conversion faible`,
            message: $localize`:@@reports.analytics.ts.seulement.tofixed.de.vos.devis.sont.tran.5a3c6d1c:Seulement ${conversionRate.toFixed(1)}:toFixed: % de vos devis sont transformés en factures. Pensez à relancer vos prospects.`
          });
          recommendations.push($localize`:@@reports.analytics.ts.relancez.les.devis.en.attente.pour.ameli.986a4f8a:Relancez les devis en attente pour améliorer votre taux de conversion.`);
        }

        if (conversionRate >= 60) {
          alerts.push({
            type: 'success',
            icon: 'pi-check-circle',
            title: $localize`:@@reports.analytics.ts.excellent.taux.de.conversion.45a62af6:Excellent taux de conversion`,
            message: $localize`:@@reports.analytics.ts.tofixed.de.vos.devis.deviennent.des.fact.debd51c4:${conversionRate.toFixed(1)}:toFixed: % de vos devis deviennent des factures. Continuez ainsi !`
          });
        }

        const lowMarginProducts = productPerf.filter(p => p.marginPercent !== null && p.marginPercent < 15 && p.quantitySold > 0);
        if (lowMarginProducts.length > 0) {
          alerts.push({
            type: 'danger',
            icon: 'pi-exclamation-circle',
            title: $localize`:@@reports.analytics.ts.marges.faibles.detectees.b836ff0e:Marges faibles détectées`,
            message: $localize`:@@reports.analytics.ts.length.produit.s.ont.une.marge.inferieur.a10ca376:${lowMarginProducts.length}:length: produit(s) ont une marge inférieure à 15 %. Vérifiez vos prix de vente.`
          });
          recommendations.push($localize`:@@reports.analytics.ts.revoyez.les.prix.de.vente.des.produits.a.1a55053d:Revoyez les prix de vente des produits à faible marge pour améliorer votre rentabilité.`);
        }

        if (averageBasket > 0) {
          recommendations.push($localize`:@@reports.analytics.ts.votre.panier.moyen.est.de.fmt.currency.p.504f78fd:Votre panier moyen est de ${this.fmt(averageBasket)}:fmt: ${currency}:currency:. Proposez des produits complémentaires pour l'augmenter.`);
        }

        return {
          topProducts,
          worstProducts,
          conversionRate,
          convertedQuotes,
          totalQuotes,
          averageBasket,
          totalInvoices,
          currency,
          alerts,
          recommendations
        };
      })
    );
  }

  private computeProductPerformance(products: ProductListItem[], paidInvoices: InvoiceListItem[], currency: string): ProductPerformance[] {
    // Since InvoiceListItem doesn't have lines detail, we estimate revenue evenly.
    // In production, a backend endpoint would provide per-product revenue.
    // For now, we build performance from product data only (price, purchase price, margin).
    return products.map((p, i) => {
      const marginAmount = p.purchasePrice != null ? p.unitPrice - p.purchasePrice : null;
      const marginPercent = marginAmount !== null && p.unitPrice > 0
        ? (marginAmount / p.unitPrice) * 100
        : null;

      return {
        productName: p.name,
        productCode: p.code,
        quantitySold: 0, // Would come from backend
        totalRevenue: 0,
        purchasePrice: p.purchasePrice ?? null,
        unitPrice: p.unitPrice,
        marginPercent,
        marginAmount,
        currency,
        rank: i + 1
      };
    }).sort((a, b) => (b.marginPercent ?? 0) - (a.marginPercent ?? 0));
  }

  // ── Client Analytics ──────────────────────────────────────────────

  loadClientsData(): Observable<ClientsData> {
    return forkJoin({
      clients: this.clientService.getClients({ pageSize: 500 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as ClientListItem[] } } as any))
      ),
      invoices: this.invoiceService.getInvoices({ pageSize: 2000 }).pipe(
        catchError(() => of({ success: false, data: { items: [] as InvoiceListItem[] } } as any))
      )
    }).pipe(
      map(({ clients, invoices }) => {
        const clientList: ClientListItem[] = clients.success ? clients.data.items : [];
        const invList: InvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const currency = invList.length > 0 ? invList[0].currency : 'TND';

        const activeCount = clientList.filter(c => c.isActive).length;
        const inactiveCount = clientList.filter(c => !c.isActive).length;
        const totalClients = clientList.length;
        const activePercent = totalClients > 0 ? (activeCount / totalClients) * 100 : 0;

        // Build per-client analytics
        const clientAnalytics = this.buildClientAnalytics(clientList, invList, currency);
        const clientsWithUnpaid = clientAnalytics.filter(c => c.unpaidCount > 0)
          .sort((a, b) => b.unpaidAmount - a.unpaidAmount);
        const clientRanking = clientAnalytics
          .sort((a, b) => b.totalRevenue - a.totalRevenue);

        const alerts: SalesAlert[] = [];
        if (clientsWithUnpaid.length > 0) {
          const totalUnpaid = clientsWithUnpaid.reduce((s, c) => s + c.unpaidAmount, 0);
          alerts.push({
            type: 'danger',
            icon: 'pi-exclamation-circle',
            title: $localize`:@@reports.analytics.ts.impayes.detectes.f85261c0:Impayés détectés`,
            message: $localize`:@@reports.analytics.ts.length.client.s.ont.des.factures.impayee.d65918cd:${clientsWithUnpaid.length}:length: client(s) ont des factures impayées pour un total de ${this.fmt(totalUnpaid)}:fmt: ${currency}:currency:.`
          });
        }

        if (inactiveCount > activeCount) {
          alerts.push({
            type: 'warning',
            icon: 'pi-exclamation-triangle',
            title: $localize`:@@reports.analytics.ts.beaucoup.de.clients.inactifs.8a0e4af1:Beaucoup de clients inactifs`,
            message: $localize`:@@reports.analytics.ts.inactivecount.de.vos.clients.sont.inacti.1576e3ff:${inactiveCount}:inactiveCount: de vos clients sont inactifs. Pensez à les relancer.`
          });
        }

        return {
          activeCount,
          inactiveCount,
          totalClients,
          activePercent,
          clientRanking,
          clientsWithUnpaid,
          currency,
          alerts
        };
      })
    );
  }

  private buildClientAnalytics(clients: ClientListItem[], invoices: InvoiceListItem[], currency: string): ClientAnalyticsItem[] {
    // Build invoice stats per client name
    const clientInvMap = new Map<string, {
      invoiceCount: number;
      totalRevenue: number;
      unpaidCount: number;
      unpaidAmount: number;
      lastDate: string | null;
    }>();

    invoices.forEach(inv => {
      const existing = clientInvMap.get(inv.clientName);
      const isPaid = this.isPaid(inv.status);
      const isPending = this.isPending(inv.status) || this.isOverdue(inv);

      if (existing) {
        existing.invoiceCount++;
        if (isPaid) existing.totalRevenue += inv.totalAmount;
        if (isPending) {
          existing.unpaidCount++;
          existing.unpaidAmount += inv.totalAmount;
        }
        if (!existing.lastDate || inv.issueDate > existing.lastDate) {
          existing.lastDate = inv.issueDate;
        }
      } else {
        clientInvMap.set(inv.clientName, {
          invoiceCount: 1,
          totalRevenue: isPaid ? inv.totalAmount : 0,
          unpaidCount: isPending ? 1 : 0,
          unpaidAmount: isPending ? inv.totalAmount : 0,
          lastDate: inv.issueDate
        });
      }
    });

    return clients.map(c => {
      const stats = clientInvMap.get(c.name) || {
        invoiceCount: c.totalInvoices || 0,
        totalRevenue: c.totalRevenue || 0,
        unpaidCount: 0,
        unpaidAmount: 0,
        lastDate: null
      };

      return {
        id: c.id,
        name: c.name,
        email: c.email ?? '',
        isActive: c.isActive,
        totalInvoices: stats.invoiceCount,
        totalRevenue: stats.totalRevenue,
        unpaidCount: stats.unpaidCount,
        unpaidAmount: stats.unpaidAmount,
        lastInvoiceDate: stats.lastDate,
        currency
      };
    });
  }
}
