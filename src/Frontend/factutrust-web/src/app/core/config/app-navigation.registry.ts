import { AppModule } from '../models/app-module';
import { AI_ASSISTANT_ICON_CLASS } from '../constants/ai-assistant-brand';
import { PERMISSIONS } from './permission-keys';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';
import { AuthService } from '../services/auth.service';
import { canSeeNavEntry } from '../utils/nav-visibility';
import { QUICK_ACCESS_ITEMS } from './quick-access.config';
import { isDelegatedFirmBlockedSalesPurchasesRoute } from './firm-navigation.registry';
import {
  filterCompanyAccountingSearchEntries,
  isCompanyAccountingRestricted
} from './company-accounting-nav.config';

export type NavSubItemAction = 'returnToFirm' | 'changeDossier';

export interface NavSubItem {
  /** Stable key for logic / i18n. */
  id?: string;
  label: string;
  icon?: string;
  railIconAsset?: string;
  route?: string;
  action?: NavSubItemAction;
  modules?: AppModule[];
  permissionsAll?: string[];
  platformSettingsOnly?: boolean;
  /** Visible only to FirmManager in native accounting-firm mode. */
  managerOnly?: boolean;
  /** Compteur affiché à droite du libellé (ex. approbations en attente). */
  badge?: number | null;
  /**
   * Groupe de présentation. `reports` forme un suffixe contigu du sous-menu ;
   * l'UI dessine un titre non cliquable, sans route ni permission propre.
   */
  navGroup?: 'reports';
  /** One nesting level max (e.g. secondary-nav flyout). UI must not recurse further. */
  children?: NavSubItem[];
}

export interface NavItem {
  /** Stable key for logic / i18n. */
  id?: string;
  label: string;
  icon?: string;
  railIconAsset?: string;
  route?: string;
  /** Pastille BETA du rail. Indépendante du pictogramme (l’assistant n’utilise plus une image). */
  beta?: boolean;
  /** Stable product-tour anchor (`data-tour="nav-{tourId}"`). Optional — missing ids are skipped. */
  tourId?: string;
  /** External help / support link (opens in a new tab). */
  externalUrl?: string;
  badge?: number;
  children?: NavSubItem[];
  modules?: AppModule[];
  permissionsAll?: string[];
  platformSettingsOnly?: boolean;
  /** Visible only to FirmManager in native accounting-firm mode. */
  managerOnly?: boolean;
}

export type NavSearchGroup = 'page' | 'create' | 'report' | 'settings' | 'documentation';

export interface NavSearchEntry extends NavVisibilityFields {
  id: string;
  label: string;
  keywords?: string[];
  route: string;
  icon: string;
  group: NavSearchGroup;
  breadcrumb?: string;
}

interface NavVisibilityFields {
  modules?: AppModule[];
  permissionsAll?: string[];
  platformSettingsOnly?: boolean;
}

const M = AppModule;

export const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: $localize`:@@core.app-navigation.registry.ts.tableau.de.bord.a524057f:Tableau de bord`, icon: 'fa-solid fa-gauge-high', route: '/dashboard', tourId: 'dashboard' },
  {
    id: 'ai-assistant',
    label: $localize`:@@core.app-navigation.registry.ts.assistant.ia.94f6f208:Assistant IA`,
    icon: AI_ASSISTANT_ICON_CLASS,
    beta: true,
    route: '/ai-assistant',
    tourId: 'ai-assistant',
    modules: [M.AI],
    permissionsAll: ['ai:chat']
  },
  {
    id: 'forecasting',
    label: $localize`:@@core.app-navigation.registry.ts.previsions.ia.2cbfbe7a:Prévisions IA`,
    icon: 'fa-solid fa-chart-line',
    modules: [M.Forecasting],
    permissionsAll: ['forecasting:view'],
    children: [
      {
        id: 'forecasting--forecasting-revenue',
        label: $localize`:@@core.app-navigation.registry.ts.previsions.ca.94d0bab1:Prévisions CA`,
        route: '/forecasting/revenue',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        id: 'forecasting--forecasting-replenishment',
        label: $localize`:@@core.app-navigation.registry.ts.reapprovisionnement.77e72f0b:Réapprovisionnement`,
        route: '/forecasting/replenishment',
        icon: 'fa-solid fa-truck-ramp-box',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        id: 'forecasting--forecasting-promotions',
        label: $localize`:@@core.app-navigation.registry.ts.promotions.suggerees.ff46ad11:Promotions suggérées`,
        route: '/forecasting/promotions',
        icon: 'fa-solid fa-tags',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        id: 'forecasting--forecasting-abc-xyz',
        label: $localize`:@@core.app-navigation.registry.ts.matrice.abc.xyz.8f41fc5c:Matrice ABC × XYZ`,
        route: '/forecasting/abc-xyz',
        icon: 'fa-solid fa-table-cells',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      }
    ]
  },
  {
    id: 'pos',
    label: $localize`:@@core.app-navigation.registry.ts.point.de.vente.420a8974:Point de Vente`,
    icon: 'fa-solid fa-cash-register',
    route: '/pos',
    modules: [M.Sales, M.Products, M.Stock],
    permissionsAll: ['invoices:create', 'products:read', 'stock:read']
  },
  {
    id: 'sales',
    label: $localize`:@@core.app-navigation.registry.ts.ventes.9087fc4f:Ventes`,
    icon: 'fa-solid fa-bag-shopping',
    tourId: 'ventes',
    children: [
      {
        id: 'sales--ai-assistant-ventes',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.ventes.7390d945:Assistant Ventes`,
        route: '/ai-assistant/ventes',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Sales, M.AI],
        permissionsAll: ['ai:chat', 'invoices:read']
      },
      {
        id: 'sales--quotes',
        label: $localize`:@@core.app-navigation.registry.ts.devis.f7622f90:Devis`,
        route: '/quotes',
        icon: 'fa-solid fa-file-lines',
        modules: [M.Sales],
        permissionsAll: ['quotes:read']
      },
      {
        id: 'sales--sales-orders',
        label: $localize`:@@core.app-navigation.registry.ts.commandes.clients.928f824a:Commandes clients`,
        route: '/sales-orders',
        icon: 'fa-solid fa-cart-shopping',
        modules: [M.Sales],
        permissionsAll: ['sales_orders:read']
      },
      {
        id: 'sales--delivery-notes',
        label: $localize`:@@core.app-navigation.registry.ts.bon.de.livraison.439bfda9:Bon de Livraison`,
        route: '/delivery-notes',
        icon: 'fa-solid fa-truck',
        modules: [M.Sales],
        permissionsAll: ['delivery_notes:read']
      },
      {
        id: 'sales--return-notes',
        label: $localize`:@@core.app-navigation.registry.ts.bon.de.retour.58d2db35:Bon de retour`,
        route: '/return-notes',
        icon: 'fa-solid fa-rotate-left',
        modules: [M.Sales],
        permissionsAll: ['return_notes:read']
      },
      {
        id: 'sales--invoices',
        label: $localize`:@@core.app-navigation.registry.ts.factures.da35e4f2:Factures`,
        route: '/invoices',
        icon: 'fa-solid fa-file',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        id: 'sales--invoices-credit-notes',
        label: $localize`:@@core.app-navigation.registry.ts.avoir.de.vente.2c744bf7:Avoir de vente`,
        route: '/invoices/credit-notes',
        icon: 'fa-solid fa-receipt',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        id: 'sales--invoices-unpaid',
        label: $localize`:@@core.app-navigation.registry.ts.factures.impayees.dc3cffa5:Factures impayées`,
        route: '/invoices/unpaid',
        icon: 'fa-solid fa-circle-exclamation',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        id: 'sales--recurring-contracts',
        label: $localize`:@@core.app-navigation.registry.ts.contrats.recurrents.e773e54a:Contrats récurrents`,
        route: '/recurring-contracts',
        icon: 'fa-solid fa-arrows-rotate',
        modules: [M.RecurringContracts],
        permissionsAll: [PERMISSIONS.recurringContracts.read]
      },
      {
        id: 'sales--sales-journal',
        label: $localize`:@@core.app-navigation.registry.ts.journal.de.ventes.a1b2c3d4:Journal de ventes`,
        route: '/reports/sales-journal',
        icon: 'fa-solid fa-book',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'sales--reports-client-balances',
        label: $localize`:@@core.app-navigation.registry.ts.solde.par.client.dc39ad70:Solde par client`,
        route: '/reports/client-balances',
        icon: 'fa-solid fa-wallet',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'sales--reports-analytics',
        label: $localize`:@@core.app-navigation.registry.ts.etats.analytiques.23bcc707:États analytiques`,
        route: '/reports/analytics',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'sales--reports-sales',
        label: $localize`:@@core.app-navigation.registry.ts.rapports.db7d9fbb:Rapports`,
        route: '/reports/sales',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'sales--reports-profit',
        label: $localize`:@@core.app-navigation.registry.ts.rapport.benefices.245eba08:Rapport Bénéfices`,
        route: '/reports/profit',
        icon: 'fa-solid fa-percent',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read'],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'purchases',
    label: $localize`:@@core.app-navigation.registry.ts.achats.ee5b078c:Achats`,
    icon: 'fa-solid fa-cart-shopping',
    tourId: 'achats',
    children: [
      {
        id: 'purchases--ai-assistant-achats',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.achats.47e3b98a:Assistant Achats`,
        route: '/ai-assistant/achats',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Purchases, M.AI],
        permissionsAll: ['ai:chat', 'purchase_orders:read']
      },
      {
        id: 'purchases--suppliers',
        label: $localize`:@@core.app-navigation.registry.ts.fournisseurs.06b6d88c:Fournisseurs`,
        route: '/suppliers',
        icon: 'fa-solid fa-building',
        modules: [M.Purchases],
        permissionsAll: ['suppliers:read']
      },
      {
        id: 'purchases--purchase-orders',
        label: $localize`:@@core.app-navigation.registry.ts.bons.de.commande.aae719f0:Bons de commande`,
        route: '/purchase-orders',
        icon: 'fa-solid fa-file-lines',
        modules: [M.Purchases],
        permissionsAll: ['purchase_orders:read']
      },
      {
        id: 'purchases--purchase-receipts',
        label: $localize`:@@core.app-navigation.registry.ts.bons.de.reception.84d6ebb5:Bons de réception`,
        route: '/purchase-receipts',
        icon: 'fa-solid fa-dolly',
        modules: [M.Purchases],
        permissionsAll: ['purchase_receipts:read']
      },
      {
        id: 'purchases--supplier-invoices',
        label: $localize`:@@core.app-navigation.registry.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs`,
        route: '/supplier-invoices',
        icon: 'fa-solid fa-money-bill-wave',
        modules: [M.Purchases],
        permissionsAll: ['supplier_invoices:read']
      },
      {
        id: 'purchases--invoices-unpaid',
        label: $localize`:@@core.app-navigation.registry.ts.factures.impayees.dc3cffa5:Factures impayées`,
        route: '/supplier-invoices/unpaid',
        icon: 'fa-solid fa-circle-exclamation',
        modules: [M.Purchases],
        permissionsAll: ['supplier_invoices:read']
      },
      {
        id: 'purchases--purchases-journal',
        label: $localize`:@@core.app-navigation.registry.ts.journal.dachats.pj1a2b3c:Journal d'achats`,
        route: '/reports/purchases-journal',
        icon: 'fa-solid fa-book',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'supplier_invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'purchases--reports-supplier-balances',
        label: $localize`:@@core.app-navigation.registry.ts.solde.par.fournisseur.7b26b81c:Solde par fournisseur`,
        route: '/reports/supplier-balances',
        icon: 'fa-solid fa-wallet',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'supplier_invoices:read'],
        navGroup: 'reports'
      },
      {
        id: 'purchases--reports-analytics',
        label: $localize`:@@core.app-navigation.registry.ts.etats.analytiques.23bcc707:États analytiques`,
        route: '/reports/purchases-analytics',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'suppliers:read'],
        navGroup: 'reports'
      },
      {
        id: 'purchases--reports-sales',
        label: $localize`:@@core.app-navigation.registry.ts.rapports.db7d9fbb:Rapports`,
        route: '/reports/purchases',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'suppliers:read'],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'records',
    label: $localize`:@@core.app-navigation.registry.ts.fiches.c513967c:Fiches`,
    icon: 'fa-regular fa-folder-open',
    tourId: 'fiches',
    children: [
      {
        id: 'records--clients',
        label: $localize`:@@core.app-navigation.registry.ts.clients.28e22fe3:Clients`,
        route: '/clients',
        icon: 'fa-solid fa-users',
        modules: [M.Clients],
        permissionsAll: ['clients:read']
      },
      {
        id: 'records--products',
        label: $localize`:@@core.app-navigation.registry.ts.produits.48000473:Produits`,
        route: '/products',
        icon: 'fa-solid fa-cube',
        modules: [M.Products],
        permissionsAll: ['products:read']
      },
      {
        id: 'records--product-categories',
        label: $localize`:@@core.app-navigation.registry.ts.categories.d463d7d2:Catégories`,
        route: '/product-categories',
        icon: 'fa-solid fa-tags',
        modules: [M.Products],
        permissionsAll: ['products:read']
      },
      {
        id: 'records--reports-sales',
        label: $localize`:@@core.app-navigation.registry.ts.rapports.db7d9fbb:Rapports`,
        route: '/reports/fiches',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports],
        permissionsAll: ['reports:view'],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'stock',
    label: $localize`:@@core.app-navigation.registry.ts.stock.bcecf456:Stock`,
    icon: 'fa-solid fa-boxes-stacked',
    tourId: 'stock',
    children: [
      {
        id: 'stock--ai-assistant-stock',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.stock.b01a4439:Assistant Stock`,
        route: '/ai-assistant/stock',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Stock, M.AI],
        permissionsAll: ['ai:chat', 'stock:read']
      },
      {
        id: 'stock--stock',
        label: $localize`:@@core.app-navigation.registry.ts.gestion.de.stock.3f196b66:Gestion de stock`,
        route: '/stock',
        icon: 'fa-solid fa-boxes-stacked',
        modules: [M.Stock],
        permissionsAll: ['stock:read']
      },
      {
        id: 'stock--stock-entries',
        label: $localize`:@@core.app-navigation.registry.ts.bons.d.entree.c04705f1:Bons d'entrée`,
        route: '/stock/entries',
        icon: 'fa-solid fa-arrow-down',
        modules: [M.Stock],
        permissionsAll: ['stock_vouchers:read']
      },
      {
        id: 'stock--stock-issues',
        label: $localize`:@@core.app-navigation.registry.ts.bons.de.sortie.ccd59bed:Bons de sortie`,
        route: '/stock/issues',
        icon: 'fa-solid fa-arrow-up',
        modules: [M.Stock],
        permissionsAll: ['stock_vouchers:read']
      },
      {
        id: 'stock--transfers',
        label: $localize`:@@core.app-navigation.registry.ts.transferts.f2783f95:Transferts`,
        route: '/transfers',
        icon: 'fa-solid fa-right-left',
        modules: [M.Stock],
        permissionsAll: ['stock_transfers:read']
      },
      {
        id: 'stock--inventory',
        label: $localize`:@@core.app-navigation.registry.ts.inventaire.10ad1a54:Inventaire`,
        route: '/inventory',
        icon: 'fa-solid fa-clipboard-list',
        modules: [M.Stock],
        permissionsAll: ['inventory:read']
      },
      {
        id: 'stock--inventory-wizard',
        label: $localize`:@@core.app-navigation.registry.ts.mode.assistant.3e961eb5:Mode assistant`,
        route: '/inventory/wizard',
        icon: 'fa-solid fa-list-ol',
        modules: [M.Stock],
        permissionsAll: ['inventory:read']
      },
      {
        id: 'stock--stock-status',
        label: $localize`:@@core.app-navigation.registry.ts.etat.de.stock.7c4e2a91:État de stock`,
        route: '/reports/stock-status',
        icon: 'fa-solid fa-table-list',
        modules: [M.Reports, M.Stock],
        permissionsAll: ['reports:view', 'stock:read'],
        navGroup: 'reports'
      },
      {
        id: 'stock--reports-sales',
        label: $localize`:@@core.app-navigation.registry.ts.rapports.db7d9fbb:Rapports`,
        route: '/reports/stock',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Stock],
        permissionsAll: ['reports:view', 'stock:read'],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'treasury',
    label: $localize`:@@core.app-navigation.registry.ts.tresorerie.e0e75da7:Trésorerie`,
    icon: 'fa-solid fa-credit-card',
    tourId: 'tresorerie',
    children: [
      {
        id: 'treasury--treasury-cash-forecast',
        label: $localize`:@@core.app-navigation.registry.ts.tresorerie.previsionnelle.0fa48711:Trésorerie prévisionnelle`,
        route: '/treasury/cash-forecast',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Treasury],
        permissionsAll: [PERMISSIONS.treasuryForecast.view]
      },
      {
        id: 'treasury--ai-assistant-tresorerie',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.tresorerie.8300f9a9:Assistant Trésorerie`,
        route: '/ai-assistant/tresorerie',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Treasury, M.AI],
        permissionsAll: ['ai:chat', 'payments:read']
      },
      {
        id: 'treasury--payments-cash-desk',
        label: $localize`:@@core.app-navigation.registry.ts.caisse.ce5a5c98:Caisse`,
        route: '/payments/cash-desk',
        icon: 'fa-solid fa-building-columns',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        id: 'treasury--payments-bank-accounts',
        label: $localize`:@@core.app-navigation.registry.ts.comptes.bancaires.3af6caeb:Comptes bancaires`,
        route: '/payments/bank-accounts',
        icon: 'fa-solid fa-building-columns',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        id: 'treasury--payments-clients',
        label: $localize`:@@core.app-navigation.registry.ts.paiements.clients.79a7e359:Paiements clients`,
        route: '/payments/clients',
        icon: 'fa-solid fa-credit-card',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        id: 'treasury--payments-suppliers',
        label: $localize`:@@core.app-navigation.registry.ts.paiements.fournisseurs.416577a5:Paiements fournisseurs`,
        route: '/payments/suppliers',
        icon: 'fa-solid fa-building',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        id: 'treasury--payments-cash-journal',
        label: $localize`:@@core.nav.treasury.payments-cash-journal:Journal de trésorerie`,
        route: '/payments/cash-journal',
        icon: 'fa-solid fa-book',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        id: 'treasury--reports-sales',
        label: $localize`:@@core.app-navigation.registry.ts.rapports.db7d9fbb:Rapports`,
        route: '/reports/payments',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Treasury],
        permissionsAll: ['reports:view', 'payments:read'],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'crm',
    label: $localize`:@@core.app-navigation.registry.ts.crm.commercial.96a9fcf3:CRM Commercial`,
    icon: 'fa-solid fa-handshake',
    children: [
      {
        id: 'crm--ai-assistant-crm',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.crm.a6f233a6:Assistant CRM`,
        route: '/ai-assistant/crm',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.CRM, M.AI],
        permissionsAll: ['ai:chat', 'crm:read']
      },
      {
        id: 'crm--crm-dashboard',
        label: $localize`:@@core.app-navigation.registry.ts.tableau.de.bord.a524057f:Tableau de bord`,
        route: '/crm/dashboard',
        icon: 'fa-solid fa-gauge-high',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        id: 'crm--crm-opportunities',
        label: $localize`:@@core.app-navigation.registry.ts.opportunites.0dbfa3c5:Opportunités`,
        route: '/crm/opportunities',
        icon: 'fa-solid fa-filter-circle-dollar',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        id: 'crm--crm-activities',
        label: $localize`:@@core.app-navigation.registry.ts.activites.9c1f6186:Activités`,
        route: '/crm/activities',
        icon: 'fa-solid fa-list-check',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        id: 'crm--crm-targets',
        label: $localize`:@@core.app-navigation.registry.ts.objectifs.57028307:Objectifs`,
        route: '/crm/targets',
        icon: 'fa-solid fa-chart-line',
        modules: [M.CRM],
        permissionsAll: ['sales_targets:read']
      },
      {
        id: 'crm--crm-quote-templates',
        label: $localize`:@@core.app-navigation.registry.ts.modeles.de.devis.b90f004d:Modèles de devis`,
        route: '/crm/quote-templates',
        icon: 'fa-solid fa-file-lines',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      }
    ]
  },
  {
    id: 'projects',
    label: $localize`:@@core.app-navigation.registry.ts.projets.b1e8cd4d:Projets`,
    icon: 'fa-solid fa-diagram-project',
    children: [
      {
        id: 'projects--crm-dashboard',
        label: $localize`:@@core.app-navigation.registry.ts.tableau.de.bord.a524057f:Tableau de bord`,
        route: '/projects/dashboard',
        icon: 'fa-solid fa-chart-pie',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projects.read]
      },
      {
        id: 'projects--projects',
        label: $localize`:@@core.app-navigation.registry.ts.liste.des.projets.7f394c5f:Liste des projets`,
        route: '/projects',
        icon: 'fa-solid fa-list',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projects.read]
      },
      {
        id: 'projects--timesheets',
        label: $localize`:@@core.app-navigation.registry.ts.mes.feuilles.de.temps.50923fd1:Mes feuilles de temps`,
        route: '/timesheets',
        icon: 'fa-solid fa-clock',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projectTime.read]
      }
    ]
  },
  {
    id: 'fiscal-tej',
    label: $localize`:@@core.app-navigation.registry.ts.fiscal.tej.1a1e125b:Fiscal / TEJ`,
    icon: 'fa-solid fa-file-invoice-dollar',
    children: [
      {
        id: 'fiscal-tej--crm-dashboard',
        label: $localize`:@@core.app-navigation.registry.ts.tableau.de.bord.a524057f:Tableau de bord`,
        route: '/withholding-tax/dashboard',
        icon: 'fa-solid fa-gauge-high',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:read']
      },
      {
        id: 'fiscal-tej--withholding-tax-tej-export',
        label: $localize`:@@core.app-navigation.registry.ts.export.tej.c237f45b:Export TEJ`,
        route: '/withholding-tax/tej-export',
        icon: 'fa-solid fa-file-export',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:export']
      },
      {
        id: 'fiscal-tej--withholding-tax-settings',
        label: $localize`:@@core.app-navigation.registry.ts.types.de.retenue.b0d657ed:Types de retenue`,
        route: '/withholding-tax/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:read']
      }
    ]
  },
  {
    id: 'hr-payroll',
    label: $localize`:@@core.app-navigation.registry.ts.rh.paie.615f4eb1:RH & Paie`,
    icon: 'fa-solid fa-users-gear',
    children: [
      {
        id: 'hr-payroll--payroll-employees',
        label: $localize`:@@core.app-navigation.registry.ts.salaries.ce68387d:Salariés`,
        route: '/payroll/employees',
        icon: 'fa-solid fa-id-card',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        id: 'hr-payroll--payroll-runs',
        label: $localize`:@@core.app-navigation.registry.ts.cycles.de.paie.ea07b457:Cycles de paie`,
        route: '/payroll/runs',
        icon: 'fa-solid fa-calendar-check',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        id: 'hr-payroll--payroll-regularization',
        label: $localize`:@@core.app-navigation.registry.ts.regularisation.irpp.da08474d:Régularisation IRPP`,
        route: '/payroll/regularization',
        icon: 'fa-solid fa-scale-balanced',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        id: 'hr-payroll--payroll-terminations',
        label: $localize`:@@core.app-navigation.registry.ts.soldes.de.tout.compte.afe34b92:Soldes de tout compte`,
        route: '/payroll/terminations',
        icon: 'fa-solid fa-file-signature',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        id: 'hr-payroll--payroll-declarations',
        label: $localize`:@@core.app-navigation.registry.ts.declarations.paie.135c2aa8:Déclarations paie`,
        route: '/payroll/declarations',
        icon: 'fa-solid fa-file-export',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.declare]
      },
      {
        id: 'hr-payroll--payroll-settings',
        label: $localize`:@@core.app-navigation.registry.ts.parametres.paie.89296f29:Paramètres paie`,
        route: '/payroll/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      },
      {
        id: 'hr-payroll--payroll-settings-holidays',
        label: $localize`:@@core.app-navigation.registry.ts.jours.feries.6ba43434:Jours fériés`,
        route: '/payroll/settings/holidays',
        icon: 'fa-solid fa-calendar-day',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      },
      {
        id: 'hr-payroll--payroll-settings-annual-bonuses',
        label: $localize`:@@core.app-navigation.registry.ts.primes.annuelles.c20c4756:Primes annuelles`,
        route: '/payroll/settings/annual-bonuses',
        icon: 'fa-solid fa-gift',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      },
      {
        id: 'hr-payroll--payroll-reports-payroll-book',
        label: $localize`:@@core.app-navigation.registry.ts.livre.de.paie.ccdfc623:Livre de paie`,
        route: '/payroll/reports/payroll-book',
        icon: 'fa-solid fa-book',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read],
        navGroup: 'reports'
      },
      {
        id: 'hr-payroll--payroll-reports-payroll-journal',
        label: $localize`:@@core.app-navigation.registry.ts.journal.de.paie.240f3575:Journal de paie`,
        route: '/payroll/reports/payroll-journal',
        icon: 'fa-solid fa-list-check',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read],
        navGroup: 'reports'
      }
    ]
  },
  {
    id: 'accounting',
    label: $localize`:@@core.app-navigation.registry.ts.comptabilite.20af7266:Comptabilité`,
    icon: 'fa-solid fa-calculator',
    tourId: 'comptabilite',
    children: [
      {
        id: 'accounting--ai-assistant-comptabilite',
        label: $localize`:@@core.app-navigation.registry.ts.assistant.comptabilite.74a43398:Assistant Comptabilité`,
        route: '/ai-assistant/comptabilite',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Accounting, M.AI],
        permissionsAll: ['ai:chat', 'accounting:read']
      },
      {
        id: 'accounting--accounting-home',
        label: $localize`:@@core.app-navigation.registry.ts.accueil.comptabilite.c3659c63:Accueil comptabilité`,
        route: '/accounting/home',
        icon: 'fa-solid fa-table-cells-large',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-chart',
        label: $localize`:@@core.app-navigation.registry.ts.plan.comptable.b3f54c09:Plan comptable`,
        route: '/accounting/chart',
        icon: 'fa-solid fa-sitemap',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-journals',
        label: $localize`:@@core.app-navigation.registry.ts.journaux.familles.31f7dca1:Journaux & familles`,
        route: '/accounting/journals',
        icon: 'fa-solid fa-book-bookmark',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-entry-templates',
        label: $localize`:@@core.app-navigation.registry.ts.modeles.d.ecriture.a2fb584f:Modèles d'écriture`,
        route: '/accounting/entry-templates',
        icon: 'fa-solid fa-clone',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-journal',
        label: $localize`:@@core.app-navigation.registry.ts.journal.57d7f743:Journal`,
        route: '/accounting/journal',
        icon: 'fa-solid fa-book',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-ledger',
        label: $localize`:@@core.app-navigation.registry.ts.grand.livre.7eef7547:Grand livre`,
        route: '/accounting/ledger',
        icon: 'fa-solid fa-book-open',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-sub-journals',
        label: $localize`:@@core.app-navigation.registry.ts.journaux.auxiliaires.a7120594:Journaux auxiliaires`,
        route: '/accounting/sub-journals',
        icon: 'fa-solid fa-book-bookmark',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-balance',
        label: $localize`:@@core.app-navigation.registry.ts.balance.90eef613:Balance`,
        route: '/accounting/balance',
        icon: 'fa-solid fa-scale-balanced',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-aging',
        label: $localize`:@@core.app-navigation.registry.ts.balance.agee.f6b2095b:Balance âgée`,
        route: '/accounting/aging',
        icon: 'fa-solid fa-clock',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-lettering',
        label: $localize`:@@core.app-navigation.registry.ts.lettrage.cfcdd333:Lettrage`,
        route: '/accounting/lettering',
        icon: 'fa-solid fa-link',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        id: 'accounting--accounting-entry-search',
        label: $localize`:@@core.app-navigation.registry.ts.recherche.d.ecriture.0a69c5f4:Recherche d'écriture`,
        route: '/accounting/entry-search',
        icon: 'fa-solid fa-magnifying-glass',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-account-replacement',
        label: $localize`:@@core.app-navigation.registry.ts.remplacement.de.compte.2fb8886e:Remplacement de compte`,
        route: '/accounting/account-replacement',
        icon: 'fa-solid fa-right-left',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        id: 'accounting--accounting-manual-entry',
        label: $localize`:@@core.app-navigation.registry.ts.saisie.manuelle.da81002e:Saisie manuelle`,
        route: '/accounting/manual-entry',
        icon: 'fa-solid fa-pen-to-square',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        id: 'accounting--accounting-import',
        label: $localize`:@@core.app-navigation.registry.ts.reprise.import.7f18694d:Reprise (import)`,
        route: '/accounting/import',
        icon: 'fa-solid fa-file-import',
        modules: [M.Accounting],
        permissionsAll: ['accounting:import']
      },
      {
        id: 'accounting--accounting-fixed-assets',
        label: $localize`:@@core.app-navigation.registry.ts.immobilisations.1e4cbe01:Immobilisations`,
        route: '/accounting/fixed-assets',
        icon: 'fa-solid fa-building',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-fixed-assets-amortization-table',
        label: $localize`:@@core.app-navigation.registry.ts.tableau.amortissements.0ddccc41:Tableau amortissements`,
        route: '/accounting/fixed-assets/amortization-table',
        icon: 'fa-solid fa-table-list',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-balance-sheet',
        label: $localize`:@@core.app-navigation.registry.ts.bilan.a80c4623:Bilan`,
        route: '/accounting/balance-sheet',
        icon: 'fa-solid fa-chart-pie',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-income-statement',
        label: $localize`:@@core.app-navigation.registry.ts.compte.de.resultat.a292527b:Compte de résultat`,
        route: '/accounting/income-statement',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-nct-statements',
        label: $localize`:@@core.app-navigation.registry.ts.etats.financiers.nct.a11800a0:États financiers NCT`,
        route: '/accounting/nct-statements',
        icon: 'fa-solid fa-file-contract',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-vat-declaration',
        label: $localize`:@@core.app-navigation.registry.ts.declarations.tva.aa8cc92d:Declarations · TVA`,
        route: '/accounting/vat-declaration',
        icon: 'fa-solid fa-file-invoice',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--accounting-fiscal-schedule',
        label: $localize`:@@core.app-navigation.registry.ts.declarations.echeancier.84cc36cc:Declarations · Echeancier`,
        route: '/accounting/fiscal-schedule',
        icon: 'fa-solid fa-calendar-days',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        id: 'accounting--treasury',
        label: $localize`:@@core.app-navigation.registry.ts.declarations.paiements.623d2441:Declarations · Paiements`,
        route: '/treasury',
        icon: 'fa-solid fa-money-check-dollar',
        modules: [M.Treasury],
        // `/treasury` redirige vers `/treasury/cash-forecast`, gardée par `treasury_forecast:view`
        // (permission.guard + layout-module-policy.ts). `treasury:read` n'existe dans aucune
        // policy backend : cette entrée était donc invisible pour tout le monde (bug corrigé).
        permissionsAll: [PERMISSIONS.treasuryForecast.view]
      },
      {
        id: 'accounting--accounting-closing',
        label: $localize`:@@core.app-navigation.registry.ts.cloture.eb133909:Clôture`,
        route: '/accounting/closing',
        icon: 'fa-solid fa-lock',
        modules: [M.Accounting],
        permissionsAll: ['accounting:close']
      },
      {
        id: 'accounting--audit',
        label: $localize`:@@core.app-navigation.registry.ts.journal.d.audit.52309db1:Journal d'audit`,
        route: '/audit',
        icon: 'fa-solid fa-shield-halved',
        modules: [M.Accounting],
        permissionsAll: ['audit:read']
      }
    ]
  },
  {
    id: 'exchanges',
    label: $localize`:@@core.app-navigation.registry.ts.echanges.79c1bbdb:Échanges`,
    icon: 'fa-solid fa-comments',
    route: '/exchanges'
  },
  {
    id: 'assistance',
    label: $localize`:@@core.app-navigation.registry.ts.assistance.be6b37ba:Assistance`,
    icon: 'fa-solid fa-headset',
    route: '/assistance'
  },
  {
    id: 'settings',
    label: $localize`:@@core.app-navigation.registry.ts.parametres.ef8f0121:Paramètres`,
    icon: 'fa-solid fa-gear',
    tourId: 'settings',
    modules: [M.Administration],
    children: [
      {
        id: 'settings--settings',
        label: $localize`:@@core.app-navigation.registry.ts.parametres.generaux.23e36e56:Paramètres généraux`,
        route: '/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Administration],
        permissionsAll: ['settings:read'],
        platformSettingsOnly: true
      },
      {
        id: 'settings--settings-modules',
        label: $localize`:@@core.app-navigation.registry.ts.modules.04e9462c:Modules`,
        route: '/settings/modules',
        icon: 'fa-solid fa-th-large',
        modules: [M.Administration],
        permissionsAll: ['settings:update'],
        platformSettingsOnly: true
      },
      {
        id: 'settings--settings-promotions',
        label: $localize`:@@core.app-navigation.registry.ts.promotions.086e09b4:Promotions`,
        route: '/settings/promotions',
        icon: 'fa-solid fa-bullhorn',
        modules: [M.Sales],
        permissionsAll: ['pricing:read']
      },
      {
        id: 'settings--settings-variant-axes',
        label: $localize`:@@core.app-navigation.registry.ts.axes.de.variantes.dcc95d91:Axes de variantes`,
        route: VARIANT_AXES_PATH,
        icon: 'fa-solid fa-th-large',
        modules: [M.Products],
        permissionsAll: ['products:read'],
        platformSettingsOnly: true
      }
    ]
  }
];

const ROUTE_KEYWORDS: Record<string, string[]> = {
  '/dashboard': ['accueil', 'home', 'tableau'],
  '/stock': ['stock', 'entrepôt', 'dépôt'],
  '/stock/entries': ['bon entrée', 'BE', 'entrée stock'],
  '/stock/issues': ['bon sortie', 'BS', 'sortie stock', 'casse'],
  '/invoices': ['factures', 'facture', 'FAC', 'ventes'],
  '/invoices/unpaid': ['impayées', 'impayee', 'retard'],
  '/invoices/new': ['nouvelle facture', 'créer facture', 'ajouter facture'],
  '/invoices/credit-notes': ['avoir', 'avoirs', 'AVO', 'credit note', 'avoir de vente'],
  '/invoices/credit-note/new': ['nouvel avoir', 'créer avoir', 'ajouter avoir'],
  '/quotes': ['devis', 'DEV', 'proposition'],
  '/quotes/new': ['nouveau devis', 'créer devis', 'ajouter devis'],
  '/recurring-contracts': ['contrat récurrent', 'abonnement', 'subscription', 'récurrent'],
  '/delivery-notes': ['bon de livraison', 'BL', 'livraison'],
  '/delivery-notes/new': ['nouveau bon', 'créer livraison'],
  '/return-notes': ['bon de retour', 'BRT', 'retour'],
  '/return-notes/new': ['nouveau bon de retour', 'créer retour'],
  '/clients': ['client', 'mes clients', 'tiers'],
  '/products': ['produit', 'article', 'service'],
  '/suppliers': ['fournisseur', 'vendor'],
  '/payments': ['paiement', 'règlement', 'trésorerie'],
  '/reports': ['rapport', 'statistique', 'analytics'],
  '/reports/sales-journal': ['journal de ventes', 'journal ventes', 'lignes facture', 'articles vendus', 'يومية المبيعات', 'مبيعات', 'أسطر الفواتير'],
  '/reports/purchases-journal': ['journal achats', 'journal d achats', 'articles achetés', 'lignes facture fournisseur', 'bons de réception', 'يومية المشتريات', 'مشتريات', 'فواتير المزوّدين', 'وصولات الاستلام'],
  '/pos': ['caisse', 'point de vente', 'POS'],
  '/ai-assistant': ['assistant', 'IA', 'chat', 'intelligence'],
  '/withholding-tax/tej-export': ['TEJ', 'export fiscal', 'retenue'],
  '/accounting/journal': ['écriture', 'compta'],
  '/accounting/fiscal-schedule': ['echeancier', 'échéancier', 'fiscal', 'declaration', 'déclaration', 'rappel', 'echeance', 'échéance'],
  '/settings': ['paramètre', 'configuration', 'réglage'],
  '/settings/promotions': ['promotion', 'remise', 'réduction', 'offre', 'bullhorn'],
  [VARIANT_AXES_PATH]: ['axe', 'variante', 'attribut', 'taille', 'couleur', 'déclinaison', 'sku'],
  '/settings/payment-terms': ['condition', 'règlement', 'échéance', 'escompte', 'paiement', 'délai'],
  '/exchanges': ['échange', 'echanges', 'messagerie', 'réclamation', 'reclamation', 'demande', 'cabinet'],
  '/assistance': ['assistance', 'support', 'question', 'proposition', 'réclamation'],
  '/firm/exchanges': ['échange', 'echanges', 'messagerie', 'réclamation', 'cabinet', 'société']
};

const ROUTE_SEARCH_GROUP: Record<string, NavSearchGroup> = {
  '/reports': 'report',
  '/reports/sales': 'report',
  '/reports/sales-journal': 'report',
  '/reports/purchases-journal': 'report',
  '/reports/purchases': 'report',
  '/reports/fiches': 'report',
  '/reports/stock': 'report',
  '/reports/stock-status': 'report',
  '/reports/payments': 'report',
  '/reports/analytics': 'report',
  '/reports/purchases-analytics': 'report',
  '/reports/profit': 'report',
  '/settings': 'settings',
  '/settings/promotions': 'settings',
  [VARIANT_AXES_PATH]: 'settings'
};

function inferSearchGroup(route: string, parentLabel?: string): NavSearchGroup {
  if (route.startsWith('/documentation')) {
    return 'documentation';
  }
  if (route.endsWith('/new')) {
    return 'create';
  }
  if (ROUTE_SEARCH_GROUP[route]) {
    return ROUTE_SEARCH_GROUP[route];
  }
  if (parentLabel === 'Documentation') {
    return 'documentation';
  }
  if (route.includes('/reports')) {
    return 'report';
  }
  return 'page';
}

function routeToId(route: string): string {
  return route.replace(/^\//, '').replace(/\//g, '-') || 'root';
}

function childToSearchEntry(child: NavSubItem, parentLabel: string): NavSearchEntry | null {
  if (!child.route) {
    return null;
  }
  return {
    id: routeToId(child.route),
    label: child.label,
    route: child.route,
    icon: child.icon ?? 'fa-solid fa-circle',
    group: inferSearchGroup(child.route, parentLabel),
    breadcrumb: `${parentLabel} > ${child.label}`,
    keywords: ROUTE_KEYWORDS[child.route],
    modules: child.modules,
    permissionsAll: child.permissionsAll,
    platformSettingsOnly: child.platformSettingsOnly
  };
}

function topLevelToSearchEntry(item: NavItem): NavSearchEntry | null {
  if (!item.route) {
    return null;
  }
  return {
    id: routeToId(item.route),
    label: item.label,
    route: item.route,
    icon: item.icon ?? 'fa-solid fa-circle',
    group: inferSearchGroup(item.route),
    keywords: ROUTE_KEYWORDS[item.route],
    modules: item.modules,
    permissionsAll: item.permissionsAll,
    platformSettingsOnly: item.platformSettingsOnly
  };
}

export function buildFlatNavSearchEntries(): NavSearchEntry[] {
  const entries: NavSearchEntry[] = [];
  const seenRoutes = new Set<string>();

  const addEntry = (entry: NavSearchEntry): void => {
    if (seenRoutes.has(entry.route)) {
      return;
    }
    seenRoutes.add(entry.route);
    entries.push(entry);
  };

  for (const item of ALL_NAV_ITEMS) {
    if (item.children?.length) {
      for (const child of item.children) {
        const entry = childToSearchEntry(child, item.label);
        if (entry) {
          addEntry(entry);
        }
      }
    } else {
      const top = topLevelToSearchEntry(item);
      if (top) {
        addEntry(top);
      }
    }
  }

  for (const qa of QUICK_ACCESS_ITEMS) {
    if (!qa.route || seenRoutes.has(qa.route)) {
      continue;
    }
    addEntry({
      id: `qa-${routeToId(qa.route)}`,
      label: qa.label,
      route: qa.route,
      icon: qa.icon,
      group: qa.section === 'create' ? 'create' : 'page',
      keywords: ROUTE_KEYWORDS[qa.route],
      permissionsAll: [qa.permission]
    });
  }

  return entries;
}

export function getVisibleNavSearchEntries(auth: AuthService): NavSearchEntry[] {
  let entries = buildFlatNavSearchEntries().filter(entry => canSeeNavEntry(auth, entry));
  if (auth.isAccountingFirm() && auth.isDelegatedMode()) {
    entries = entries.filter(e => !isDelegatedFirmBlockedSalesPurchasesRoute(e.route));
  }
  if (isCompanyAccountingRestricted(auth)) {
    entries = filterCompanyAccountingSearchEntries(entries);
  }
  return entries;
}

function filterNavSubItems(auth: AuthService, children: NavSubItem[]): NavSubItem[] {
  const out: NavSubItem[] = [];
  for (const child of children) {
    if (!canSeeNavEntry(auth, child)) {
      continue;
    }
    if (child.children?.length) {
      const nested = filterNavSubItems(auth, child.children);
      // Keep hub parents that have their own route even if all nested children are filtered out.
      if (nested.length === 0 && !child.route) {
        continue;
      }
      out.push({ ...child, children: nested });
      continue;
    }
    out.push(child);
  }
  return out;
}

export function filterNavItems(auth: AuthService, items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.children?.length) {
      const children = filterNavSubItems(auth, item.children);
      if (children.length === 0) {
        continue;
      }
      out.push({ ...item, children });
    } else if (item.externalUrl) {
      out.push(item);
    } else if (item.route) {
      if (canSeeNavEntry(auth, item)) {
        out.push(item);
      }
    }
  }
  return out;
}

/** Additional create routes not in quick-access or sidebar. */
export const EXTRA_CREATE_ROUTES: NavSearchEntry[] = [
  {
    id: 'clients-new',
    label: $localize`:@@core.app-navigation.registry.ts.ajouter.un.client.1b5b4358:Ajouter un client`,
    route: '/clients/new',
    icon: 'fa-solid fa-user-plus',
    group: 'create',
    keywords: ['nouveau client', 'créer client'],
    permissionsAll: [PERMISSIONS.clients.create]
  },
  {
    id: 'products-new',
    label: $localize`:@@core.app-navigation.registry.ts.ajouter.un.produit.0f13c039:Ajouter un produit`,
    route: '/products/new',
    icon: 'fa-solid fa-plus',
    group: 'create',
    keywords: ['nouveau produit', 'créer produit'],
    permissionsAll: [PERMISSIONS.products.create]
  },
  {
    id: 'suppliers-new',
    label: $localize`:@@core.app-navigation.registry.ts.ajouter.un.fournisseur.cfb5e618:Ajouter un fournisseur`,
    route: '/suppliers/new',
    icon: 'fa-solid fa-building-circle-arrow-right',
    group: 'create',
    keywords: ['nouveau fournisseur'],
    permissionsAll: [PERMISSIONS.suppliers.create]
  }
];

export function getAllNavSearchEntries(auth: AuthService): NavSearchEntry[] {
  const base = getVisibleNavSearchEntries(auth);
  const seen = new Set(base.map(e => e.route));
  const delegatedFirm = auth.isAccountingFirm() && auth.isDelegatedMode();
  for (const extra of EXTRA_CREATE_ROUTES) {
    if (delegatedFirm && isDelegatedFirmBlockedSalesPurchasesRoute(extra.route)) {
      continue;
    }
    if (!seen.has(extra.route) && canSeeNavEntry(auth, extra)) {
      base.push(extra);
    }
  }
  return base;
}
