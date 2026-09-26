import { AppModule as M } from '../models/app-module';
import { NavItem, NavSubItem } from './app-navigation.registry';
import { PERMISSIONS } from './permission-keys';

/**
 * Source unique des modules comptables « façon Axeane » (Configuration, Traitements, États,
 * Budgétaire, Declarations, Liasse fiscale, Gestion immobilisations). Consommée par :
 * - la page d'accueil Comptabilité à tuiles (`accounting-home.component`) ;
 * - le sidebar du cabinet en mode délégué (menus de premier niveau + sous-menus).
 * Toute évolution des fonctions comptables se fait ICI pour rester cohérente aux deux endroits.
 * Les modules listés dans `ACCOUNTING_HOME_HIDDEN_MODULE_TITLES` restent dans le catalogue mais
 * sont masqués des tuiles hub uniquement ; le rail cabinet délégué affiche Budgétaire et Declarations.
 */

export const ACCOUNTING_MODULE_ID = {
  configuration: 'acct-mod-configuration',
  treatments: 'acct-mod-treatments',
  etats: 'acct-mod-etats',
  budget: 'acct-mod-budget',
  declarations: 'acct-mod-declarations',
  liasse: 'acct-mod-liasse',
  fixedAssets: 'acct-mod-fixed-assets'
} as const;

export interface AccountingModuleLink {
  id: string;
  label: string;
  route: string;
  icon: string;
  /** Permissions TOUTES requises pour voir le lien. */
  perms: string[];
  /** Modules requis (défaut : [Accounting]). */
  modules?: M[];
}

export interface AccountingModuleDef {
  id: string;
  title: string;
  icon: string;
  description: string;
  links: AccountingModuleLink[];
}

export const ACCOUNTING_MODULES: AccountingModuleDef[] = [
  {
    id: 'acct-mod-configuration',
    title: 'Configuration',
    icon: 'fa-solid fa-sliders',
    description: 'Plan comptable, journaux et modèles',
    links: [
      {
        id: 'acct-link--ai-assistant-comptabilite',
        label: 'Assistant Comptabilité',
        route: '/ai-assistant/comptabilite',
        icon: 'fa-solid fa-wand-magic-sparkles',
        perms: ['ai:chat', 'accounting:read'],
        modules: [M.Accounting, M.AI]
      },
      { id: 'acct-link--accounting-chart', label: 'Plan comptable', route: '/accounting/chart', icon: 'fa-solid fa-sitemap', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-third-parties', label: 'Plan tiers', route: '/accounting/third-parties', icon: 'fa-solid fa-address-book', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-journals', label: 'Journaux & familles', route: '/accounting/journals', icon: 'fa-solid fa-book-bookmark', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-currencies', label: 'Gestion des devises', route: '/accounting/currencies', icon: 'fa-solid fa-coins', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-closing-revaluation', label: 'Réévaluation de clôture', route: '/accounting/closing-revaluation', icon: 'fa-solid fa-scale-unbalanced', perms: ['accounting:close'] },
      { id: 'acct-link--accounting-entry-templates', label: "Modèles d'écriture", route: '/accounting/entry-templates', icon: 'fa-solid fa-clone', perms: ['accounting:read'] }
    ]
  },
  {
    id: 'acct-mod-treatments',
    title: 'Traitements',
    icon: 'fa-solid fa-gears',
    description: 'Saisie, import, lettrage, rapprochement, clôture',
    links: [
      { id: 'acct-link--accounting-manual-entry', label: 'Saisie manuelle', route: '/accounting/manual-entry', icon: 'fa-solid fa-pen-to-square', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-inventory-assistant', label: "Assistant d'inventaire", route: '/accounting/inventory-assistant', icon: 'fa-solid fa-clipboard-list', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-import', label: 'Reprise (import)', route: '/accounting/import', icon: 'fa-solid fa-file-import', perms: ['accounting:import'] },
      { id: 'acct-link--accounting-lettering', label: 'Lettrage', route: '/accounting/lettering', icon: 'fa-solid fa-link', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-bank-reconciliation', label: 'Rapprochement bancaire', route: '/accounting/bank-reconciliation', icon: 'fa-solid fa-building-columns', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-entry-search', label: "Recherche d'écriture", route: '/accounting/entry-search', icon: 'fa-solid fa-magnifying-glass', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-account-replacement', label: 'Remplacement de compte', route: '/accounting/account-replacement', icon: 'fa-solid fa-right-left', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-pre-closing', label: 'Contrôles de pré-clôture', route: '/accounting/pre-closing', icon: 'fa-solid fa-list-check', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-health', label: "Contrôle d'intégrité & anomalies", route: '/accounting/health', icon: 'fa-solid fa-heart-pulse', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-draft-batch', label: 'Brouillons en lot', route: '/accounting/draft-batch', icon: 'fa-solid fa-layer-group', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-mass-reversal', label: 'Correction en lot (extourne)', route: '/accounting/mass-reversal', icon: 'fa-solid fa-rotate-left', perms: ['accounting:reverse'] },
      { id: 'acct-link--accounting-closing', label: 'Clôture', route: '/accounting/closing', icon: 'fa-solid fa-lock', perms: ['accounting:close'] }
    ]
  },
  {
    id: 'acct-mod-etats',
    title: 'États',
    icon: 'fa-solid fa-table-list',
    description: 'Journal, grand livre, balance et bilans',
    links: [
      { id: 'acct-link--accounting-journal', label: 'Journal', route: '/accounting/journal', icon: 'fa-solid fa-book', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-ledger', label: 'Grand livre', route: '/accounting/ledger', icon: 'fa-solid fa-book-open', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-sub-journals', label: 'Journaux auxiliaires', route: '/accounting/sub-journals', icon: 'fa-solid fa-book-bookmark', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-journal-summary', label: 'Récapitulatifs journaux', route: '/accounting/journal-summary', icon: 'fa-solid fa-table-cells-large', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-balance', label: 'Balance', route: '/accounting/balance', icon: 'fa-solid fa-scale-balanced', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-auxiliary-balance', label: 'Balance auxiliaire', route: '/accounting/auxiliary-balance', icon: 'fa-solid fa-address-book', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-third-party-ledger', label: 'Grand livre tiers', route: '/accounting/third-party-ledger', icon: 'fa-solid fa-user-tag', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-aging', label: 'Balance âgée', route: '/accounting/aging', icon: 'fa-solid fa-clock', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-balance-sheet', label: 'Bilan', route: '/accounting/balance-sheet', icon: 'fa-solid fa-chart-pie', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-income-statement', label: 'Compte de résultat', route: '/accounting/income-statement', icon: 'fa-solid fa-chart-line', perms: ['accounting:read'] },
      { id: 'acct-link--audit', label: "Journal d'audit", route: '/audit', icon: 'fa-solid fa-shield-halved', perms: ['audit:read'] }
    ]
  },
  {
    id: 'acct-mod-budget',
    title: 'Budgétaire',
    icon: 'fa-solid fa-chart-column',
    description: 'Postes budgétaires, budgets et suivi réalisé/budget',
    links: [
      { id: 'acct-link--accounting-budget-posts', label: 'Postes budgétaires', route: '/accounting/budget-posts', icon: 'fa-solid fa-list-ol', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-budgets', label: 'Saisie des budgets', route: '/accounting/budgets', icon: 'fa-solid fa-table-cells', perms: ['accounting:create'] },
      { id: 'acct-link--accounting-budget-report', label: 'État budgétaire', route: '/accounting/budget-report', icon: 'fa-solid fa-chart-column', perms: ['accounting:read'] }
    ]
  },
  {
    id: 'acct-mod-declarations',
    title: 'Declarations',
    icon: 'fa-solid fa-file-signature',
    description: 'Declarations fiscales, echeancier et paiements',
    links: [
      { id: 'acct-link--accounting-vat-declaration', label: 'Declaration mensuelle', route: '/accounting/vat-declaration', icon: 'fa-solid fa-file-invoice', perms: ['accounting:read'] },
      // Paramétrage du calcul de la déclaration mensuelle. Volontairement dans « Declarations »
      // et non dans « États » : la liste des routes autorisées aux sociétés est construite à
      // partir des liens d'« États » (voir company-accounting-nav.config.ts), et cet écran est
      // réservé au cabinet.
      { id: 'acct-link--accounting-dm-configuration', label: 'Configuration DM', route: '/accounting/dm/configuration', icon: 'fa-solid fa-sliders', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-dm-calcul', label: 'Calcul DM', route: '/accounting/dm/calcul', icon: 'fa-solid fa-calculator', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-dm-suivi', label: 'Suivi DM', route: '/accounting/dm/suivi', icon: 'fa-solid fa-list-check', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-dm-modele', label: 'Modèle Intégration DM', route: '/accounting/dm/modele', icon: 'fa-solid fa-file-arrow-down', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-fiscal-schedule', label: 'Echeancier fiscal', route: '/accounting/fiscal-schedule', icon: 'fa-solid fa-calendar-days', perms: ['accounting:read'] },
      // `/treasury` redirige vers `/treasury/cash-forecast`, gardée par `treasury_forecast:view` ;
      // `treasury:read` n'existe dans aucune policy backend (lien invisible pour tout le monde, bug corrigé).
      { id: 'acct-link--treasury', label: 'Paiements et quittances', route: '/treasury', icon: 'fa-solid fa-money-check-dollar', perms: [PERMISSIONS.treasuryForecast.view] }
    ]
  },
  {
    id: 'acct-mod-liasse',
    title: 'Liasse fiscale',
    icon: 'fa-solid fa-file-contract',
    description: 'États financiers NCT + détermination du résultat fiscal',
    links: [
      { id: 'acct-link--accounting-nct-statements', label: 'États financiers NCT', route: '/accounting/nct-statements', icon: 'fa-solid fa-file-contract', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-inventory-book', label: "Livre d'inventaire", route: '/accounting/inventory-book', icon: 'fa-solid fa-book-bookmark', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-fiscal-result', label: 'Détermination du résultat fiscal', route: '/accounting/fiscal-result', icon: 'fa-solid fa-scale-balanced', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-fiscal-parameters', label: 'Paramètres fiscaux', route: '/accounting/fiscal-parameters', icon: 'fa-solid fa-sliders', perms: ['accounting:read'] }
    ]
  },
  {
    id: ACCOUNTING_MODULE_ID.fixedAssets,
    // Titre conservé tel quel : il est asservi par accounting-modules.config.spec.ts et
    // sidebar.component.spec.ts — le renommer casserait des tests existants.
    title: 'Gestion immobilisations',
    icon: 'fa-solid fa-building',
    description: 'Registres, dotations et tableaux d’amortissement (immobilisations et emprunts)',
    links: [
      { id: 'acct-link--accounting-fixed-assets', label: 'Immobilisations', route: '/accounting/fixed-assets', icon: 'fa-solid fa-building', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-fixed-assets-depreciation-run', label: 'Dotations', route: '/accounting/fixed-assets/depreciation-run', icon: 'fa-solid fa-calendar-check', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-fixed-assets-amortization-table', label: 'Tableau amortissements', route: '/accounting/fixed-assets/amortization-table', icon: 'fa-solid fa-table-list', perms: ['accounting:read'] },
      { id: 'acct-link--accounting-loans', label: 'Emprunts', route: '/accounting/loans', icon: 'fa-solid fa-hand-holding-dollar', perms: ['accounting:read'] }
    ]
  }
];

/** Modules masqués des tuiles hub Comptabilité (/accounting/home) uniquement. */
export const ACCOUNTING_HOME_HIDDEN_MODULE_IDS: ReadonlySet<string> = new Set([
  ACCOUNTING_MODULE_ID.budget,
  ACCOUNTING_MODULE_ID.declarations
]);

/** Modules masqués dans le rail sidebar cabinet (mode dossier client). */
export const FIRM_DELEGATED_HIDDEN_ACCOUNTING_MODULE_IDS: ReadonlySet<string> = new Set([
  ACCOUNTING_MODULE_ID.configuration,
  ACCOUNTING_MODULE_ID.treatments,
  ACCOUNTING_MODULE_ID.etats,
  ACCOUNTING_MODULE_ID.liasse
]);

export function isAccountingModuleHiddenFromHome(moduleId: string): boolean {
  return ACCOUNTING_HOME_HIDDEN_MODULE_IDS.has(moduleId);
}

export function getFirmDelegatedAccountingModules(): AccountingModuleDef[] {
  return ACCOUNTING_MODULES.filter(m => !FIRM_DELEGATED_HIDDEN_ACCOUNTING_MODULE_IDS.has(m.id));
}

function linkId(route: string): string {
  return `acct-link--${route.replace(/^\//, '').replace(/\//g, '-')}`;
}

function mapModulesToNavItems(modules: AccountingModuleDef[]): NavItem[] {
  return modules.map(mod => ({
    id: mod.id,
    label: mod.title,
    icon: mod.icon,
    children: mod.links.map<NavSubItem>(link => ({
      id: link.id,
      label: link.label,
      route: link.route,
      icon: link.icon,
      modules: link.modules ?? [M.Accounting],
      permissionsAll: link.perms
    }))
  }));
}

/**
 * Convertit les modules comptables en items de navigation (rail → sous-menu) pour le sidebar
 * du cabinet en mode délégué. À passer dans `filterNavItems` pour le gating modules/permissions.
 */
export function buildAccountingModuleNavItems(): NavItem[] {
  return mapModulesToNavItems(ACCOUNTING_MODULES);
}

/** Sous-ensemble des modules comptables visibles dans le rail sidebar cabinet délégué. */
export function buildFirmDelegatedAccountingModuleNavItems(): NavItem[] {
  return mapModulesToNavItems(getFirmDelegatedAccountingModules());
}
