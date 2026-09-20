/**
 * Phase 2 (WP-F6) — Catalogue centralisé des modules `AppModule` (mirror backend, valeurs 0–17).
 *
 * Extrait de la copie précédemment dupliquée dans `tenant-modules-tab.component.ts` afin que
 * les nouveaux écrans « Règles sectorielles » et le tab « Configuration sectorielle » du tenant
 * partagent une unique source de vérité pour les libellés id → module.
 */
export interface ModuleCatalogOption {
  value: number;
  label: string;
}

export const MODULE_CATALOG: ModuleCatalogOption[] = [
  { value: 0, label: 'Clients' },
  { value: 1, label: 'Produits et services' },
  { value: 2, label: 'Ventes (factures)' },
  { value: 3, label: 'Trésorerie (paiements)' },
  { value: 4, label: 'Rapports' },
  { value: 5, label: 'Paramètres et utilisateurs' },
  { value: 6, label: 'Achats' },
  { value: 7, label: 'Stock' },
  { value: 8, label: 'Comptabilité' },
  { value: 9, label: 'CRM Commercial' },
  { value: 10, label: 'Fiscal / TEJ' },
  { value: 11, label: 'Assistant IA' },
  { value: 12, label: 'Prévisions IA' },
  { value: 13, label: 'Studio (low-code)' },
  { value: 14, label: 'RH & Paie' },
  { value: 15, label: 'Honoraires' },
  { value: 16, label: 'Projets' },
  { value: 17, label: 'Contrats récurrents' }
];

/** Résout le libellé FR d'un module par son id ; retombe sur `Module {id}` si inconnu. */
export function moduleLabel(moduleId: number): string {
  return MODULE_CATALOG.find(m => m.value === moduleId)?.label ?? `Module ${moduleId}`;
}

/**
 * Modules du socle commun (Administration, Clients, Produits, Ventes, Trésorerie, Rapports) —
 * toujours actifs, jamais présents dans une `SectorModuleRule` ni comme cible de dépendance
 * (mirror `PlatformSectorRulesController` validation, WP-B5/D9).
 */
export const CORE_MODULE_IDS: readonly number[] = [0, 1, 2, 3, 4, 5];

/** Honoraires (15) est explicitement rejeté par les règles sectorielles côté backend. */
export const HONORAIRES_MODULE_ID = 15;

/** Modules éligibles dans les règles sectorielles (ni socle, ni Honoraires). */
export const SECTOR_ELIGIBLE_MODULES: ModuleCatalogOption[] = MODULE_CATALOG.filter(
  m => !CORE_MODULE_IDS.includes(m.value) && m.value !== HONORAIRES_MODULE_ID
);
