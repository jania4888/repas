/**
 * Sections affichées dans la 2e barre horizontale (desktop).
 * Les labels DOIVENT correspondre exactement à ceux de ALL_NAV_ITEMS /
 * DELEGATED_SECTION_LABELS pour préserver le filtrage existant.
 */
import { NAV_ID } from './nav-item-ids';

export const SECONDARY_NAV_SECTION_ORDER = [
  NAV_ID.sales,
  NAV_ID.purchases,
  NAV_ID.stock,
  NAV_ID.treasury,
  NAV_ID.records,
  NAV_ID.hrPayroll,
  NAV_ID.accounting,
  NAV_ID.fiscalTej
] as const;

export type SecondaryNavSectionId = (typeof SECONDARY_NAV_SECTION_ORDER)[number];

/** Sections à masquer dans la 2e barre pour le cabinet comptable. */
export const ACCOUNTING_FIRM_SECONDARY_EXCLUDED_IDS: ReadonlySet<string> = new Set([
  NAV_ID.sales,
  NAV_ID.purchases,
  NAV_ID.treasury,
  NAV_ID.hrPayroll
]);

/** @deprecated use ACCOUNTING_FIRM_SECONDARY_EXCLUDED_IDS */
export const ACCOUNTING_FIRM_SECONDARY_EXCLUDED_LABELS = ACCOUNTING_FIRM_SECONDARY_EXCLUDED_IDS;

/** Libellés courts d’affichage (clé = id stable). */
export const SECONDARY_NAV_DISPLAY_LABELS: Readonly<Partial<Record<SecondaryNavSectionId, string>>> = {
  [NAV_ID.fiscalTej]: 'TEJ'
};

export function secondaryNavDisplayLabel(sectionId: string, translatedLabel: string): string {
  return SECONDARY_NAV_DISPLAY_LABELS[sectionId as SecondaryNavSectionId] ?? translatedLabel;
}
