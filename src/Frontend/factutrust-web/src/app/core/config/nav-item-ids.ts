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
  settings: 'settings',
  assistance: 'assistance',
  exchanges: 'exchanges',
  studio: 'studio',
  firmDelegatedAudit: 'firm-delegated-audit'
} as const;

export function getNavId(item: Pick<NavItem, 'id' | 'label'> | Pick<NavSubItem, 'id' | 'label'>): string {
  if (item.id) {
    return item.id;
  }
  throw new Error(`Navigation entry missing stable id (label="${item.label}")`);
}
