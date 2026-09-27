import { PERMISSIONS } from '@core/config/permission-keys';
import { AppModule } from '@core/models/app-module';
import { DeliveryNoteStatus } from '../delivery-notes/models/delivery-note.model';

export interface DrillDownMonthData {
  month: string;
  monthShort: string;
  year: number;
  revenue: number;
  invoiceCount: number;
}

export type DashboardDrillDownId =
  | 'totalRevenue'
  | 'salesToday'
  | 'currentMonthRevenue'
  | 'pendingInvoices'
  | 'stockAlerts'
  | 'urgentStock'
  | 'urgentDeliveries'
  | 'urgentOverdueInvoices'
  | 'pendingDeliveriesSide'
  | 'activeQuotesSide'
  | 'chartMonth'
  | 'accountingVat'
  | 'accountingReceivables90'
  | 'accountingUnposted'
  | 'accountingVatDeadline'
  | 'crmReminders'
  | 'crmOpenOpportunities';

export interface DashboardDrillDownTarget {
  route: string | any[];
  queryParams?: Record<string, string>;
  requiredPermission?: string;
  requiredModule?: AppModule;
  ariaLabel: string;
}

export interface DrillDownAuthChecker {
  hasPermission(permission: string): boolean;
  hasModule(module: AppModule): boolean;
}

export interface DrillDownContext {
  month?: DrillDownMonthData;
  now?: Date;
}

const MONTH_SHORT_KEYS = ['jan', 'fev', 'mar', 'avr', 'mai', 'juin', 'juil', 'aout', 'sep', 'oct', 'nov', 'dec'];

export const INVOICE_STATUS_OVERDUE = 6;

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeMonthToken(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function monthIndexFromShort(monthShort: string): number {
  const norm = normalizeMonthToken(monthShort);
  if (norm.startsWith('jan')) return 0;
  if (norm.startsWith('fev')) return 1;
  if (norm.startsWith('mar')) return 2;
  if (norm.startsWith('avr')) return 3;
  if (norm.startsWith('mai')) return 4;
  if (norm.startsWith('juin')) return 5;
  if (norm.startsWith('juil')) return 6;
  if (norm.startsWith('aou')) return 7;
  if (norm.startsWith('sep')) return 8;
  if (norm.startsWith('oct')) return 9;
  if (norm.startsWith('nov')) return 10;
  if (norm.startsWith('dec')) return 11;
  return -1;
}

function monthBoundsFromRevenueData(month: DrillDownMonthData): { fromDate: string; toDate: string } | null {
  const monthIndex = monthIndexFromShort(month.monthShort);
  if (monthIndex < 0) {
    return null;
  }
  const from = new Date(month.year, monthIndex, 1);
  const to = new Date(month.year, monthIndex + 1, 0);
  return { fromDate: formatIsoDate(from), toDate: formatIsoDate(to) };
}

function currentMonthBounds(now: Date): { fromDate: string; toDate: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { fromDate: formatIsoDate(from), toDate: formatIsoDate(now) };
}

export function getDrillDownTarget(
  id: DashboardDrillDownId,
  context: DrillDownContext = {}
): DashboardDrillDownTarget {
  const now = context.now ?? new Date();
  const todayIso = formatIsoDate(now);

  switch (id) {
    case 'totalRevenue':
      return {
        route: '/reports/analytics/revenue',
        // Dashboard card is the cumulative total → open the matching "Cumulé" view.
        queryParams: { period: 'all' },
        requiredPermission: PERMISSIONS.reports.view,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.du.chiffre.d.affaires.069bd230:Voir le detail du chiffre d affaires`
      };
    case 'salesToday':
      return {
        route: '/invoices',
        queryParams: { fromDate: todayIso, toDate: todayIso },
        requiredPermission: PERMISSIONS.invoices.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.ventes.du.jour.469ef93f:Voir le detail des ventes du jour`
      };
    case 'currentMonthRevenue': {
      const bounds = currentMonthBounds(now);
      return {
        route: '/invoices',
        queryParams: bounds,
        requiredPermission: PERMISSIONS.invoices.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.du.chiffre.d.affaires.du.64dfc081:Voir le detail du chiffre d affaires du mois en cours`
      };
    }
    case 'pendingInvoices':
      return {
        route: '/invoices/unpaid',
        requiredPermission: PERMISSIONS.invoices.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.factures.impayees.730d7951:Voir le detail des factures impayees`
      };
    case 'stockAlerts':
    case 'urgentStock':
      return {
        route: '/stock',
        queryParams: { alerts: '1' },
        requiredPermission: PERMISSIONS.stock.read,
        requiredModule: AppModule.Stock,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.produits.en.alerte.st.a1c30000:Voir le detail des produits en alerte stock`
      };
    case 'urgentDeliveries':
    case 'pendingDeliveriesSide':
      return {
        route: '/delivery-notes',
        queryParams: { status: DeliveryNoteStatus.Confirmed },
        requiredPermission: PERMISSIONS.deliveryNotes.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.livraisons.en.attente.da5ca72e:Voir le detail des livraisons en attente`
      };
    case 'urgentOverdueInvoices':
      return {
        route: '/invoices',
        queryParams: { status: String(INVOICE_STATUS_OVERDUE) },
        requiredPermission: PERMISSIONS.invoices.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.factures.en.retard.3a0537c2:Voir le detail des factures en retard`
      };
    case 'activeQuotesSide':
      return {
        route: '/quotes',
        queryParams: { activeOnly: '1' },
        requiredPermission: PERMISSIONS.quotes.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.devis.en.cours.695217fc:Voir le detail des devis en cours`
      };
    case 'chartMonth': {
      if (!context.month) {
        return {
          route: '/reports/analytics/revenue',
          requiredPermission: PERMISSIONS.reports.view,
          ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.du.chiffre.d.affaires.069bd230:Voir le detail du chiffre d affaires`
        };
      }
      const bounds = monthBoundsFromRevenueData(context.month);
      return {
        route: '/invoices',
        queryParams: bounds ?? undefined,
        requiredPermission: PERMISSIONS.invoices.read,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.factures.de.month.yea.c608c550:Voir le detail des factures de ${context.month.month}:month: ${context.month.year}:year:`
      };
    }
    case 'accountingVat':
    case 'accountingVatDeadline':
      return {
        route: '/accounting/vat-declaration',
        requiredPermission: PERMISSIONS.accounting.read,
        requiredModule: AppModule.Accounting,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.de.la.tva.3000fd1d:Voir le detail de la TVA`
      };
    case 'accountingReceivables90':
      return {
        route: '/accounting/aging',
        requiredPermission: PERMISSIONS.accounting.read,
        requiredModule: AppModule.Accounting,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.creances.de.plus.de.9.b9c0be04:Voir le detail des creances de plus de 90 jours`
      };
    case 'accountingUnposted':
      return {
        route: '/accounting/journal',
        requiredPermission: PERMISSIONS.accounting.read,
        requiredModule: AppModule.Accounting,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.journal.comptable.95cc2fb4:Voir le journal comptable`
      };
    case 'crmReminders':
      return {
        route: '/crm/activities',
        queryParams: { mine: '1', completed: 'false' },
        requiredPermission: PERMISSIONS.crm.read,
        requiredModule: AppModule.CRM,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.de.mes.relances.crm.5c9f1690:Voir le detail de mes relances CRM`
      };
    case 'crmOpenOpportunities':
      return {
        route: '/crm/opportunities',
        requiredPermission: PERMISSIONS.crm.read,
        requiredModule: AppModule.CRM,
        ariaLabel: $localize`:@@dashboard.dashboard-drill-down.ts.voir.le.detail.des.opportunites.ouvertes.797fdfd8:Voir le detail des opportunites ouvertes`
      };
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function canNavigateToTarget(
  target: DashboardDrillDownTarget,
  auth: DrillDownAuthChecker
): boolean {
  if (target.requiredModule !== undefined && !auth.hasModule(target.requiredModule)) {
    return false;
  }
  if (target.requiredPermission !== undefined && !auth.hasPermission(target.requiredPermission)) {
    return false;
  }
  return true;
}