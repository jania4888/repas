/**
 * Synthetic L0 taxonomy baseline for the realistic virtual street (approved plan
 * /code/.plans/v3-realistic-business-3d.md, task 1). Pure data + pure builders:
 * no Angular, no HTTP, no Three.js.
 *
 * Every row is SYNTHETIC. Nothing here is read from a tenant, a database or a
 * production catalog, and nothing here activates a runtime loader. The baseline
 * freezes what the future visual resolution must absorb:
 *
 *  - 36 seeded (segment, domain) pairs, compared against the domain source by
 *    business-taxonomy-fixture.spec.ts (frontend mirror SEGMENT_ALLOWED_DOMAINS,
 *    itself a documented exact copy of SectorConfigurationCatalog);
 *  - 6 segment-without-domain cases (the segment default is the seeded
 *    (segment, autre) profile: an alias, not extra coverage);
 *  - 24 known-but-not-seeded combinations (accepted by admin rules or when
 *    EnforceSegmentDomainLinks=false): safe neutral fallback, then art backlog;
 *  - 8 synthetic edge rows covering admin-custom codes (kebab, <= 50 chars),
 *    inactive codes and missing/partial classification.
 *
 * Coverage rule (plan task 6): a row that claims a SPECIALIZED profile counts as
 * coverage only when that profile guarantees both a facade and an interior scene.
 * Neutral fallbacks are display-only and never count as domain coverage.
 */

/** Admin custom-code rule, mirrored from SectorRuleAdminService.cs (CodeRegex + length check). */
export const ADMIN_TAXONOMY_CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ADMIN_TAXONOMY_CODE_MAX_LENGTH = 50;

/** Canonical domain source mirrored by this fixture (never imported at runtime). */
export const TAXONOMY_BASELINE_SOURCE = {
  canonical: 'src/Backend/FactuTrust.Domain/SectorConfiguration/SectorConfigurationCatalog.cs',
  constants:
    'src/Backend/FactuTrust.Domain/SectorConfiguration/CompanySegments.cs + BusinessDomains.cs',
  frontendMirror:
    'src/app/features/auth/register-wizard/registration-catalog.ts (SEGMENT_ALLOWED_DOMAINS)',
  snapshot: 'src/Backend/FactuTrust.API/Resources/sector-catalog.snapshot.json',
  observedAt: '2026-09-17',
  head: '1d17ebebe871ff1893efbac35b1b0e678d6ed451'
} as const;

export interface TaxonomyBaselineSegment {
  readonly code: string;
  readonly labelFr: string;
  readonly sortOrder: number;
  /** 1-based inclusive line range of the SegmentDefinition in the canonical source. */
  readonly sourceLines: readonly [number, number];
}

export interface TaxonomyBaselineDomain {
  readonly code: string;
  readonly labelFr: string;
  readonly sortOrder: number;
  /** 1-based line of `Code = BusinessDomains.*` in the canonical source. */
  readonly sourceLine: number;
}

/** The 6 seeded company segments, in SortOrder (source lines 131–246). */
export const FIXTURE_SEGMENTS: readonly TaxonomyBaselineSegment[] = [
  { code: 'entreprise', labelFr: 'Entreprise', sortOrder: 0, sourceLines: [133, 155] },
  { code: 'commerce', labelFr: 'Commerce', sortOrder: 1, sourceLines: [156, 174] },
  { code: 'services', labelFr: 'Prestations de services', sortOrder: 2, sourceLines: [175, 193] },
  { code: 'btp-construction', labelFr: 'BTP & Construction', sortOrder: 3, sourceLines: [194, 210] },
  { code: 'association', labelFr: 'Association', sortOrder: 4, sourceLines: [211, 228] },
  { code: 'etablissement-educatif', labelFr: 'Établissement éducatif', sortOrder: 5, sourceLines: [229, 246] }
] as const;

/** The 10 seeded business domains, in SortOrder (Domains array, source lines 249–330). */
export const FIXTURE_DOMAINS: readonly TaxonomyBaselineDomain[] = [
  { code: 'technologie-informatique', labelFr: 'Technologie & Informatique', sortOrder: 0, sourceLine: 253 },
  { code: 'alimentation-agroalimentaire', labelFr: 'Alimentation & Agroalimentaire', sortOrder: 1, sourceLine: 260 },
  { code: 'sante-paramedical', labelFr: 'Santé & Paramédical', sortOrder: 2, sourceLine: 267 },
  { code: 'textile-habillement', labelFr: 'Textile & Habillement', sortOrder: 3, sourceLine: 274 },
  { code: 'transport-logistique', labelFr: 'Transport & Logistique', sortOrder: 4, sourceLine: 281 },
  { code: 'immobilier', labelFr: 'Immobilier', sortOrder: 5, sourceLine: 288 },
  { code: 'energie-environnement', labelFr: 'Énergie & Environnement', sortOrder: 6, sourceLine: 298 },
  { code: 'communication-marketing', labelFr: 'Communication & Marketing', sortOrder: 7, sourceLine: 306 },
  { code: 'artisanat', labelFr: 'Artisanat', sortOrder: 8, sourceLine: 313 },
  { code: 'autre', labelFr: 'Autre domaine', sortOrder: 9, sourceLine: 321 }
] as const;

/**
 * Independent re-declaration of the 36 seeded segment→domain links
 * (SegmentDefinition.AllowedDomainCodes). The spec proves byte-parity with the
 * frontend mirror; any intentional taxonomy change must update both and be
 * reflected in the art coverage matrix.
 */
export const FIXTURE_SEEDED_MATRIX: Readonly<Record<string, readonly string[]>> = {
  'entreprise': [
    'technologie-informatique',
    'alimentation-agroalimentaire',
    'sante-paramedical',
    'textile-habillement',
    'transport-logistique',
    'immobilier',
    'energie-environnement',
    'communication-marketing',
    'artisanat',
    'autre'
  ],
  'commerce': [
    'alimentation-agroalimentaire',
    'textile-habillement',
    'technologie-informatique',
    'sante-paramedical',
    'artisanat',
    'autre'
  ],
  'services': [
    'technologie-informatique',
    'communication-marketing',
    'sante-paramedical',
    'transport-logistique',
    'immobilier',
    'autre'
  ],
  'btp-construction': ['immobilier', 'energie-environnement', 'artisanat', 'autre'],
  'association': ['sante-paramedical', 'energie-environnement', 'communication-marketing', 'artisanat', 'autre'],
  'etablissement-educatif': ['technologie-informatique', 'sante-paramedical', 'artisanat', 'communication-marketing', 'autre']
} as const;

/**
 * Neutral visual family per segment for non-seeded/custom/inactive rows
 * (proposedFallbackFamily of the exploration inventory — descriptive, not a code).
 */
export const FIXTURE_SEGMENT_FALLBACK_FAMILY: Readonly<Record<string, 'boutique' | 'bureau' | 'atelier'>> = {
  'entreprise': 'bureau',
  'commerce': 'boutique',
  'services': 'bureau',
  'btp-construction': 'atelier',
  'association': 'bureau',
  'etablissement-educatif': 'bureau'
} as const;

/**
 * Seeded pairs whose specialized profile also requires a full-scale local-exterior
 * scene (plan II annexe A / catalogue-coverage.csv column
 * `facade_locale_grande_echelle = oui`, 8 rows). The street connector module is an
 * entrance, never the whole building presented as delivered.
 */
export const FIXTURE_LOCAL_EXTERIOR_PAIRS: readonly string[] = [
  'entreprise/alimentation-agroalimentaire',
  'entreprise/textile-habillement',
  'entreprise/transport-logistique',
  'entreprise/artisanat',
  'btp-construction/immobilier',
  'btp-construction/energie-environnement',
  'btp-construction/artisanat',
  'btp-construction/autre'
] as const;

export type TaxonomyFixtureState =
  | 'seeded'
  | 'missing-domain'
  | 'known-nonseeded'
  | 'custom'
  | 'inactive';

export interface BusinessTaxonomyFixtureRow {
  /** Unique case identifier, e.g. `seeded:commerce/textile-habillement`. */
  readonly caseKey: string;
  readonly companySegment: string | null;
  readonly businessDomain: string | null;
  readonly state: TaxonomyFixtureState;
  /** True only for the 36 canonical seeded pairs. */
  readonly seededRelation: boolean;
  /** Synthetic profile the baseline resolution policy maps this row to. */
  readonly resolvesToProfileKey: string;
  /** False for every fallback row: neutral display is never domain coverage. */
  readonly countsAsCoverage: boolean;
  readonly rationale: string;
}

export interface SyntheticProfileExpectation {
  readonly profileKey: string;
  readonly kind: 'specialized' | 'neutral-family' | 'neutral-global';
  /** Specialized coverage requires BOTH a facade and an interior scene. */
  readonly facadeRequired: boolean;
  readonly interiorRequired: boolean;
  /** True for the 8 large-scale pairs (full local facade, not only a street connector). */
  readonly localExteriorRequired: boolean;
}

export function specializedProfileKey(companySegment: string, businessDomain: string): string {
  return `syn-${companySegment}-${businessDomain}`;
}

export function neutralFamilyProfileKey(family: 'boutique' | 'bureau' | 'atelier'): string {
  return `syn-neutral-${family}`;
}

export const NEUTRAL_GLOBAL_PROFILE_KEY = 'syn-neutral-global';

function buildRows(): readonly BusinessTaxonomyFixtureRow[] {
  const rows: BusinessTaxonomyFixtureRow[] = [];

  for (const segment of FIXTURE_SEGMENTS) {
    const seeded = FIXTURE_SEEDED_MATRIX[segment.code] ?? [];
    for (const domain of FIXTURE_DOMAINS) {
      if (seeded.includes(domain.code)) {
        rows.push({
          caseKey: `seeded:${segment.code}/${domain.code}`,
          companySegment: segment.code,
          businessDomain: domain.code,
          state: 'seeded',
          seededRelation: true,
          resolvesToProfileKey: specializedProfileKey(segment.code, domain.code),
          countsAsCoverage: true,
          rationale:
            `Lien seedé ${segment.code}/${domain.code} : profil spécialisé dédié, façade + intérieur exigés.`
        });
      } else {
        const family = FIXTURE_SEGMENT_FALLBACK_FAMILY[segment.code] ?? 'bureau';
        rows.push({
          caseKey: `known-nonseeded:${segment.code}/${domain.code}`,
          companySegment: segment.code,
          businessDomain: domain.code,
          state: 'known-nonseeded',
          seededRelation: false,
          resolvesToProfileKey: neutralFamilyProfileKey(family),
          countsAsCoverage: false,
          rationale:
            `Combinaison connue non seedée ${segment.code}/${domain.code} : admissible par règle admin ou ` +
            'EnforceSegmentDomainLinks=false ; repli neutre sûr puis file de production art, jamais de couverture déclarée.'
        });
      }
    }
    rows.push({
      caseKey: `missing-domain:${segment.code}`,
      companySegment: segment.code,
      businessDomain: null,
      state: 'missing-domain',
      seededRelation: false,
      resolvesToProfileKey: specializedProfileKey(segment.code, 'autre'),
      countsAsCoverage: false,
      rationale:
        `Segment ${segment.code} sans domaine : alias du profil seedé (${segment.code}, autre) ; ` +
        'l’alias résout l’affichage mais ne couvre aucun domaine.'
    });
  }

  // Synthetic edge rows: custom admin codes, inactive codes, partial/absent classification.
  rows.push(
    {
      caseKey: 'edge:custom-domain-on-known-segment',
      companySegment: 'commerce',
      businessDomain: 'e-sport',
      state: 'custom',
      seededRelation: false,
      resolvesToProfileKey: neutralFamilyProfileKey('boutique'),
      countsAsCoverage: false,
      rationale:
        'Code domaine custom créé par admin (kebab <= 50) sur segment connu : neutre de famille, aucune inférence métier.'
    },
    {
      caseKey: 'edge:custom-segment-with-known-domain',
      companySegment: 'cooperative',
      businessDomain: 'artisanat',
      state: 'custom',
      seededRelation: false,
      resolvesToProfileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
      countsAsCoverage: false,
      rationale: 'Segment custom inconnu du référentiel : repli neutre global même si le domaine est connu.'
    },
    {
      caseKey: 'edge:custom-segment-and-domain',
      companySegment: 'cooperative',
      businessDomain: 'e-sport',
      state: 'custom',
      seededRelation: false,
      resolvesToProfileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
      countsAsCoverage: false,
      rationale: 'Couple entièrement custom : neutre global + entrée dans la file de production catalogue.'
    },
    {
      caseKey: 'edge:custom-segment-max-length',
      companySegment: 'abcde-0123456789-abcde-0123456789-abcde-0123456789',
      businessDomain: 'autre',
      state: 'custom',
      seededRelation: false,
      resolvesToProfileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
      countsAsCoverage: false,
      rationale: 'Code custom à la limite exacte de 50 caractères : toujours valide, toujours neutre global.'
    },
    {
      caseKey: 'edge:inactive-known-seeded-pair',
      companySegment: 'services',
      businessDomain: 'sante-paramedical',
      state: 'inactive',
      seededRelation: true,
      resolvesToProfileKey: neutralFamilyProfileKey('bureau'),
      countsAsCoverage: false,
      rationale:
        'Paire seedée mais code désactivé (donnée synthétique) : repli neutre ; la mention illustrative interdit ' +
        'toute inférence de pharmacie, clinique ou acte de soin.'
    },
    {
      caseKey: 'edge:inactive-custom-domain',
      companySegment: 'commerce',
      businessDomain: 'e-sport',
      state: 'inactive',
      seededRelation: false,
      resolvesToProfileKey: neutralFamilyProfileKey('boutique'),
      countsAsCoverage: false,
      rationale: 'Code custom désactivé : inactif n’est ni inconnu ni absent ; repli neutre de famille.'
    },
    {
      caseKey: 'edge:domain-without-segment',
      companySegment: null,
      businessDomain: 'artisanat',
      state: 'missing-domain',
      seededRelation: false,
      resolvesToProfileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
      countsAsCoverage: false,
      rationale: 'Domaine sans segment (classification partielle) : le domaine seul n’est pas une clé visuelle globale.'
    },
    {
      caseKey: 'edge:unclassified-tenant',
      companySegment: null,
      businessDomain: null,
      state: 'missing-domain',
      seededRelation: false,
      resolvesToProfileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
      countsAsCoverage: false,
      rationale: 'Tenant legacy sans classification (champs nullable Master) : repli neutre global, historique inchangé.'
    }
  );

  return rows;
}

/** 36 seeded + 6 missing-domain + 24 known-nonseeded + 8 edge = 74 rows. */
export const BUSINESS_TAXONOMY_FIXTURE_ROWS: readonly BusinessTaxonomyFixtureRow[] = buildRows();

function buildProfileExpectations(): readonly SyntheticProfileExpectation[] {
  const profiles: SyntheticProfileExpectation[] = [];
  for (const segment of FIXTURE_SEGMENTS) {
    for (const domain of FIXTURE_SEEDED_MATRIX[segment.code] ?? []) {
      profiles.push({
        profileKey: specializedProfileKey(segment.code, domain),
        kind: 'specialized',
        facadeRequired: true,
        interiorRequired: true,
        localExteriorRequired: FIXTURE_LOCAL_EXTERIOR_PAIRS.includes(`${segment.code}/${domain}`)
      });
    }
  }
  for (const family of ['boutique', 'bureau', 'atelier'] as const) {
    profiles.push({
      profileKey: neutralFamilyProfileKey(family),
      kind: 'neutral-family',
      facadeRequired: true,
      interiorRequired: false,
      localExteriorRequired: false
    });
  }
  profiles.push({
    profileKey: NEUTRAL_GLOBAL_PROFILE_KEY,
    kind: 'neutral-global',
    facadeRequired: true,
    interiorRequired: false,
    localExteriorRequired: false
  });
  return profiles;
}

/** 36 specialized + 3 neutral-family + 1 neutral-global = 40 synthetic profiles. */
export const SYNTHETIC_PROFILE_EXPECTATIONS: readonly SyntheticProfileExpectation[] =
  buildProfileExpectations();
