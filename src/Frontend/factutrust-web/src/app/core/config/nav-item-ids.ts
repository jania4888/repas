import type { NavItem, NavSubItem } from './app-navigation.registry';

/** Identifiants stables des sections principales (indépendants de la traduction). */
export const NAV_ID = {
  dashboard: 'dashboard',
  aiAssistant: 'ai-assistant',
  forecasting: 'forecasting',
  pos: 'pos',
  sales: 'sales',
  purchases: 'purchases',
  records: 'records',
  stock: 'stock',
  treasury: 'treasury',
  crm: 'crm',
  projects: 'projects',
  fiscalTej: 'fiscal-tej',
  hrPayroll: 'hr-payroll',
  accounting: 'accounting',
  accountingDashboard: 'accounting-dashboard',
  settings: 'settings',
  assistance: 'assistance',
  exchanges: 'exchanges',
  studio: 'studio',
  firmDelegatedAudit: 'firm-delegated-audit'
} as const;

/** Enfants statiques de Studio. Les tables saisies par le tenant passent par `studioDynamicNavId`. */
export const STUDIO_CHILD_NAV_ID = {
  tables: 'studio-tables',
  forms: 'studio-forms',
  reports: 'studio-reports',
  ai: 'studio-ai',
  workflows: 'studio-workflows',
  approvals: 'studio-approvals'
} as const;

export function studioDynamicNavId(key: string): string {
  return `studio-d-${key}`;
}

/** Entrées de contexte construites à la volée (espace cabinet délégué, dossiers clients). */
export const CONTEXT_NAV_ID = {
  firmDossierHeader: 'firm-dossier-context',
  returnToFirm: 'firm-dossier-context--return',
  changeDossier: 'firm-dossier-context--change',
  allDossiers: 'firm-dossiers--all',
  myDossiers: 'firm-dossiers--mine'
} as const;

/**
 * Identifiant stable d'une entrée. Appelé pendant le rendu du menu : ne lève jamais. Une entrée
 * sans id (dynamique) reçoit un id dérivé de son libellé, qui ne correspond à aucune section
 * connue — comme les anciennes comparaisons par libellé.
 */
export function getNavId(item: Pick<NavItem, 'id' | 'label'> | Pick<NavSubItem, 'id' | 'label'>): string {
  return item.id || `nav-label:${item.label}`;
}
