import { AppModule as M } from '@core/models/app-module';
import { PERMISSIONS } from './permission-keys';
import { NavItem, NavSubItem } from './app-navigation.registry';
import { NAV_ID } from './nav-item-ids';



/** Cabinet home navigation (no client dossier selected). */

export const FIRM_NATIVE_NAV: NavItem[] = [

  {

    label: $localize`:@@core.firm-navigation.registry.ts.tableau.de.bord.a524057f:Tableau de bord`,

    icon: 'fa-solid fa-gauge-high',

    route: '/firm/dashboard',

    tourId: 'dashboard'

  },

  {

    // Agent « Chef de mission ». Volontairement hors du périmètre Gouvernance : il ne doit pas
    // disparaître avec ce flag, et ne perturbe pas l'ordre attendu des routes de gouvernance.
    label: $localize`:@@core.firm-navigation.registry.ts.chef.de.mission.93d4fc86:Chef de mission`,

    icon: 'fa-solid fa-user-tie',

    route: '/firm/assistant',

    tourId: 'chef-de-mission',

    permissionsAll: [PERMISSIONS.firmAi.chat]

  },

  {

    // Réviseur de portefeuille. Volontairement hors du périmètre Gouvernance, comme « Chef de
    // mission » : il a son propre drapeau et ne doit pas disparaître avec `firmGovernance`.
    label: $localize`:@@core.firm-navigation.registry.ts.revision.du.portefeuille.4b3f58da:Révision du portefeuille`,

    icon: 'fa-solid fa-clipboard-check',

    route: '/firm/revision',

    // Le back ne délivre `firm:revision:view` que si FirmRevisionEnabled est vrai : la permission
    // porte à la fois le droit de l'utilisateur et l'état du module côté serveur.
    permissionsAll: [PERMISSIONS.firmRevision.view]

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.mes.dossiers.clients.7ad4d1c3:Mes dossiers clients`,

    icon: 'fa-solid fa-briefcase',

    route: '/firm/clients',

    tourId: 'clients'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.echeancier.fiscal.193d9cef:Échéancier fiscal`,

    icon: 'fa-solid fa-calendar-days',

    route: '/firm/fiscal-schedule',

    tourId: 'fiscal-schedule'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.dossiers.permanents.eaddac81:Dossiers permanents`,

    route: '/firm/governance/permanent-files',

    icon: 'fa-solid fa-folder-open'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.affectation.des.dossiers.31b24b71:Affectation des dossiers`,

    route: '/firm/affectation',

    icon: 'fa-solid fa-user-tag',

    managerOnly: true

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.feuilles.de.temps.679cea6a:Feuilles de temps`,

    route: '/firm/governance/time-sheets',

    icon: 'fa-solid fa-clock'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.conges.absences.0af7002a:Congés & Absences`,

    route: '/firm/governance/leaves',

    icon: 'fa-solid fa-umbrella-beach'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.paie.interne.6bfc71d6:Paie interne`,

    route: '/firm/payroll',

    icon: 'fa-solid fa-file-invoice-dollar',

    // Le module n'est accordé que si la paie interne est activée pour le cabinet. Sans ce
    // gating, l'entrée s'affichait flag éteint et ne menait qu'à /access-denied.
    modules: [M.Payroll]

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.rentabilite.de.collaborateurs.e550b4b2:Rentabilité de collaborateurs`,

    icon: 'fa-solid fa-chart-pie',

    managerOnly: true,

    children: [

      {

        label: $localize`:@@core.firm-navigation.registry.ts.feuilles.de.temps.et.rentabilite.6ef065a8:Feuilles de temps et rentabilité`,

        route: '/firm/governance/dossier-time-profitability',

        icon: 'fa-solid fa-chart-line',

        managerOnly: true

      },

      {

        label: $localize`:@@core.firm-navigation.registry.ts.rentabilite.collaborateurs.9804577e:Rentabilité collaborateurs`,

        route: '/firm/governance/collaborator-rentability',

        icon: 'fa-solid fa-chart-pie',

        managerOnly: true

      },

      {

        label: $localize`:@@core.firm-navigation.registry.ts.couts.collaborateurs.f8ae9837:Coûts collaborateurs`,

        route: '/firm/governance/collaborator-costs',

        icon: 'fa-solid fa-coins',

        managerOnly: true

      }

    ]

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.notes.de.frais.dirigeants.816474a3:Notes de frais dirigeants`,

    route: '/firm/governance/expense-notes',

    icon: 'fa-solid fa-receipt'

  },

  {
    label: $localize`:@@core.firm-navigation.registry.ts.facturation.04716c6b:Facturation`,
    icon: 'fa-solid fa-file-invoice-dollar',
    managerOnly: true,
    modules: [M.Honoraires],
    permissionsAll: [PERMISSIONS.honorairesInvoices.read],
    children: [
      {
        label: $localize`:@@core.firm-navigation.registry.ts.factures.da35e4f2:Factures`,
        route: '/firm/billing/invoices',
        icon: 'fa-solid fa-file-invoice',
        managerOnly: true,
        modules: [M.Honoraires],
        permissionsAll: [PERMISSIONS.honorairesInvoices.read]
      },
      {
        label: $localize`:@@core.firm-navigation.registry.ts.avoirs.38b0e7b7:Avoirs`,
        route: '/firm/billing/credit-notes',
        icon: 'fa-solid fa-file-circle-minus',
        managerOnly: true,
        modules: [M.Honoraires],
        permissionsAll: [PERMISSIONS.honorairesInvoices.read]
      },
      {
        label: $localize`:@@core.firm-navigation.registry.ts.devis.f7622f90:Devis`,
        route: '/firm/billing/quotes',
        icon: 'fa-solid fa-file-lines',
        managerOnly: true,
        modules: [M.Honoraires],
        permissionsAll: [PERMISSIONS.honorairesQuotes.read]
      },
      {
        label: $localize`:@@core.firm-navigation.registry.ts.encaissements.598f53c9:Encaissements`,
        route: '/firm/billing/payments',
        icon: 'fa-solid fa-hand-holding-dollar',
        managerOnly: true,
        modules: [M.Honoraires],
        permissionsAll: [PERMISSIONS.honorairesPayments.read]
      }
    ]
  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.invitations.9b69a35a:Invitations`,

    icon: 'fa-solid fa-envelope-open-text',

    route: '/firm/invitations',

    tourId: 'invitations'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.echanges.79c1bbdb:Échanges`,

    icon: 'fa-solid fa-comments',

    route: '/firm/exchanges'

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.mon.cabinet.20598fad:Mon cabinet`,

    icon: 'fa-solid fa-building-columns',

    tourId: 'cabinet',

    children: [

      {

        label: $localize`:@@core.firm-navigation.registry.ts.collaborateurs.7eb2cd0e:Collaborateurs`,

        route: '/firm/collaborateurs',

        icon: 'fa-solid fa-users',

        managerOnly: true

      },

      {

        label: $localize`:@@core.firm-navigation.registry.ts.parametres.cabinet.ea488559:Paramètres cabinet`,

        route: '/firm/settings',

        icon: 'fa-solid fa-gear'

      },

      {

        label: $localize`:@@core.firm-navigation.registry.ts.mon.profil.faa6d321:Mon profil`,

        route: '/settings/profile',

        icon: 'fa-solid fa-user'

      }

    ]

  }

];



/** Identifiants stables des sections visibles en contexte délégué. */
export const DELEGATED_SECTION_IDS = new Set<string>([
  NAV_ID.accounting,
  NAV_ID.fiscalTej,
  NAV_ID.hrPayroll,
  NAV_ID.sales,
  NAV_ID.purchases,
  NAV_ID.treasury
]);

/** Commercial sections hidden when the delegated dossier is firm-managed. */
export const FIRM_MANAGED_HIDDEN_SECTION_IDS = new Set<string>([
  NAV_ID.sales,
  NAV_ID.purchases,
  NAV_ID.treasury
]);



/** Read-only routes under sales/purchases/treasury in delegated mode. */

export const DELEGATED_READ_ONLY_ROUTE_PREFIXES = [

  '/invoices',

  '/supplier-invoices',

  '/payments'

];



/** Sidebar submenu routes allowed for accounting firms in delegated mode — Ventes. */

export const DELEGATED_FIRM_VENTES_ALLOWED_ROUTES = new Set([

  '/invoices',

  '/invoices/unpaid',

  '/reports/client-balances',

  '/reports/sales'

]);



/** Sidebar submenu routes allowed for accounting firms in delegated mode — Achats. */

export const DELEGATED_FIRM_ACHATS_ALLOWED_ROUTES = new Set([

  '/supplier-invoices',

  '/supplier-invoices/unpaid',

  '/reports/supplier-balances',

  '/reports/purchases',

  '/purchase-receipts'

]);



const DELEGATED_FIRM_BLOCKED_SALES_PURCHASES_PREFIXES = [

  '/quotes',

  '/delivery-notes',
  '/return-notes',

  '/suppliers',

  '/purchase-orders',

  '/reports/analytics',

  '/reports/purchases-analytics',

  '/reports/profit',

  '/reports/sales-by-line',

  '/reports/sales-journal',

  '/reports/product-sales-analytics',

  '/ai-assistant/ventes',

  '/ai-assistant/achats'

];



function pathMatchesPrefix(path: string, prefix: string): boolean {

  return path === prefix || path.startsWith(prefix + '/');

}



export function filterDelegatedFirmSectionChildren(
  sectionId: string,
  children: NavSubItem[]
): NavSubItem[] {
  if (sectionId === NAV_ID.sales) {
    return children.filter(c => c.route && DELEGATED_FIRM_VENTES_ALLOWED_ROUTES.has(c.route));
  }
  if (sectionId === NAV_ID.purchases) {
    return children.filter(c => c.route && DELEGATED_FIRM_ACHATS_ALLOWED_ROUTES.has(c.route));
  }
  return children;
}



/**

 * True when an accounting firm in delegated mode must not access this frontend route

 * (sales/purchases areas outside the strict allowlist).

 */

export function isDelegatedFirmBlockedSalesPurchasesRoute(path: string): boolean {

  const normalized = path.split('?')[0].split('#')[0];

  if (

    DELEGATED_FIRM_BLOCKED_SALES_PURCHASES_PREFIXES.some(p => pathMatchesPrefix(normalized, p))

  ) {

    return true;

  }

  if (normalized === '/reports' || normalized.startsWith('/reports/')) {

    if (pathMatchesPrefix(normalized, '/reports/sales')) {

      return false;

    }

    if (pathMatchesPrefix(normalized, '/reports/purchases')) {

      return false;

    }

    return true;

  }

  return false;

}



/** Slug autorisé pour l'assistant IA en mode délégué cabinet. */
export const FIRM_DELEGATED_AI_ASSISTANT_SLUG = 'comptabilite';

/**

 * AI assistant routes blocked for accounting firms in delegated mode (accounting scope only).

 */

export function isDelegatedFirmBlockedAiAssistantRoute(path: string): boolean {

  const normalized = path.split('?')[0].split('#')[0];

  if (!pathMatchesPrefix(normalized, '/ai-assistant')) {

    return false;

  }

  if (normalized === '/ai-assistant' || normalized === '/ai-assistant/') {

    return true;

  }

  const slug = normalized.slice('/ai-assistant/'.length).split('/')[0];

  return slug !== FIRM_DELEGATED_AI_ASSISTANT_SLUG;

}



/**

 * Commercial routes blocked for firm-managed dossiers (no platform commercial account).

 * Includes the regular delegated allowlist (invoices, balances, etc.) plus already-blocked paths.

 */

const FIRM_MANAGED_BLOCKED_COMMERCIAL_ROUTE_PREFIXES = [

  '/invoices',

  '/payments',

  '/supplier-invoices',

  '/purchase-receipts',

  '/reports/sales',

  '/reports/purchases',

  '/reports/client-balances',

  '/reports/supplier-balances',

  '/sales-orders',

  '/ai-assistant/tresorerie'

];



export function isFirmManagedBlockedCommercialRoute(path: string): boolean {

  if (isDelegatedFirmBlockedSalesPurchasesRoute(path)) {

    return true;

  }

  const normalized = path.split('?')[0].split('#')[0];

  return FIRM_MANAGED_BLOCKED_COMMERCIAL_ROUTE_PREFIXES.some(p => pathMatchesPrefix(normalized, p));

}



export function isDelegatedReadOnlyRoute(path: string): boolean {

  return DELEGATED_READ_ONLY_ROUTE_PREFIXES.some(p => path === p || path.startsWith(p + '/'));

}

/** True when an accounting firm user operates on a client dossier in delegated read-only context. */
export function isFirmDelegatedReadonly(auth: {
  isAccountingFirm: () => boolean;
  isDelegatedMode: () => boolean;
}): boolean {
  return auth.isAccountingFirm() && auth.isDelegatedMode();
}



/** Quick access items shown to accounting firms in native mode. */

export const FIRM_NATIVE_QUICK_ACCESS = [

  {

    label: $localize`:@@core.firm-navigation.registry.ts.mes.dossiers.1eab2884:Mes dossiers`,

    icon: 'fa-solid fa-briefcase',

    route: '/firm/clients',

    permission: '',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.invitations.en.attente.901d7402:Invitations en attente`,

    icon: 'fa-solid fa-envelope-open-text',

    route: '/firm/invitations',

    permission: '',

    section: 'navigation' as const

  }

];



/** Quick access when operating inside a client dossier. */

export const FIRM_DELEGATED_QUICK_ACCESS = [

  {

    label: $localize`:@@core.firm-navigation.registry.ts.journal.comptable.cc13c236:Journal comptable`,

    icon: 'fa-solid fa-book',

    route: '/accounting/journal',

    permission: 'accounting:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.plan.comptable.b3f54c09:Plan comptable`,

    icon: 'fa-solid fa-sitemap',

    route: '/accounting/chart',

    permission: 'accounting:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.cycles.de.paie.ea07b457:Cycles de paie`,

    icon: 'fa-solid fa-calendar-check',

    route: '/payroll/runs',

    permission: 'payroll:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.livre.de.paie.ccdfc623:Livre de paie`,

    icon: 'fa-solid fa-book',

    route: '/payroll/reports/payroll-book',

    permission: 'payroll:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.journal.de.paie.240f3575:Journal de paie`,

    icon: 'fa-solid fa-list-check',

    route: '/payroll/reports/payroll-journal',

    permission: 'payroll:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.regularisation.irpp.da08474d:Régularisation IRPP`,

    icon: 'fa-solid fa-scale-balanced',

    route: '/payroll/regularization',

    permission: 'payroll:read',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.parametres.paie.89296f29:Paramètres paie`,

    icon: 'fa-solid fa-sliders',

    route: '/payroll/settings',

    permission: 'payroll:settings',

    section: 'navigation' as const

  },

  {

    label: $localize`:@@core.firm-navigation.registry.ts.retour.au.cabinet.ea23ac22:Retour au cabinet`,

    icon: 'fa-solid fa-arrow-left',

    action: 'returnToFirm' as const,

    permission: '',

    section: 'navigation' as const

  }

];

/** Footer utilitaire du sidemenu cabinet en mode délégué (Contrôle, Paramètres, Aide). */
export const FIRM_DELEGATED_FOOTER_NAV: NavItem[] = [
  {
    id: 'firm-delegated-audit',
    label: $localize`:@@core.firm-navigation.registry.ts.controle.audit.53f4026c:Contrôle & Audit`,
    icon: 'fa-solid fa-shield-halved',
    children: [
      {
        label: $localize`:@@core.firm-navigation.registry.ts.controle.d.integrite.6a418f91:Contrôle d'intégrité`,
        route: '/accounting/health',
        icon: 'fa-solid fa-heart-pulse',
        modules: [M.Accounting],
        permissionsAll: [PERMISSIONS.accounting.read]
      },
      {
        label: $localize`:@@core.firm-navigation.registry.ts.controles.de.pre.cloture.e6b9bc87:Contrôles de pré-clôture`,
        route: '/accounting/pre-closing',
        icon: 'fa-solid fa-list-check',
        modules: [M.Accounting],
        permissionsAll: [PERMISSIONS.accounting.read]
      },
      {
        label: $localize`:@@core.firm-navigation.registry.ts.journal.d.audit.52309db1:Journal d'audit`,
        route: '/audit',
        icon: 'fa-solid fa-shield-halved',
        modules: [M.Accounting],
        permissionsAll: ['audit:read']
      }
    ]
  },
  {
    label: $localize`:@@core.firm-navigation.registry.ts.parametres.ef8f0121:Paramètres`,
    icon: 'fa-solid fa-gear',
    route: '/settings/profile'
  },
  {
    label: $localize`:@@core.firm-navigation.registry.ts.centre.d.aide.469b4915:Centre d'aide`,
    icon: 'fa-solid fa-circle-question',
    externalUrl: '__FIRM_HELP_URL__'
  }
];

function isFirmGovernanceNavRoute(route?: string): boolean {
  if (!route) {
    return false;
  }
  return (
    route.startsWith('/firm/governance') ||
    route === '/firm/affectation' ||
    route.startsWith('/firm/affectation/') ||
    route === '/firm/payroll' ||
    route.startsWith('/firm/payroll/')
  );
}

/**
 * Interrupteur local du réviseur (`localStorage` → `ft.firm.featureFlags`). Ce n'est PAS la garde
 * de fonctionnalité — celle-ci est la permission `firm:revision:view`, que l'API ne délivre que
 * sous `FirmRevisionEnabled`. Ce filtre garantit seulement que couper le drapeau ne laisse pas
 * dans le menu un lien que `firmRevisionFeatureGuard` renverrait aussitôt au tableau de bord.
 *
 * Volontairement plus simple que `filterFirmGovernanceNav` : l'entrée est unique et sans enfants,
 * la récursion et l'élagage des parents vides n'auraient aucun cas d'emploi.
 */
export function filterFirmRevisionNav(items: NavItem[], revisionEnabled: boolean): NavItem[] {
  if (revisionEnabled) {
    return items;
  }
  return items.filter(item => item.route !== '/firm/revision');
}

/** Masque les entrées Gouvernance lorsque le feature flag cabinet est désactivé. */
export function filterFirmGovernanceNav(items: NavItem[], governanceEnabled: boolean): NavItem[] {
  if (governanceEnabled) {
    return items;
  }

  return items
    .filter(item => !isFirmGovernanceNavRoute(item.route))
    .map(item =>
      item.children?.length
        ? {
            ...item,
            children: item.children.filter(c => !isFirmGovernanceNavRoute(c.route))
          }
        : item
    )
    .filter(item => !item.children || item.children.length > 0);
}

