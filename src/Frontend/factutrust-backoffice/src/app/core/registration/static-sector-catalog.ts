import type { SectorDomainDto, SectorSegmentDto } from './sector-catalog.models';

/**
 * Tables sectorielles statiques embarquées — filet de sécurité utilisé uniquement quand
 * `GET /api/public/sector-catalog` ne répond pas (panne / 5xx).
 *
 * Elles reflètent `SectorConfigurationCatalog` côté serveur
 * (`src/Backend/FactuTrust.Domain/SectorConfiguration/`) et leur jumeau côté web
 * (`factutrust-web/.../register-wizard/registration-catalog.ts`).
 *
 * Elles existent pour une raison précise : en cas de panne du catalogue, revenir à la saisie
 * libre du code de secteur produirait exactement le défaut d'origine de cet écran — un code
 * inventé (« vente-detail ») refusé par le serveur. Ici, les codes restent valides.
 */

const MODULE = {
  Clients: 0,
  Products: 1,
  Sales: 2,
  Treasury: 3,
  Reports: 4,
  Administration: 5,
  Purchases: 6,
  Stock: 7,
  Accounting: 8,
  CRM: 9,
  Fiscal: 10,
  Projects: 16,
  RecurringContracts: 17
} as const;

export const SEGMENT_RECOMMENDED_MODULES: Record<string, readonly number[]> = {
  'entreprise': [MODULE.Purchases, MODULE.Stock, MODULE.Accounting, MODULE.CRM, MODULE.Fiscal],
  'commerce': [MODULE.Purchases, MODULE.Stock, MODULE.Fiscal],
  'services': [MODULE.CRM, MODULE.Projects, MODULE.RecurringContracts, MODULE.Fiscal],
  'btp-construction': [MODULE.Purchases, MODULE.Stock, MODULE.Projects, MODULE.Fiscal],
  'association': [MODULE.Accounting, MODULE.Fiscal],
  'etablissement-educatif': [MODULE.RecurringContracts, MODULE.Accounting, MODULE.Fiscal]
};

export const DOMAIN_MODULE_OVERLAY: Record<string, readonly number[]> = {
  'technologie-informatique': [MODULE.Projects, MODULE.RecurringContracts],
  'alimentation-agroalimentaire': [MODULE.Stock, MODULE.Purchases],
  'sante-paramedical': [MODULE.CRM],
  'textile-habillement': [MODULE.Stock],
  'transport-logistique': [MODULE.Stock],
  'immobilier': [MODULE.Projects, MODULE.RecurringContracts],
  'energie-environnement': [MODULE.Projects, MODULE.Purchases],
  'communication-marketing': [MODULE.CRM],
  'artisanat': [MODULE.Stock, MODULE.Purchases],
  // « Autre domaine » reste vide : ne rien présumer de l'activité.
  'autre': []
};

export const SEGMENT_ALLOWED_DOMAINS: Record<string, readonly string[]> = {
  'entreprise': [
    'technologie-informatique', 'alimentation-agroalimentaire', 'sante-paramedical',
    'textile-habillement', 'transport-logistique', 'immobilier',
    'energie-environnement', 'communication-marketing', 'artisanat', 'autre'
  ],
  'commerce': [
    'alimentation-agroalimentaire', 'textile-habillement', 'technologie-informatique',
    'sante-paramedical', 'artisanat', 'autre'
  ],
  'services': [
    'technologie-informatique', 'communication-marketing', 'sante-paramedical',
    'transport-logistique', 'immobilier', 'autre'
  ],
  'btp-construction': ['immobilier', 'energie-environnement', 'artisanat', 'autre'],
  'association': [
    'sante-paramedical', 'energie-environnement', 'communication-marketing', 'artisanat', 'autre'
  ],
  'etablissement-educatif': [
    'technologie-informatique', 'sante-paramedical', 'artisanat', 'communication-marketing', 'autre'
  ]
};

export const SEGMENT_DEFAULT_WAREHOUSE_NAME: Record<string, string> = {
  'entreprise': 'Entrepôt Principal',
  'commerce': 'Magasin principal',
  'services': 'Entrepôt Principal',
  'btp-construction': 'Dépôt chantier',
  'association': 'Entrepôt Principal',
  'etablissement-educatif': 'Entrepôt Principal'
};

const CORE_IDS = [
  MODULE.Clients, MODULE.Products, MODULE.Sales,
  MODULE.Treasury, MODULE.Reports, MODULE.Administration
];

function segment(
  code: string,
  labelFr: string,
  descriptionFr: string,
  iconKey: string,
  sortOrder: number
): SectorSegmentDto {
  return {
    code,
    labelFr,
    descriptionFr,
    iconKey,
    sortOrder,
    coreModuleIds: CORE_IDS,
    recommendedModuleIds: [...(SEGMENT_RECOMMENDED_MODULES[code] ?? [])],
    defaultWarehouseName: SEGMENT_DEFAULT_WAREHOUSE_NAME[code] ?? null,
    domainCodes: [...(SEGMENT_ALLOWED_DOMAINS[code] ?? [])]
  };
}

export const STATIC_SEGMENTS: readonly SectorSegmentDto[] = [
  segment('entreprise', 'Entreprise', 'Sociétés commerciales et de services aux entreprises', 'building', 1),
  segment('commerce', 'Commerce', 'Négoce et distribution', 'shopping-cart', 2),
  segment('services', 'Prestations de services', 'Services et conseils', 'briefcase', 3),
  segment('btp-construction', 'BTP & Construction', 'Bâtiment et travaux publics', 'hammer', 4),
  segment('association', 'Association', 'Organismes à but non lucratif', 'heart', 5),
  segment('etablissement-educatif', 'Établissement éducatif', 'Écoles, universités, centres de formation', 'graduation-cap', 6)
];

function domain(code: string, labelFr: string, sortOrder: number): SectorDomainDto {
  return {
    code,
    labelFr,
    sortOrder,
    additionalModuleIds: [...(DOMAIN_MODULE_OVERLAY[code] ?? [])]
  };
}

export const STATIC_DOMAINS: readonly SectorDomainDto[] = [
  domain('technologie-informatique', 'Technologie & Informatique', 1),
  domain('alimentation-agroalimentaire', 'Alimentation & Agroalimentaire', 2),
  domain('sante-paramedical', 'Santé & Paramédical', 3),
  domain('textile-habillement', 'Textile & Habillement', 4),
  domain('transport-logistique', 'Transport & Logistique', 5),
  domain('immobilier', 'Immobilier', 6),
  domain('energie-environnement', 'Énergie & Environnement', 7),
  domain('communication-marketing', 'Communication & Marketing', 8),
  domain('artisanat', 'Artisanat', 9),
  domain('autre', 'Autre domaine', 10)
];
