/**
 * Miroir TypeScript de `SectorCatalogDto`
 * (`src/Backend/FactuTrust.Application/DTOs/SectorCatalogDtos.cs`), servi par
 * `GET /api/public/sector-catalog`.
 */

export interface SectorSegmentDto {
  code: string;
  labelFr: string;
  descriptionFr: string;
  iconKey: string;
  sortOrder: number;
  coreModuleIds: number[];
  recommendedModuleIds: number[];
  defaultWarehouseName?: string | null;
  /** Domaines explicitement rattachés à ce segment. Vide ⇒ aucune restriction. */
  domainCodes: string[];
}

export interface SectorDomainDto {
  code: string;
  labelFr: string;
  sortOrder: number;
  additionalModuleIds: number[];
}

export interface SectorModuleDto {
  id: number;
  code: string;
  labelFr: string;
  isCore: boolean;
  availableOnFreePlan: boolean;
}

/** Sélectionner `moduleId` impose d'activer aussi `requiredModuleId`. */
export interface SectorModuleDependencyDto {
  moduleId: number;
  requiredModuleId: number;
}

export interface SectorTaxRegimeSuggestionDto {
  segmentCode: string;
  regime: number;
  noteFr: string;
}

export interface SectorCatalogDto {
  segments: SectorSegmentDto[];
  domains: SectorDomainDto[];
  modules: SectorModuleDto[];
  moduleDependencies: SectorModuleDependencyDto[];
  suggestedTaxRegimes: SectorTaxRegimeSuggestionDto[];
  catalogVersion: string;
}

/**
 * État de chargement du catalogue.
 *  - `remote`   : servi par l'API.
 *  - `fallback` : l'API n'a pas répondu, on utilise les tables statiques embarquées.
 *  - `disabled` : l'API a répondu 404, la configuration sectorielle est désactivée sur
 *                 l'instance. Distinct de `fallback` : dans ce cas le serveur ignorerait de
 *                 toute façon toute sélection, il ne faut donc rien demander à l'opérateur.
 */
export type SectorCatalogState = 'loading' | 'remote' | 'fallback' | 'disabled';
