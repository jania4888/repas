import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * Registre déclaratif des widgets sectoriels et actions rapides du tableau de
 * bord (plan v1 §2.5 — Dashboard adaptatif). Chaque widget déclare les modules
 * requis (`requiredModules`), les segments d'entreprise concernés (`segments`,
 * absent = tous les segments) et la permission de garde-fou (`permission`,
 * défense en profondeur — les permissions effectives sont déjà intersectées
 * avec les modules actifs côté backend).
 *
 * Le composant filtre ce registre avec la même logique que la navigation
 * (`hasModule` + segment courant), garantissant qu'aucun bloc du tableau de
 * bord ne s'affiche vide pour un tenant dont les modules/segment ne
 * correspondent pas.
 */

export interface SectorKpiWidgetDef {
  widgetId: string;
  labelFr: string;
  icon: string;
  /** Classe de tonalité (cf. `.stat-card--*` / tone-*). */
  tone: string;
  requiredModules: AppModule[];
  /** Codes de segment (`SEGMENT_OPTIONS`) concernés ; absent = tous. */
  segments?: string[];
  permission?: string;
  route: string;
}

export interface QuickActionWidgetDef {
  widgetId: string;
  labelFr: string;
  icon: string;
  tone: string;
  requiredModules: AppModule[];
  permission?: string;
  route: string;
}

/**
 * Variantes sectorielles v1 (statiques, plan §2.5) :
 * - Commerce : ruptures de stock, achats en cours ;
 * - Services & BTP : projets actifs, contrats récurrents actifs ;
 * - Association / Établissement éducatif : cotisations (contrats récurrents) actives.
 */
export const SECTOR_KPI_WIDGETS: readonly SectorKpiWidgetDef[] = [
  {
    widgetId: 'commerce-stock-ruptures',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.ruptures.stock.faible.4ebf4888:Ruptures / stock faible`,
    icon: 'fa-solid fa-triangle-exclamation',
    tone: 'sector-kpi--amber',
    requiredModules: [AppModule.Stock],
    segments: ['commerce'],
    permission: PERMISSIONS.stock.read,
    route: '/stock'
  },
  {
    widgetId: 'commerce-purchases-pending',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.achats.en.cours.787b01be:Achats en cours`,
    icon: 'fa-solid fa-cart-shopping',
    tone: 'sector-kpi--purple',
    requiredModules: [AppModule.Purchases],
    segments: ['commerce'],
    permission: PERMISSIONS.purchaseOrders.read,
    route: '/purchases/orders'
  },
  {
    widgetId: 'services-btp-active-projects',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.projets.actifs.9a6cf9d6:Projets actifs`,
    icon: 'fa-solid fa-diagram-project',
    tone: 'sector-kpi--indigo',
    requiredModules: [AppModule.Projects],
    segments: ['services', 'btp-construction'],
    permission: PERMISSIONS.projects.read,
    route: '/projects'
  },
  {
    widgetId: 'services-btp-recurring-contracts',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.contrats.recurrents.actifs.60edacfd:Contrats récurrents actifs`,
    icon: 'fa-solid fa-arrows-rotate',
    tone: 'sector-kpi--teal',
    requiredModules: [AppModule.RecurringContracts],
    segments: ['services', 'btp-construction'],
    permission: PERMISSIONS.recurringContracts.read,
    route: '/recurring-contracts'
  },
  {
    widgetId: 'assoc-edu-membership-fees',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.cotisations.actives.2ce7c1d2:Cotisations actives`,
    icon: 'fa-solid fa-id-card',
    tone: 'sector-kpi--teal',
    requiredModules: [AppModule.RecurringContracts],
    segments: ['association', 'etablissement-educatif'],
    permission: PERMISSIONS.recurringContracts.read,
    route: '/recurring-contracts'
  }
];

/**
 * Actions rapides dérivées des modules actifs (plan §2.5 point 3), en plus des
 * actions historiques basées permissions du tableau de bord. Toujours
 * intersectées avec les permissions effectives de l'utilisateur.
 */
export const QUICK_ACTION_WIDGETS: readonly QuickActionWidgetDef[] = [
  {
    widgetId: 'qa-stock-entry',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.entree.de.stock.8c8e1df1:Entrée de stock`,
    icon: 'fa-solid fa-box',
    tone: 'qa-stock',
    requiredModules: [AppModule.Stock],
    permission: PERMISSIONS.stockVouchers.create,
    route: '/stock/entries/new'
  },
  {
    widgetId: 'qa-new-opportunity',
    labelFr: $localize`:@@dashboard.dashboard-widgets.registry.ts.nouvelle.opportunite.ffadea57:Nouvelle opportunité`,
    icon: 'fa-solid fa-heart',
    tone: 'qa-crm',
    requiredModules: [AppModule.CRM],
    permission: PERMISSIONS.crm.create,
    route: '/crm/opportunities'
  }
];

/**
 * Filtre un widget sectoriel : modules requis actifs, segment courant
 * compatible (ou widget sans restriction de segment) et permission accordée
 * (si déclarée).
 */
export function isSectorKpiWidgetVisible(
  widget: SectorKpiWidgetDef,
  companySegment: string | null | undefined,
  hasAllModules: (modules: AppModule[]) => boolean,
  hasPermission: (permission: string) => boolean
): boolean {
  if (!hasAllModules(widget.requiredModules)) {
    return false;
  }
  if (widget.segments && widget.segments.length > 0) {
    if (!companySegment || !widget.segments.includes(companySegment)) {
      return false;
    }
  }
  if (widget.permission && !hasPermission(widget.permission)) {
    return false;
  }
  return true;
}

export function visibleSectorKpiWidgets(
  companySegment: string | null | undefined,
  hasAllModules: (modules: AppModule[]) => boolean,
  hasPermission: (permission: string) => boolean
): SectorKpiWidgetDef[] {
  return SECTOR_KPI_WIDGETS.filter((w) => isSectorKpiWidgetVisible(w, companySegment, hasAllModules, hasPermission));
}

export function isQuickActionWidgetVisible(
  widget: QuickActionWidgetDef,
  hasAllModules: (modules: AppModule[]) => boolean,
  hasPermission: (permission: string) => boolean
): boolean {
  if (!hasAllModules(widget.requiredModules)) {
    return false;
  }
  if (widget.permission && !hasPermission(widget.permission)) {
    return false;
  }
  return true;
}

export function visibleQuickActionWidgets(
  hasAllModules: (modules: AppModule[]) => boolean,
  hasPermission: (permission: string) => boolean
): QuickActionWidgetDef[] {
  return QUICK_ACTION_WIDGETS.filter((w) => isQuickActionWidgetVisible(w, hasAllModules, hasPermission));
}
