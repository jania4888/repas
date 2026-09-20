import { AppModule } from '../models/app-module';
import { AI_ASSISTANT_MARK_SRC } from '../constants/ai-assistant-brand';
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
  /** One nesting level max (e.g. secondary-nav flyout). UI must not recurse further. */
  children?: NavSubItem[];
}

export interface NavItem {
  label: string;
  icon?: string;
  railIconAsset?: string;
  route?: string;
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
  { label: 'Tableau de bord', icon: 'fa-solid fa-gauge-high', route: '/dashboard', tourId: 'dashboard' },
  {
    label: 'Assistant IA',
    railIconAsset: AI_ASSISTANT_MARK_SRC,
    route: '/ai-assistant',
    tourId: 'ai-assistant',
    modules: [M.AI],
    permissionsAll: ['ai:chat']
  },
  {
    label: 'Prévisions IA',
    icon: 'fa-solid fa-chart-line',
    modules: [M.Forecasting],
    permissionsAll: ['forecasting:view'],
    children: [
      {
        label: 'Prévisions CA',
        route: '/forecasting/revenue',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        label: 'Réapprovisionnement',
        route: '/forecasting/replenishment',
        icon: 'fa-solid fa-truck-ramp-box',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        label: 'Promotions suggérées',
        route: '/forecasting/promotions',
        icon: 'fa-solid fa-tags',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      },
      {
        label: 'Matrice ABC × XYZ',
        route: '/forecasting/abc-xyz',
        icon: 'fa-solid fa-table-cells',
        modules: [M.Forecasting],
        permissionsAll: ['forecasting:view']
      }
    ]
  },
  {
    label: 'Point de Vente',
    icon: 'fa-solid fa-cash-register',
    route: '/pos',
    modules: [M.Sales, M.Products, M.Stock],
    permissionsAll: ['invoices:create', 'products:read', 'stock:read']
  },
  {
    label: 'Ventes',
    icon: 'fa-solid fa-bag-shopping',
    tourId: 'ventes',
    children: [
      {
        label: 'Assistant Ventes',
        route: '/ai-assistant/ventes',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Sales, M.AI],
        permissionsAll: ['ai:chat', 'invoices:read']
      },
      {
        label: 'Devis',
        route: '/quotes',
        icon: 'fa-solid fa-file-lines',
        modules: [M.Sales],
        permissionsAll: ['quotes:read']
      },
      {
        label: 'Commandes clients',
        route: '/sales-orders',
        icon: 'fa-solid fa-cart-shopping',
        modules: [M.Sales],
        permissionsAll: ['sales_orders:read']
      },
      {
        label: 'Bon de Livraison',
        route: '/delivery-notes',
        icon: 'fa-solid fa-truck',
        modules: [M.Sales],
        permissionsAll: ['delivery_notes:read']
      },
      {
        label: 'Bon de retour',
        route: '/return-notes',
        icon: 'fa-solid fa-rotate-left',
        modules: [M.Sales],
        permissionsAll: ['return_notes:read']
      },
      {
        label: 'Factures',
        route: '/invoices',
        icon: 'fa-solid fa-file',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        label: 'Avoir de vente',
        route: '/invoices/credit-notes',
        icon: 'fa-solid fa-receipt',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        label: 'Factures impayées',
        route: '/invoices/unpaid',
        icon: 'fa-solid fa-circle-exclamation',
        modules: [M.Sales],
        permissionsAll: ['invoices:read']
      },
      {
        label: 'Contrats récurrents',
        route: '/recurring-contracts',
        icon: 'fa-solid fa-arrows-rotate',
        modules: [M.RecurringContracts],
        permissionsAll: [PERMISSIONS.recurringContracts.read]
      },
      {
        label: 'Solde par client',
        route: '/reports/client-balances',
        icon: 'fa-solid fa-wallet',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read']
      },
      {
        label: 'États analytiques',
        route: '/reports/analytics',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read']
      },
      {
        label: 'Rapports',
        route: '/reports/sales',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read']
      },
      {
        label: 'Rapport Bénéfices',
        route: '/reports/profit',
        icon: 'fa-solid fa-percent',
        modules: [M.Reports, M.Sales],
        permissionsAll: ['reports:view', 'invoices:read']
      }
    ]
  },
  {
    label: 'Achats',
    icon: 'fa-solid fa-cart-shopping',
    tourId: 'achats',
    children: [
      {
        label: 'Assistant Achats',
        route: '/ai-assistant/achats',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Purchases, M.AI],
        permissionsAll: ['ai:chat', 'purchase_orders:read']
      },
      {
        label: 'Fournisseurs',
        route: '/suppliers',
        icon: 'fa-solid fa-building',
        modules: [M.Purchases],
        permissionsAll: ['suppliers:read']
      },
      {
        label: 'Bons de commande',
        route: '/purchase-orders',
        icon: 'fa-solid fa-file-lines',
        modules: [M.Purchases],
        permissionsAll: ['purchase_orders:read']
      },
      {
        label: 'Bons de réception',
        route: '/purchase-receipts',
        icon: 'fa-solid fa-dolly',
        modules: [M.Purchases],
        permissionsAll: ['purchase_receipts:read']
      },
      {
        label: 'Factures fournisseurs',
        route: '/supplier-invoices',
        icon: 'fa-solid fa-money-bill-wave',
        modules: [M.Purchases],
        permissionsAll: ['supplier_invoices:read']
      },
      {
        label: 'Factures impayées',
        route: '/supplier-invoices/unpaid',
        icon: 'fa-solid fa-circle-exclamation',
        modules: [M.Purchases],
        permissionsAll: ['supplier_invoices:read']
      },
      {
        label: 'Solde par fournisseur',
        route: '/reports/supplier-balances',
        icon: 'fa-solid fa-wallet',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'supplier_invoices:read']
      },
      {
        label: 'États analytiques',
        route: '/reports/purchases-analytics',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'suppliers:read']
      },
      {
        label: 'Rapports',
        route: '/reports/purchases',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Purchases],
        permissionsAll: ['reports:view', 'suppliers:read']
      }
    ]
  },
  {
    label: 'Fiches',
    icon: 'fa-regular fa-folder-open',
    tourId: 'fiches',
    children: [
      {
        label: 'Clients',
        route: '/clients',
        icon: 'fa-solid fa-users',
        modules: [M.Clients],
        permissionsAll: ['clients:read']
      },
      {
        label: 'Produits',
        route: '/products',
        icon: 'fa-solid fa-cube',
        modules: [M.Products],
        permissionsAll: ['products:read']
      },
      {
        label: 'Catégories',
        route: '/product-categories',
        icon: 'fa-solid fa-tags',
        modules: [M.Products],
        permissionsAll: ['products:read']
      },
      {
        label: 'Rapports',
        route: '/reports/fiches',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports],
        permissionsAll: ['reports:view']
      }
    ]
  },
  {
    label: 'Stock',
    icon: 'fa-solid fa-boxes-stacked',
    tourId: 'stock',
    children: [
      {
        label: 'Assistant Stock',
        route: '/ai-assistant/stock',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Stock, M.AI],
        permissionsAll: ['ai:chat', 'stock:read']
      },
      {
        label: 'Gestion de stock',
        route: '/stock',
        icon: 'fa-solid fa-boxes-stacked',
        modules: [M.Stock],
        permissionsAll: ['stock:read']
      },
      {
        label: "Bons d'entrée",
        route: '/stock/entries',
        icon: 'fa-solid fa-arrow-down',
        modules: [M.Stock],
        permissionsAll: ['stock_vouchers:read']
      },
      {
        label: 'Bons de sortie',
        route: '/stock/issues',
        icon: 'fa-solid fa-arrow-up',
        modules: [M.Stock],
        permissionsAll: ['stock_vouchers:read']
      },
      {
        label: 'Transferts',
        route: '/transfers',
        icon: 'fa-solid fa-right-left',
        modules: [M.Stock],
        permissionsAll: ['stock_transfers:read']
      },
      {
        label: 'Inventaire',
        route: '/inventory',
        icon: 'fa-solid fa-clipboard-list',
        modules: [M.Stock],
        permissionsAll: ['inventory:read']
      },
      {
        label: 'Mode assistant',
        route: '/inventory/wizard',
        icon: 'fa-solid fa-list-ol',
        modules: [M.Stock],
        permissionsAll: ['inventory:read']
      },
      {
        label: 'Rapports',
        route: '/reports/stock',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Stock],
        permissionsAll: ['reports:view', 'stock:read']
      }
    ]
  },
  {
    label: 'Trésorerie',
    icon: 'fa-solid fa-credit-card',
    tourId: 'tresorerie',
    children: [
      {
        label: 'Trésorerie prévisionnelle',
        route: '/treasury/cash-forecast',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Treasury],
        permissionsAll: [PERMISSIONS.treasuryForecast.view]
      },
      {
        label: 'Assistant Trésorerie',
        route: '/ai-assistant/tresorerie',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Treasury, M.AI],
        permissionsAll: ['ai:chat', 'payments:read']
      },
      {
        label: 'Caisse',
        route: '/payments/cash-desk',
        icon: 'fa-solid fa-building-columns',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        label: 'Comptes bancaires',
        route: '/payments/bank-accounts',
        icon: 'fa-solid fa-building-columns',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        label: 'Paiements clients',
        route: '/payments/clients',
        icon: 'fa-solid fa-credit-card',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        label: 'Paiements fournisseurs',
        route: '/payments/suppliers',
        icon: 'fa-solid fa-building',
        modules: [M.Treasury],
        permissionsAll: ['payments:read']
      },
      {
        label: 'Rapports',
        route: '/reports/payments',
        icon: 'fa-solid fa-chart-column',
        modules: [M.Reports, M.Treasury],
        permissionsAll: ['reports:view', 'payments:read']
      }
    ]
  },
  {
    label: 'CRM Commercial',
    icon: 'fa-solid fa-handshake',
    children: [
      {
        label: 'Assistant CRM',
        route: '/ai-assistant/crm',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.CRM, M.AI],
        permissionsAll: ['ai:chat', 'crm:read']
      },
      {
        label: 'Tableau de bord',
        route: '/crm/dashboard',
        icon: 'fa-solid fa-gauge-high',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        label: 'Opportunités',
        route: '/crm/opportunities',
        icon: 'fa-solid fa-filter-circle-dollar',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        label: 'Activités',
        route: '/crm/activities',
        icon: 'fa-solid fa-list-check',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      },
      {
        label: 'Objectifs',
        route: '/crm/targets',
        icon: 'fa-solid fa-chart-line',
        modules: [M.CRM],
        permissionsAll: ['sales_targets:read']
      },
      {
        label: 'Modèles de devis',
        route: '/crm/quote-templates',
        icon: 'fa-solid fa-file-lines',
        modules: [M.CRM],
        permissionsAll: ['crm:read']
      }
    ]
  },
  {
    label: 'Projets',
    icon: 'fa-solid fa-diagram-project',
    children: [
      {
        label: 'Tableau de bord',
        route: '/projects/dashboard',
        icon: 'fa-solid fa-chart-pie',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projects.read]
      },
      {
        label: 'Liste des projets',
        route: '/projects',
        icon: 'fa-solid fa-list',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projects.read]
      },
      {
        label: 'Mes feuilles de temps',
        route: '/timesheets',
        icon: 'fa-solid fa-clock',
        modules: [M.Projects],
        permissionsAll: [PERMISSIONS.projectTime.read]
      }
    ]
  },
  {
    label: 'Fiscal / TEJ',
    icon: 'fa-solid fa-file-invoice-dollar',
    children: [
      {
        label: 'Tableau de bord',
        route: '/withholding-tax/dashboard',
        icon: 'fa-solid fa-gauge-high',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:read']
      },
      {
        label: 'Export TEJ',
        route: '/withholding-tax/tej-export',
        icon: 'fa-solid fa-file-export',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:export']
      },
      {
        label: 'Types de retenue',
        route: '/withholding-tax/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Fiscal],
        permissionsAll: ['withholding_tax:read']
      }
    ]
  },
  {
    label: 'RH & Paie',
    icon: 'fa-solid fa-users-gear',
    children: [
      {
        label: 'Salariés',
        route: '/payroll/employees',
        icon: 'fa-solid fa-id-card',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Cycles de paie',
        route: '/payroll/runs',
        icon: 'fa-solid fa-calendar-check',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Régularisation IRPP',
        route: '/payroll/regularization',
        icon: 'fa-solid fa-scale-balanced',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Soldes de tout compte',
        route: '/payroll/terminations',
        icon: 'fa-solid fa-file-signature',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Livre de paie',
        route: '/payroll/reports/payroll-book',
        icon: 'fa-solid fa-book',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Journal de paie',
        route: '/payroll/reports/payroll-journal',
        icon: 'fa-solid fa-list-check',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.read]
      },
      {
        label: 'Déclarations paie',
        route: '/payroll/declarations',
        icon: 'fa-solid fa-file-export',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.declare]
      },
      {
        label: 'Paramètres paie',
        route: '/payroll/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      },
      {
        label: 'Jours fériés',
        route: '/payroll/settings/holidays',
        icon: 'fa-solid fa-calendar-day',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      },
      {
        label: 'Primes annuelles',
        route: '/payroll/settings/annual-bonuses',
        icon: 'fa-solid fa-gift',
        modules: [M.Payroll],
        permissionsAll: [PERMISSIONS.payroll.settings]
      }
    ]
  },
  {
    label: 'Comptabilité',
    icon: 'fa-solid fa-calculator',
    tourId: 'comptabilite',
    children: [
      {
        label: 'Assistant Comptabilité',
        route: '/ai-assistant/comptabilite',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [M.Accounting, M.AI],
        permissionsAll: ['ai:chat', 'accounting:read']
      },
      {
        label: 'Accueil comptabilité',
        route: '/accounting/home',
        icon: 'fa-solid fa-table-cells-large',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Plan comptable',
        route: '/accounting/chart',
        icon: 'fa-solid fa-sitemap',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Journaux & familles',
        route: '/accounting/journals',
        icon: 'fa-solid fa-book-bookmark',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: "Modèles d'écriture",
        route: '/accounting/entry-templates',
        icon: 'fa-solid fa-clone',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Journal',
        route: '/accounting/journal',
        icon: 'fa-solid fa-book',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Grand livre',
        route: '/accounting/ledger',
        icon: 'fa-solid fa-book-open',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Journaux auxiliaires',
        route: '/accounting/sub-journals',
        icon: 'fa-solid fa-book-bookmark',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Balance',
        route: '/accounting/balance',
        icon: 'fa-solid fa-scale-balanced',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Balance âgée',
        route: '/accounting/aging',
        icon: 'fa-solid fa-clock',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Lettrage',
        route: '/accounting/lettering',
        icon: 'fa-solid fa-link',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        label: "Recherche d'écriture",
        route: '/accounting/entry-search',
        icon: 'fa-solid fa-magnifying-glass',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Remplacement de compte',
        route: '/accounting/account-replacement',
        icon: 'fa-solid fa-right-left',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        label: 'Saisie manuelle',
        route: '/accounting/manual-entry',
        icon: 'fa-solid fa-pen-to-square',
        modules: [M.Accounting],
        permissionsAll: ['accounting:create']
      },
      {
        label: 'Reprise (import)',
        route: '/accounting/import',
        icon: 'fa-solid fa-file-import',
        modules: [M.Accounting],
        permissionsAll: ['accounting:import']
      },
      {
        label: 'Immobilisations',
        route: '/accounting/fixed-assets',
        icon: 'fa-solid fa-building',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Tableau amortissements',
        route: '/accounting/fixed-assets/amortization-table',
        icon: 'fa-solid fa-table-list',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Bilan',
        route: '/accounting/balance-sheet',
        icon: 'fa-solid fa-chart-pie',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Compte de résultat',
        route: '/accounting/income-statement',
        icon: 'fa-solid fa-chart-line',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'États financiers NCT',
        route: '/accounting/nct-statements',
        icon: 'fa-solid fa-file-contract',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Declarations · TVA',
        route: '/accounting/vat-declaration',
        icon: 'fa-solid fa-file-invoice',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Declarations · Echeancier',
        route: '/accounting/fiscal-schedule',
        icon: 'fa-solid fa-calendar-days',
        modules: [M.Accounting],
        permissionsAll: ['accounting:read']
      },
      {
        label: 'Declarations · Paiements',
        route: '/treasury',
        icon: 'fa-solid fa-money-check-dollar',
        modules: [M.Treasury],
        // `/treasury` redirige vers `/treasury/cash-forecast`, gardée par `treasury_forecast:view`
        // (permission.guard + layout-module-policy.ts). `treasury:read` n'existe dans aucune
        // policy backend : cette entrée était donc invisible pour tout le monde (bug corrigé).
        permissionsAll: [PERMISSIONS.treasuryForecast.view]
      },
      {
        label: 'Clôture',
        route: '/accounting/closing',
        icon: 'fa-solid fa-lock',
        modules: [M.Accounting],
        permissionsAll: ['accounting:close']
      },
      {
        label: "Journal d'audit",
        route: '/audit',
        icon: 'fa-solid fa-shield-halved',
        modules: [M.Accounting],
        permissionsAll: ['audit:read']
      }
    ]
  },
  {
    label: 'Échanges',
    icon: 'fa-solid fa-comments',
    route: '/exchanges'
  },
  {
    label: 'Paramètres',
    icon: 'fa-solid fa-gear',
    tourId: 'settings',
    modules: [M.Administration],
    children: [
      {
        label: 'Paramètres généraux',
        route: '/settings',
        icon: 'fa-solid fa-sliders',
        modules: [M.Administration],
        permissionsAll: ['settings:read'],
        platformSettingsOnly: true
      },
      {
        label: 'Modules',
        route: '/settings/modules',
        icon: 'fa-solid fa-th-large',
        modules: [M.Administration],
        permissionsAll: ['settings:update'],
        platformSettingsOnly: true
      },
      {
        label: 'Promotions',
        route: '/settings/promotions',
        icon: 'fa-solid fa-bullhorn',
        modules: [M.Sales],
        permissionsAll: ['pricing:read']
      },
      {
        label: 'Axes de variantes',
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
  '/firm/exchanges': ['échange', 'echanges', 'messagerie', 'réclamation', 'cabinet', 'société']
};

const ROUTE_SEARCH_GROUP: Record<string, NavSearchGroup> = {
  '/reports': 'report',
  '/reports/sales': 'report',
  '/reports/purchases': 'report',
  '/reports/fiches': 'report',
  '/reports/stock': 'report',
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
    label: 'Ajouter un client',
    route: '/clients/new',
    icon: 'fa-solid fa-user-plus',
    group: 'create',
    keywords: ['nouveau client', 'créer client'],
    permissionsAll: [PERMISSIONS.clients.create]
  },
  {
    id: 'products-new',
    label: 'Ajouter un produit',
    route: '/products/new',
    icon: 'fa-solid fa-plus',
    group: 'create',
    keywords: ['nouveau produit', 'créer produit'],
    permissionsAll: [PERMISSIONS.products.create]
  },
  {
    id: 'suppliers-new',
    label: 'Ajouter un fournisseur',
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
