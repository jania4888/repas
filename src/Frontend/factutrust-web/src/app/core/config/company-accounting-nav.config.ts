import { AppModule as M } from '../models/app-module';
import { AuthService } from '../services/auth.service';
import {
  ACCOUNTING_MODULE_ID,
  ACCOUNTING_MODULES,
  AccountingModuleLink
} from './accounting-modules.config';
import { NavItem, NavSearchEntry, NavSubItem } from './app-navigation.registry';
import { getNavId, NAV_ID } from './nav-item-ids';

/** Section États dans ACCOUNTING_MODULES — source des liens du hub « États comptables ». */
export const COMPANY_ACCOUNTING_ETATS_MODULE_ID = ACCOUNTING_MODULE_ID.etats;

export const COMPANY_ACCOUNTING_AI_ASSISTANT_ROUTE = '/ai-assistant/comptabilite';

export const COMPANY_ACCOUNTING_FIXED_ASSETS_ROUTE = '/accounting/fixed-assets';

const ETATS_MODULE = ACCOUNTING_MODULES.find(m => m.id === COMPANY_ACCOUNTING_ETATS_MODULE_ID);

const CONFIGURATION_ASSISTANT_LINK = ACCOUNTING_MODULES.find(m => m.id === ACCOUNTING_MODULE_ID.configuration)?.links.find(
  l => l.route === COMPANY_ACCOUNTING_AI_ASSISTANT_ROUTE
);

function accountingModuleLinkToNavSubItem(link: AccountingModuleLink): NavSubItem {
  return {
    id: link.id,
    label: link.label,
    route: link.route,
    icon: link.icon,
    modules: link.modules ?? [M.Accounting],
    permissionsAll: link.perms
  };
}

/** Feuilles du sous-menu « États comptables » — même liste que le hub (source ACCOUNTING_MODULES). */
export function buildCompanyEtatsComptablesNavChildren(): NavSubItem[] {
  return (ETATS_MODULE?.links ?? []).map(accountingModuleLinkToNavSubItem);
}

/** Routes autorisées pour la société (assistant, états, déclaration, immobilisations). */
export const COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES: readonly string[] = [
  COMPANY_ACCOUNTING_AI_ASSISTANT_ROUTE,
  '/accounting/financial-statements',
  '/accounting/vat-declaration',
  COMPANY_ACCOUNTING_FIXED_ASSETS_ROUTE,
  ...(ETATS_MODULE?.links.map(l => l.route) ?? []),
  '/audit'
];

/** Préfixes de chemins soumis au guard comptabilité société. */
export const COMPANY_ACCOUNTING_GUARDED_ROUTE_PREFIXES: readonly string[] = [
  '/accounting',
  '/audit',
  COMPANY_ACCOUNTING_AI_ASSISTANT_ROUTE
];

/** Sous-menus Comptabilité affichés dans le sidebar pour une société connectée. */
export const COMPANY_ACCOUNTING_SIDEBAR_CHILDREN: NavSubItem[] = [
  ...(CONFIGURATION_ASSISTANT_LINK ? [accountingModuleLinkToNavSubItem(CONFIGURATION_ASSISTANT_LINK)] : []),
  {
    id: 'company-acct--financial-statements-hub',
    label: $localize`:@@core.company-accounting-nav.ts.etats.comptables.00e46d74:États comptables`,
    route: '/accounting/financial-statements',
    icon: 'fa-solid fa-table-list',
    modules: [M.Accounting],
    permissionsAll: ['accounting:read'],
    children: buildCompanyEtatsComptablesNavChildren()
  },
  {
    id: 'company-acct--vat-declaration',
    label: $localize`:@@core.company-accounting-nav.ts.declaration.mensuelle.5b42e43d:Déclaration mensuelle`,
    route: '/accounting/vat-declaration',
    icon: 'fa-solid fa-file-invoice',
    modules: [M.Accounting],
    permissionsAll: ['accounting:read']
  },
  {
    id: 'company-acct--fixed-assets-list',
    label: $localize`:@@core.company-accounting-nav.ts.liste.des.immobilisations.3a26cdfd:Liste des immobilisations`,
    route: COMPANY_ACCOUNTING_FIXED_ASSETS_ROUTE,
    icon: 'fa-solid fa-building',
    modules: [M.Accounting],
    permissionsAll: ['accounting:read']
  }
];

export function isCompanyAccountingRestricted(auth: AuthService): boolean {
  return !auth.isAccountingFirm();
}

/** Zone « Pièces justificatives » de la déclaration TVA : réservée au cabinet comptable. */
export function canShowVatDeclarationDocLinks(auth: AuthService): boolean {
  return !isCompanyAccountingRestricted(auth);
}

/** Préparation / soumission / rectificative : réservées au cabinet (pas à la société). */
export function canManageVatDeclaration(auth: AuthService): boolean {
  return !isCompanyAccountingRestricted(auth);
}

/** Société connectée : lecture seule des déclarations soumises + export PDF. */
export function isCompanyVatDeclarationReadOnly(auth: AuthService): boolean {
  return isCompanyAccountingRestricted(auth);
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (path === prefix) {
    return true;
  }
  return path.startsWith(prefix + '/');
}

export function isCompanyAllowedAccountingPath(path: string): boolean {
  if (path === '/accounting') {
    return true;
  }
  return COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES.some(prefix => pathMatchesPrefix(path, prefix));
}

export function isAccountingGuardedPath(path: string): boolean {
  return COMPANY_ACCOUNTING_GUARDED_ROUTE_PREFIXES.some(prefix => pathMatchesPrefix(path, prefix));
}

export function applyCompanyAccountingSidebar(items: NavItem[]): NavItem[] {
  return items.map(item => {
    if (getNavId(item) !== NAV_ID.accounting || !item.children?.length) {
      return item;
    }
    return { ...item, children: [...COMPANY_ACCOUNTING_SIDEBAR_CHILDREN] };
  });
}

export function filterCompanyAccountingSearchEntries(entries: NavSearchEntry[]): NavSearchEntry[] {
  return entries.filter(entry => isCompanyAllowedAccountingPath(entry.route));
}
