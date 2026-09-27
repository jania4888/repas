import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { SupplierInvoiceService, SupplierInvoiceListItem, SupplierInvoiceStatus, isSupplierInvoicePaid, isSupplierInvoiceCancelled } from '@core/services/supplier-invoice.service';
import {
  PurchaseOrderService,
  PurchaseOrderListItem,
  PurchaseOrderStatus
} from '@core/services/purchase-order.service';
import { formatLocalDate } from '@core/utils/date.util';

// ── Types ──────────────────────────────────────────────────────────────

export type PurchasesAnalyticsPeriod = 'day' | 'month' | 'year';

export interface PeriodComparison {
  currentValue: number;
  previousValue: number;
  changePercent: number;
  changeDirection: 'up' | 'down' | 'stable';
  message: string;
}

export interface ExpenseChartPoint {
  label: string;
  labelShort: string;
  amount: number;
  invoiceCount: number;
}

export interface ExpensesBySupplier {
  supplierName: string;
  totalAmount: number;
  invoiceCount: number;
  currency: string;
  percentOfTotal: number;
}

export interface ExpensesAnalyticsData {
  totalExpenses: number;
  totalInvoices: number;
  currency: string;
  comparison: PeriodComparison;
  chartData: ExpenseChartPoint[];
  bySupplier: ExpensesBySupplier[];
}

export interface SupplierAnalyticsItem {
  supplierName: string;
  invoiceCount: number;
  totalAmount: number;
  percentOfTotal: number;
  currency: string;
}

export interface PurchasesAlert {
  type: 'warning' | 'danger' | 'info' | 'success';
  icon: string;
  title: string;
  message: string;
}

export interface SuppliersAnalyticsData {
  activeSuppliersCount: number;
  totalExpenses: number;
  topSuppliers: SupplierAnalyticsItem[];
  concentrationTop5Percent: number;
  currency: string;
  alerts: PurchasesAlert[];
}

export interface OrdersAnalyticsData {
  totalOrders: number;
  invoicedOrders: number;
  conversionRate: number;
  averageOrderAmount: number;
  averageInvoiceAmount: number;
  ordersByStatus: { status: string; count: number }[];
  topSuppliersByOrders: { supplierName: string; orderCount: number; totalAmount: number }[];
  currency: string;
  alerts: PurchasesAlert[];
}

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTH_SHORT_FR = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
];

// ── Service ────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PurchasesAnalyticsService {
  private supplierInvoiceService = inject(SupplierInvoiceService);
  private purchaseOrderService = inject(PurchaseOrderService);

  private getDateRanges(period: PurchasesAnalyticsPeriod): {
    currentFrom: Date;
    currentTo: Date;
    previousFrom: Date;
    previousTo: Date;
  } {
    const now = new Date();
    let currentFrom: Date;
    let currentTo: Date;
    let previousFrom: Date;
    let previousTo: Date;

    if (period === 'day') {
      currentFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      currentTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const yest = new Date(currentFrom);
      yest.setDate(yest.getDate() - 1);
      previousFrom = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate());
      previousTo = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59);
    } else if (period === 'month') {
      currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      currentTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else {
      currentFrom = new Date(now.getFullYear(), 0, 1);
      currentTo = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      previousFrom = new Date(now.getFullYear() - 1, 0, 1);
      previousTo = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    }

    return { currentFrom, currentTo, previousFrom, previousTo };
  }

  private buildComparison(
    current: number,
    previous: number,
    period: PurchasesAnalyticsPeriod,
    _currency: string
  ): PeriodComparison {
    let changePercent = 0;
    if (previous > 0) {
      changePercent = ((current - previous) / previous) * 100;
    } else if (current > 0) {
      changePercent = 100;
    }

    const direction: 'up' | 'down' | 'stable' =
      changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable';

    const periodLabel = period === 'day' ? 'aujourd\'hui' : period === 'month' ? 'ce mois-ci' : 'cette année';
    const prevLabel = period === 'day' ? 'hier' : period === 'month' ? 'le mois dernier' : 'l\'année dernière';

    let message: string;
    if (direction === 'up') {
      message = $localize`:@@reports.purchases-analytics.ts.vos.depenses.ont.augmente.de.tofixed.per.9c5d089b:Vos dépenses ont augmenté de ${Math.abs(changePercent).toFixed(1)}:toFixed: % ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    } else if (direction === 'down') {
      message = $localize`:@@reports.purchases-analytics.ts.vos.depenses.ont.diminue.de.tofixed.peri.8ee99686:Vos dépenses ont diminué de ${Math.abs(changePercent).toFixed(1)}:toFixed: % ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    } else {
      message = $localize`:@@reports.purchases-analytics.ts.vos.depenses.sont.stables.periodlabel.pa.90f1d63b:Vos dépenses sont stables ${periodLabel}:periodLabel: par rapport à ${prevLabel}:prevLabel:.`;
    }

    return { currentValue: current, previousValue: previous, changePercent, changeDirection: direction, message };
  }

  private buildExpenseChart(
    paidInvoices: SupplierInvoiceListItem[],
    period: PurchasesAnalyticsPeriod
  ): ExpenseChartPoint[] {
    const now = new Date();

    if (period === 'day') {
      const result: ExpenseChartPoint[] = [];
      for (let h = 0; h < 24; h++) {
        const inv = paidInvoices.filter(i => new Date(i.invoiceDate).getHours() === h);
        result.push({
          label: `${h}h`,
          labelShort: `${h}h`,
          amount: inv.reduce((s, i) => s + i.totalTTC, 0),
          invoiceCount: inv.length
        });
      }
      return result;
    }

    if (period === 'month') {
      const result: ExpenseChartPoint[] = [];
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), d);
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), d, 23, 59, 59);
        const inv = paidInvoices.filter(i => {
          const dt = new Date(i.invoiceDate);
          return dt >= dayStart && dt <= dayEnd;
        });
        result.push({
          label: `${d} ${MONTH_SHORT_FR[now.getMonth()]}`,
          labelShort: `${d}`,
          amount: inv.reduce((s, i) => s + i.totalTTC, 0),
          invoiceCount: inv.length
        });
      }
      return result;
    }

    const result: ExpenseChartPoint[] = [];
    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(now.getFullYear(), m, 1);
      const monthEnd = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59);
      const inv = paidInvoices.filter(i => {
        const dt = new Date(i.invoiceDate);
        return dt >= monthStart && dt <= monthEnd;
      });
      result.push({
        label: MONTH_NAMES_FR[m],
        labelShort: MONTH_SHORT_FR[m],
        amount: inv.reduce((s, i) => s + i.totalTTC, 0),
        invoiceCount: inv.length
      });
    }
    return result;
  }

  private buildExpensesBySupplier(
    paidInvoices: SupplierInvoiceListItem[],
    totalExpenses: number,
    currency: string
  ): ExpensesBySupplier[] {
    const supplierMap = new Map<string, ExpensesBySupplier>();
    paidInvoices.forEach(inv => {
      const existing = supplierMap.get(inv.supplierName);
      if (existing) {
        existing.totalAmount += inv.totalTTC;
        existing.invoiceCount++;
      } else {
        supplierMap.set(inv.supplierName, {
          supplierName: inv.supplierName,
          totalAmount: inv.totalTTC,
          invoiceCount: 1,
          currency,
          percentOfTotal: 0
        });
      }
    });
    const result = Array.from(supplierMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 15);
    result.forEach(r => {
      r.percentOfTotal = totalExpenses > 0 ? (r.totalAmount / totalExpenses) * 100 : 0;
    });
    return result;
  }

  loadExpensesData(period: PurchasesAnalyticsPeriod): Observable<ExpensesAnalyticsData> {
    const { currentFrom, currentTo, previousFrom, previousTo } = this.getDateRanges(period);
    const params = {
      pageSize: 2000,
      fromDate: formatLocalDate(new Date(previousFrom.getTime() - 365 * 24 * 60 * 60 * 1000)),
      toDate: formatLocalDate(currentTo)
    };

    return this.supplierInvoiceService.getSupplierInvoices(params).pipe(
      catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any)),
      map(response => {
        const invoices: SupplierInvoiceListItem[] = response.success ? response.data.items : [];
        const currency = 'TND';

        const currentInvoices = invoices.filter(inv => {
          const d = new Date(inv.invoiceDate);
          return d >= currentFrom && d <= currentTo;
        });
        const previousInvoices = invoices.filter(inv => {
          const d = new Date(inv.invoiceDate);
          return d >= previousFrom && d <= previousTo;
        });

        const currentPaid = currentInvoices.filter(inv => isSupplierInvoicePaid(inv.status));
        const previousPaid = previousInvoices.filter(inv => isSupplierInvoicePaid(inv.status));

        const currentExpenses = currentPaid.reduce((s, inv) => s + inv.totalTTC, 0);
        const previousExpenses = previousPaid.reduce((s, inv) => s + inv.totalTTC, 0);

        const comparison = this.buildComparison(currentExpenses, previousExpenses, period, currency);
        const chartData = this.buildExpenseChart(currentPaid, period);
        const bySupplier = this.buildExpensesBySupplier(currentPaid, currentExpenses, currency);

        return {
          totalExpenses: currentExpenses,
          totalInvoices: currentInvoices.length,
          currency,
          comparison,
          chartData,
          bySupplier
        };
      })
    );
  }

  loadSuppliersAnalyticsData(period: PurchasesAnalyticsPeriod): Observable<SuppliersAnalyticsData> {
    const { currentFrom, currentTo } = this.getDateRanges(period);
    const params = {
      pageSize: 2000,
      fromDate: formatLocalDate(currentFrom),
      toDate: formatLocalDate(currentTo)
    };

    return this.supplierInvoiceService.getSupplierInvoices(params).pipe(
      catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any)),
      map(response => {
        const invoices: SupplierInvoiceListItem[] = response.success ? response.data.items : [];
        const paidInvoices = invoices.filter(inv => isSupplierInvoicePaid(inv.status));
        const totalExpenses = paidInvoices.reduce((s, inv) => s + inv.totalTTC, 0);
        const currency = 'TND';

        const supplierMap = new Map<string, { invoiceCount: number; totalAmount: number }>();
        paidInvoices.forEach(inv => {
          const existing = supplierMap.get(inv.supplierName);
          if (existing) {
            existing.invoiceCount++;
            existing.totalAmount += inv.totalTTC;
          } else {
            supplierMap.set(inv.supplierName, { invoiceCount: 1, totalAmount: inv.totalTTC });
          }
        });

        const topSuppliers: SupplierAnalyticsItem[] = Array.from(supplierMap.entries())
          .map(([name, data]) => ({
            supplierName: name,
            invoiceCount: data.invoiceCount,
            totalAmount: data.totalAmount,
            percentOfTotal: totalExpenses > 0 ? (data.totalAmount / totalExpenses) * 100 : 0,
            currency
          }))
          .sort((a, b) => b.totalAmount - a.totalAmount)
          .slice(0, 15);

        const top5Amount = topSuppliers.slice(0, 5).reduce((s, x) => s + x.totalAmount, 0);
        const concentrationTop5Percent = totalExpenses > 0 ? (top5Amount / totalExpenses) * 100 : 0;

        const alerts: PurchasesAlert[] = [];
        const overdueInvoices = invoices.filter(inv => {
          const due = new Date(inv.dueDate);
          return !isSupplierInvoicePaid(inv.status) && !isSupplierInvoiceCancelled(inv.status) && due < new Date();
        });
        if (overdueInvoices.length > 0) {
          const overdueSuppliers = new Set(overdueInvoices.map(inv => inv.supplierName));
          alerts.push({
            type: 'danger',
            icon: 'pi-exclamation-circle',
            title: $localize`:@@reports.purchases-analytics.ts.factures.en.retard.7fc4c2c8:Factures en retard`,
            message: $localize`:@@reports.purchases-analytics.ts.length.facture.s.en.retard.concernant.si.4be2dacd:${overdueInvoices.length}:length: facture(s) en retard concernant ${overdueSuppliers.size}:size: fournisseur(s).`
          });
        }

        return {
          activeSuppliersCount: supplierMap.size,
          totalExpenses,
          topSuppliers,
          concentrationTop5Percent,
          currency,
          alerts
        };
      })
    );
  }

  loadOrdersAnalyticsData(period: PurchasesAnalyticsPeriod): Observable<OrdersAnalyticsData> {
    const { currentFrom, currentTo } = this.getDateRanges(period);
    const invoiceParams = {
      pageSize: 2000,
      fromDate: formatLocalDate(currentFrom),
      toDate: formatLocalDate(currentTo)
    };
    const poParams = {
      pageSize: 2000,
      fromDate: formatLocalDate(currentFrom),
      toDate: formatLocalDate(currentTo)
    };

    return forkJoin({
      invoices: this.supplierInvoiceService.getSupplierInvoices(invoiceParams).pipe(
        catchError(() => of({ success: false, data: { items: [] as SupplierInvoiceListItem[] } } as any))
      ),
      orders: this.purchaseOrderService.getPurchaseOrders(poParams).pipe(
        catchError(() => of({ success: false, data: { items: [] as PurchaseOrderListItem[] } } as any))
      )
    }).pipe(
      map(({ invoices, orders }) => {
        const invList: SupplierInvoiceListItem[] = invoices.success ? invoices.data.items : [];
        const orderList: PurchaseOrderListItem[] = orders.success ? orders.data.items : [];
        const currency = 'TND';

        const totalOrders = orderList.length;
        const invoicedStatuses = [PurchaseOrderStatus.Invoiced];
        const invoicedOrders = orderList.filter(po => invoicedStatuses.includes(po.status)).length;
        const conversionRate = totalOrders > 0 ? (invoicedOrders / totalOrders) * 100 : 0;

        const ordersTotal = orderList.reduce((s, po) => s + po.totalTTC, 0);
        const averageOrderAmount = totalOrders > 0 ? ordersTotal / totalOrders : 0;
        const invTotal = invList.filter(inv => isSupplierInvoicePaid(inv.status)).reduce((s, inv) => s + inv.totalTTC, 0);
        const paidCount = invList.filter(inv => isSupplierInvoicePaid(inv.status)).length;
        const averageInvoiceAmount = paidCount > 0 ? invTotal / paidCount : 0;

        const statusMap = new Map<string, number>();
        orderList.forEach(po => {
          const status = po.statusDisplay || 'Inconnu';
          statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
        });
        const ordersByStatus = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

        const supplierOrderMap = new Map<string, { orderCount: number; totalAmount: number }>();
        orderList.forEach(po => {
          const existing = supplierOrderMap.get(po.supplierName);
          if (existing) {
            existing.orderCount++;
            existing.totalAmount += po.totalTTC;
          } else {
            supplierOrderMap.set(po.supplierName, { orderCount: 1, totalAmount: po.totalTTC });
          }
        });
        const topSuppliersByOrders = Array.from(supplierOrderMap.entries())
          .map(([supplierName, data]) => ({ supplierName, orderCount: data.orderCount, totalAmount: data.totalAmount }))
          .sort((a, b) => b.orderCount - a.orderCount)
          .slice(0, 10);

        const alerts: PurchasesAlert[] = [];
        if (totalOrders > 0 && conversionRate < 40) {
          alerts.push({
            type: 'warning',
            icon: 'pi-exclamation-triangle',
            title: $localize`:@@reports.purchases-analytics.ts.taux.de.conversion.faible.eda966dc:Taux de conversion faible`,
            message: $localize`:@@reports.purchases-analytics.ts.seulement.tofixed.de.vos.bons.de.command.1654c482:Seulement ${conversionRate.toFixed(1)}:toFixed: % de vos bons de commande sont passés en facture. Vérifiez les commandes en attente.`
          });
        }
        if (conversionRate >= 70 && totalOrders > 0) {
          alerts.push({
            type: 'success',
            icon: 'pi-check-circle',
            title: $localize`:@@reports.purchases-analytics.ts.bon.taux.de.conversion.209bee0b:Bon taux de conversion`,
            message: $localize`:@@reports.purchases-analytics.ts.tofixed.de.vos.bons.de.commande.ont.ete.a068af2e:${conversionRate.toFixed(1)}:toFixed: % de vos bons de commande ont été facturés.`
          });
        }

        return {
          totalOrders,
          invoicedOrders,
          conversionRate,
          averageOrderAmount,
          averageInvoiceAmount,
          ordersByStatus,
          topSuppliersByOrders,
          currency,
          alerts
        };
      })
    );
  }
}
