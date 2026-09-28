import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of, retry, timer } from 'rxjs';
import { environment } from '@environments/environment';
import { AppModule, APP_MODULE_OPTIONS } from '@core/models/app-module';

/**
 * Sector-aware registration catalog.
 *
 * Wire format is locked (plan §3, decision C1): segment/domain are lowercase-kebab
 * string codes and `enabledModules` is a plain `number[]` of `AppModule` ids — this
 * mirrors the backend `SectorConfigurationCatalog` exactly so registration requires
 * no network round-trip between wizard steps.
 *
 * Phase 2 (plan WP-F1): `RegistrationCatalogService` fetches `GET
 * /api/public/sector-catalog` once per SPA session and serves the response through
 * the *same* synchronous public API used since Phase 1 (`segments`, `domains`,
 * `recommendedModules()`, …) — step components need zero changes. A 404 (backend
 * kill-switch off) or any network/5xx error falls back silently to the bundled
 * static catalog below, which remains the permanent, byte-identical Phase 1 fallback.
 */

export type CompanySegmentCode =
  | 'entreprise'
  | 'commerce'
  | 'services'
  | 'btp-construction'
  | 'association'
  | 'etablissement-educatif';

export type BusinessDomainCode =
  | 'technologie-informatique'
  | 'alimentation-agroalimentaire'
  | 'sante-paramedical'
  | 'textile-habillement'
  | 'transport-logistique'
  | 'immobilier'
  | 'energie-environnement'
  | 'communication-marketing'
  | 'artisanat'
  | 'autre';

export interface SegmentOption {
  code: string;
  label: string;
  subtitle: string;
  icon: string;
  tone: string;
}

export interface DomainOption {
  code: string;
  label: string;
  icon: string;
  tone: string;
}

export interface ModuleCatalogEntry {
  id: AppModule;
  label: string;
}

/**
 * Generic `ApiResponse<T>` envelope used by every backend controller
 * (`FactuTrust.Application.DTOs.ApiResponse<T>`, camelCase JSON).
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T | null;
  message?: string | null;
  code?: string | null;
  errors?: string[];
}

/** Wire shape of `GET /api/public/sector-catalog` (locked contract, additive-only). */
export interface RemoteSectorSegmentDto {
  code: string;
  labelFr: string;
  descriptionFr: string;
  iconKey: string;
  sortOrder: number;
  coreModuleIds: number[];
  recommendedModuleIds: number[];
  defaultWarehouseName?: string | null;
  /** Ordered list of domain codes available for this segment (Phase 2 addition). */
  domainCodes: string[];
}

export interface RemoteSectorDomainDto {
  code: string;
  labelFr: string;
  sortOrder: number;
  additionalModuleIds: number[];
}

export interface RemoteSectorModuleDto {
  id: number;
  code: string;
  labelFr: string;
  isCore: boolean;
  /**
   * Whether this module is freely selectable on the Free plan during signup. Mirrors
   * the backend `availableOnFreePlan` flag the sector-catalog endpoint writes on every
   * module (and the checked-in snapshot). Absent on older payloads ⇒ treated as
   * `true` (selectable); premium modules carry `false` (see `PREMIUM_MODULE_IDS`).
   */
  availableOnFreePlan?: boolean;
}

/**
 * Backend `SectorModuleDependencyDto`: `requiredModuleId` is the prerequisite — enabling
 * `moduleId` auto-pulls `requiredModuleId`. (The backend emits `requiredModuleId`, not
 * `requiresModuleId`.)
 */
export interface RemoteModuleDependencyDto {
  moduleId: number;
  requiredModuleId: number;
}

/**
 * Backend `SuggestedTaxRegimeDto` (plan §3.1) — admin-editable segment → tax regime
 * suggestion, surfaced with a French explanatory note. Additive/optional: absent on
 * catalogs served before this field ships server-side (fallback catalog never has it).
 */
export interface RemoteSuggestedTaxRegimeDto {
  segmentCode: string;
  regime: number;
  noteFr: string;
}

export interface SectorCatalogDto {
  segments: RemoteSectorSegmentDto[];
  domains: RemoteSectorDomainDto[];
  modules: RemoteSectorModuleDto[];
  moduleDependencies: RemoteModuleDependencyDto[];
  /** Optional (plan §3.1) — absent on older/static payloads. */
  suggestedTaxRegimes?: RemoteSuggestedTaxRegimeDto[];
}

export type CatalogLoadState = 'idle' | 'loading' | 'remote' | 'fallback';

/** Segments — order matches the reference design (3×2 grid). */
export const SEGMENT_OPTIONS: readonly SegmentOption[] = [
  {
    code: 'entreprise',
    label: $localize`:@@auth.registration-catalog.ts.entreprise.d03e74b6:Entreprise`,
    subtitle: $localize`:@@auth.registration-catalog.ts.societes.commerciales.et.de.services.aux.090bd8fc:Sociétés commerciales et de services aux entreprises`,
    icon: 'pi-building',
    tone: 'tone-blue'
  },
  {
    code: 'commerce',
    label: $localize`:@@auth.registration-catalog.ts.commerce.d3440a61:Commerce`,
    subtitle: $localize`:@@auth.registration-catalog.ts.negoce.et.distribution.8fe6ca95:Négoce et distribution`,
    icon: 'pi-shopping-cart',
    tone: 'tone-green'
  },
  {
    code: 'services',
    label: $localize`:@@auth.registration-catalog.ts.prestations.de.services.484e1a2e:Prestations de services`,
    subtitle: $localize`:@@auth.registration-catalog.ts.services.et.conseils.28b061db:Services et conseils`,
    icon: 'pi-briefcase',
    tone: 'tone-orange'
  },
  {
    code: 'btp-construction',
    label: $localize`:@@auth.registration-catalog.ts.btp.construction.90a8ed11:BTP & Construction`,
    subtitle: $localize`:@@auth.registration-catalog.ts.batiment.et.travaux.publics.f9aaa2de:Bâtiment et travaux publics`,
    icon: 'pi-hammer',
    tone: 'tone-yellow'
  },
  {
    code: 'association',
    label: $localize`:@@auth.registration-catalog.ts.association.1948b8a7:Association`,
    subtitle: $localize`:@@auth.registration-catalog.ts.organismes.a.but.non.lucratif.3dc77687:Organismes à but non lucratif`,
    icon: 'pi-heart',
    tone: 'tone-pink'
  },
  {
    code: 'etablissement-educatif',
    label: $localize`:@@auth.registration-catalog.ts.etablissement.educatif.43715b4e:Établissement éducatif`,
    subtitle: $localize`:@@auth.registration-catalog.ts.ecoles.universites.centres.de.formation.4fbdbc45:Écoles, universités, centres de formation`,
    icon: 'pi-graduation-cap',
    tone: 'tone-indigo'
  }
] as const;

/** Domains — order matches the reference design (5×2 grid). */
export const DOMAIN_OPTIONS: readonly DomainOption[] = [
  { code: 'technologie-informatique', label: $localize`:@@auth.registration-catalog.ts.technologie.informatique.c3df87ca:Technologie & Informatique`, icon: 'pi-desktop', tone: 'tone-blue' },
  { code: 'alimentation-agroalimentaire', label: $localize`:@@auth.registration-catalog.ts.alimentation.agroalimentaire.7a2bb17d:Alimentation & Agroalimentaire`, icon: 'pi-apple', tone: 'tone-green' },
  { code: 'sante-paramedical', label: $localize`:@@auth.registration-catalog.ts.sante.paramedical.ec26e67f:Santé & Paramédical`, icon: 'pi-heart-fill', tone: 'tone-purple' },
  { code: 'textile-habillement', label: $localize`:@@auth.registration-catalog.ts.textile.habillement.abc7dc02:Textile & Habillement`, icon: 'pi-tag', tone: 'tone-blue' },
  { code: 'transport-logistique', label: $localize`:@@auth.registration-catalog.ts.transport.logistique.a099a5fb:Transport & Logistique`, icon: 'pi-truck', tone: 'tone-orange' },
  { code: 'immobilier', label: $localize`:@@auth.registration-catalog.ts.immobilier.94b16f03:Immobilier`, icon: 'pi-home', tone: 'tone-indigo' },
  { code: 'energie-environnement', label: $localize`:@@auth.registration-catalog.ts.energie.environnement.f21c5480:Énergie & Environnement`, icon: 'pi-bolt', tone: 'tone-teal' },
  { code: 'communication-marketing', label: $localize`:@@auth.registration-catalog.ts.communication.marketing.f3718563:Communication & Marketing`, icon: 'pi-megaphone', tone: 'tone-pink' },
  { code: 'artisanat', label: $localize`:@@auth.registration-catalog.ts.artisanat.c045fdd5:Artisanat`, icon: 'pi-palette', tone: 'tone-yellow' },
  { code: 'autre', label: $localize`:@@auth.registration-catalog.ts.autre.domaine.aa839997:Autre domaine`, icon: 'pi-ellipsis-h', tone: 'tone-gray' }
] as const;

/** Core modules — always on, never deselectable, never sent as "optional". */
export const CORE_MODULE_IDS: readonly AppModule[] = [
  AppModule.Administration,
  AppModule.Clients,
  AppModule.Products,
  AppModule.Sales,
  AppModule.Treasury,
  AppModule.Reports
];

/**
 * Modules reserved for a paid plan — never freely selectable on the Free plan during signup.
 * Politique actuelle (2026-09) : liste vide — tous les modules sont disponibles sur Free ;
 * les modules libérés apparaissent dans « Autres modules » (opt-in, interrupteur OFF).
 * Retour arrière : réinsérer AI, Forecasting, Studio, Payroll ici et dans le snapshot backend.
 */
export const PREMIUM_MODULE_IDS: readonly AppModule[] = [];

const SEGMENT_RECOMMENDED_MODULES: Record<CompanySegmentCode, readonly AppModule[]> = {
  'entreprise': [AppModule.Purchases, AppModule.Stock, AppModule.Accounting, AppModule.CRM, AppModule.Fiscal],
  'commerce': [AppModule.Purchases, AppModule.Stock, AppModule.Fiscal],
  'services': [AppModule.CRM, AppModule.Projects, AppModule.RecurringContracts, AppModule.Fiscal],
  'btp-construction': [AppModule.Purchases, AppModule.Stock, AppModule.Projects, AppModule.Fiscal],
  'association': [AppModule.Accounting, AppModule.Fiscal],
  'etablissement-educatif': [AppModule.RecurringContracts, AppModule.Accounting, AppModule.Fiscal]
};

const DOMAIN_MODULE_OVERLAY: Record<BusinessDomainCode, readonly AppModule[]> = {
  'technologie-informatique': [AppModule.Projects, AppModule.RecurringContracts],
  'alimentation-agroalimentaire': [AppModule.Stock, AppModule.Purchases],
  'sante-paramedical': [AppModule.CRM],
  'textile-habillement': [AppModule.Stock],
  'transport-logistique': [AppModule.Stock],
  'immobilier': [AppModule.Projects, AppModule.RecurringContracts],
  'energie-environnement': [AppModule.Projects, AppModule.Purchases],
  'communication-marketing': [AppModule.CRM],
  'artisanat': [AppModule.Stock, AppModule.Purchases],
  // « Autre domaine » reste volontairement vide : c'est le filet de sécurité choisi quand
  // l'utilisateur ne se reconnaît dans aucun domaine — il ne doit rien présumer de son activité.
  'autre': []
};

/** Tranches d'effectif — liste blanche fermée, miroir de `Tenant.AllowedHeadcountBands` côté backend. */
export type HeadcountBand = '1' | '2-9' | '10-49' | '50+';

export const HEADCOUNT_BANDS: readonly HeadcountBand[] = ['1', '2-9', '10-49', '50+'];

/**
 * Réponses de profilage de l'étape Configuration (lot 3). `null` = question sans réponse,
 * jamais « non » : c'est ce qui rend la fonctionnalité strictement additive (aucune réponse ⇒
 * recommandation identique à celle d'avant ce lot).
 */
export interface RegistrationProfileAnswers {
  hasPhysicalStock: boolean | null;
  sellsToConsumers: boolean | null;
  headcountBand: HeadcountBand | null;
  accountingDelegatedToFirm: boolean | null;
}

export const EMPTY_PROFILE_ANSWERS: RegistrationProfileAnswers = {
  hasPhysicalStock: null,
  sellsToConsumers: null,
  headcountBand: null,
  accountingDelegatedToFirm: null
};

/**
 * Surcouche de profilage appliquée à la recommandation sectorielle.
 *
 * Ordre d'application, volontairement figé et testé : d'abord TOUS les ajouts, puis TOUS les
 * retraits. Les retraits l'emportent donc sur les ajouts, ce qui tranche le cas contradictoire
 * « vend aux particuliers = oui » + « stock physique = non » (négoce sans stock détenu) en faveur
 * de la réponse la plus explicite.
 *
 * Trois garde-fous inconditionnels :
 *  - un module cœur n'est jamais retiré ;
 *  - un module verrouillé sur le plan Free n'est jamais ajouté (il serait refusé côté serveur et
 *    produirait un avertissement inutile) ;
 *  - la tranche d'effectif n'ajoute ni ne retire rien. Le seul module qu'elle désignerait est
 *    « RH & Paie », verrouillé sur le plan Free : elle est donc conservée pour l'analyse et
 *    l'affichage, sans effet sur la sélection.
 */
export function applyProfileOverlay(
  base: readonly AppModule[],
  answers: RegistrationProfileAnswers,
  options: { coreModuleIds: readonly AppModule[]; isLocked: (id: AppModule) => boolean }
): AppModule[] {
  const coreSet = new Set(options.coreModuleIds);
  const selection = new Set<AppModule>(base);

  const add = (id: AppModule) => {
    if (!options.isLocked(id) && id !== AppModule.Honoraires) {
      selection.add(id);
    }
  };
  const remove = (id: AppModule) => {
    if (!coreSet.has(id)) {
      selection.delete(id);
    }
  };

  // 1) Ajouts.
  if (answers.hasPhysicalStock === true) {
    add(AppModule.Stock);
    add(AppModule.Purchases);
  }
  // « Point de Vente » exige Ventes + Produits + Stock (cf. app-navigation.registry) : activer
  // Stock est donc le seul levier réel qui débloque la caisse pour une activité B2C.
  if (answers.sellsToConsumers === true) {
    add(AppModule.Stock);
  }

  // 2) Retraits.
  if (answers.hasPhysicalStock === false) {
    remove(AppModule.Stock);
  }
  if (answers.accountingDelegatedToFirm === true) {
    remove(AppModule.Accounting);
  }

  return Array.from(selection).sort((a, b) => a - b);
}

const SEGMENT_DEFAULT_WAREHOUSE_NAME: Record<CompanySegmentCode, string> = {
  'entreprise': 'Entrepôt Principal',
  'commerce': 'Magasin principal',
  'services': 'Entrepôt Principal',
  'btp-construction': 'Dépôt chantier',
  'association': 'Entrepôt Principal',
  'etablissement-educatif': 'Entrepôt Principal'
};

/**
 * Fallback segment→domain matrix (plan §3.1) — exact copy of the backend
 * `SectorConfigurationCatalog` matrix (`SegmentDefinition.AllowedDomainCodes`). Used by
 * `domainsForSegment()`'s fallback path so the "N domaines adaptés à votre segment" chip is
 * honest even when the remote catalog is unavailable. `autre` is always included as the
 * universal safety-net fallback.
 */
export const SEGMENT_ALLOWED_DOMAINS: Record<CompanySegmentCode, readonly BusinessDomainCode[]> = {
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
  'btp-construction': [
    'immobilier',
    'energie-environnement',
    'artisanat',
    'autre'
  ],
  'association': [
    'sante-paramedical',
    'energie-environnement',
    'communication-marketing',
    'artisanat',
    'autre'
  ],
  'etablissement-educatif': [
    'technologie-informatique',
    'sante-paramedical',
    'artisanat',
    'communication-marketing',
    'autre'
  ]
};

/** Fallback tone palette for segment/domain codes the static catalog doesn't know (backoffice-added). */
const TONE_PALETTE: readonly string[] = [
  'tone-blue', 'tone-green', 'tone-orange', 'tone-yellow', 'tone-pink',
  'tone-indigo', 'tone-purple', 'tone-teal', 'tone-gray'
];

/** All `AppModule` numeric ids known to the frontend catalog. */
function allModuleIds(): AppModule[] {
  return APP_MODULE_OPTIONS.map(o => o.value);
}

function isKnownSegment(code: string | null | undefined): code is CompanySegmentCode {
  return !!code && Object.prototype.hasOwnProperty.call(SEGMENT_RECOMMENDED_MODULES, code);
}

function isKnownDomain(code: string | null | undefined): code is BusinessDomainCode {
  return !!code && Object.prototype.hasOwnProperty.call(DOMAIN_MODULE_OVERLAY, code);
}

/**
 * Pure function mirroring the backend `SectorConfigurationCatalog.Resolve` merge
 * (segment base ∪ domain overlay ∪ core). Unknown/absent segment ⇒ core modules only.
 *
 * This function is pinned by `registration-catalog.spec.ts` and drives the static
 * fallback — it must stay byte-identical to Phase 1 behavior.
 */
export function recommendedModulesFor(
  segment: string | null | undefined,
  domain: string | null | undefined
): AppModule[] {
  const set = new Set<AppModule>(CORE_MODULE_IDS);

  if (isKnownSegment(segment)) {
    for (const id of SEGMENT_RECOMMENDED_MODULES[segment]) {
      set.add(id);
    }
  }

  if (isKnownDomain(domain)) {
    for (const id of DOMAIN_MODULE_OVERLAY[domain]) {
      set.add(id);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

/** Every module that is neither core, recommended for the profile, premium (paid plan), nor Honoraires (firm-native, never offered). */
export function optionalModulesFor(
  segment: string | null | undefined,
  domain: string | null | undefined
): AppModule[] {
  const recommended = new Set(recommendedModulesFor(segment, domain));
  return allModuleIds()
    .filter(id => id !== AppModule.Honoraires && !recommended.has(id) && !PREMIUM_MODULE_IDS.includes(id))
    .sort((a, b) => a - b);
}

export function defaultWarehouseNameFor(segment: string | null | undefined): string | undefined {
  return isKnownSegment(segment) ? SEGMENT_DEFAULT_WAREHOUSE_NAME[segment] : undefined;
}

function toneForIndex(index: number): string {
  const safe = ((index % TONE_PALETTE.length) + TONE_PALETTE.length) % TONE_PALETTE.length;
  return TONE_PALETTE[safe];
}

/**
 * Best-effort mapping from the backend `iconKey` (e.g. `"shopping-cart"`, `"hard-hat"`)
 * to a PrimeIcons class. Used only for segment codes unknown to the bundled static
 * catalog (backoffice-added segments) — known codes keep their curated Phase 1
 * icon/tone below for exact visual continuity with the design mockups, since the
 * locked wire contract carries no `tone` field and the backend's `iconKey` values
 * don't 1:1 match the frontend's curated icon choices for the original 6 segments.
 */
function iconKeyToPiClass(iconKey: string | null | undefined): string {
  if (!iconKey) return 'pi-sitemap';
  return iconKey.startsWith('pi-') ? iconKey : `pi-${iconKey}`;
}

/** Injectable seam — HTTP-backed catalog with static fallback (plan WP-F1). */
@Injectable({ providedIn: 'root' })
export class RegistrationCatalogService {
  private readonly http = inject(HttpClient);

  /** Non-null once a valid remote payload has been received; null in idle/loading/fallback. */
  private readonly remoteCatalog = signal<SectorCatalogDto | null>(null);

  /** Cached set of every `AppModule` numeric id known to the frontend catalog — used to filter
   *  unknown ids out of the remote payload (defensive; the backend only sends known ids). */
  private readonly knownModuleIds = new Set<AppModule>(allModuleIds());

  private isValidModuleId(id: number): id is AppModule {
    return this.knownModuleIds.has(id as AppModule);
  }

  /** Observable load lifecycle — see `load()`. */
  readonly loadState = signal<CatalogLoadState>('idle');

  /** True once a remote catalog has replaced the static one (used to gate domain filtering UI). */
  get isRemote(): boolean {
    return this.remoteCatalog() !== null;
  }

  get segments(): readonly SegmentOption[] {
    const remote = this.remoteCatalog();
    if (!remote) return SEGMENT_OPTIONS;
    return remote.segments
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(s => this.toSegmentOption(s));
  }

  get domains(): readonly DomainOption[] {
    const remote = this.remoteCatalog();
    if (!remote) return DOMAIN_OPTIONS;
    return remote.domains
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(d => this.toDomainOption(d));
  }

  get coreModuleIds(): readonly AppModule[] {
    const remote = this.remoteCatalog();
    if (!remote || remote.segments.length === 0) return CORE_MODULE_IDS;
    const ids = new Set<AppModule>();
    for (const s of remote.segments) {
      for (const id of s.coreModuleIds) {
        if (this.isValidModuleId(id)) ids.add(id);
      }
    }
    return ids.size > 0 ? Array.from(ids).sort((a, b) => a - b) : CORE_MODULE_IDS;
  }

  get modules(): readonly ModuleCatalogEntry[] {
    const remote = this.remoteCatalog();
    if (!remote) return APP_MODULE_OPTIONS.map(o => ({ id: o.value, label: o.label }));
    return remote.modules
      .filter(m => this.isValidModuleId(m.id))
      .map(m => ({ id: m.id, label: m.labelFr }));
  }

  segmentLabel(code: string | null | undefined): string {
    return this.segments.find(s => s.code === code)?.label ?? '';
  }

  domainLabel(code: string | null | undefined): string {
    return this.domains.find(d => d.code === code)?.label ?? '';
  }

  /**
   * Suggested tax regime for a segment (plan §3.1). Returns `undefined` whenever the
   * remote catalog hasn't loaded yet, doesn't carry `suggestedTaxRegimes` (older
   * backend, or the static fallback catalog which never has this field), or has no
   * entry for `segment` — the wizard then behaves exactly as before (no suggestion).
   */
  suggestedTaxRegimeFor(segment: string | null | undefined): RemoteSuggestedTaxRegimeDto | undefined {
    if (!segment) return undefined;
    const remote = this.remoteCatalog();
    if (!remote || !Array.isArray(remote.suggestedTaxRegimes)) return undefined;
    return remote.suggestedTaxRegimes.find(r => r.segmentCode === segment);
  }

  moduleLabel(id: AppModule): string {
    return this.modules.find(m => m.id === id)?.label ?? String(id);
  }

  isCoreModule(id: AppModule): boolean {
    return this.coreModuleIds.includes(id);
  }

  /**
   * Whether a module is locked on the Free plan — i.e. not freely selectable
   * during signup and never submitted in `enabledModules`. A module is locked when
   * it is one of the canonical premium modules (`PREMIUM_MODULE_IDS`) OR the remote
   * sector catalog explicitly flags it `availableOnFreePlan: false`. The constant is
   * the frontend's authoritative mirror of the backend's premium set (and applies in
   * both remote and static-fallback modes); the remote flag is a defensive second
   * source so a backend that additionally gates a non-canonical module is honored too.
   * An absent flag is treated as selectable (only the constant can lock in fallback).
   */
  isLockedOnFreePlan(id: AppModule): boolean {
    if (PREMIUM_MODULE_IDS.includes(id)) return true;
    const remote = this.remoteCatalog();
    if (remote) {
      const mod = remote.modules.find(m => m.id === id);
      if (mod && mod.availableOnFreePlan === false) return true;
    }
    return false;
  }

  /**
   * Segment-filtered, ordered domain list (plan WP-F2, §3.3). No/unknown segment ⇒ `[]`
   * in both remote and fallback modes. Remote mode: known segment ⇒ its ordered
   * `domainCodes`. Fallback mode (remote catalog unavailable): known segment ⇒ the
   * static `SEGMENT_ALLOWED_DOMAINS` matrix (plan §3.1), mirroring the backend
   * `SectorConfigurationCatalog`. In both modes, `autre` is appended when absent (never
   * invalidates a user who already picked "Autre domaine").
   */
  domainsForSegment(segment: string | null | undefined): readonly DomainOption[] {
    const remote = this.remoteCatalog();
    const byCode = new Map(this.domains.map(d => [d.code, d] as const));

    let codes: readonly string[] | undefined;
    if (remote) {
      if (!segment) return [];
      const seg = remote.segments.find(s => s.code === segment);
      codes = seg?.domainCodes;
    } else {
      if (!isKnownSegment(segment)) return [];
      codes = SEGMENT_ALLOWED_DOMAINS[segment];
    }
    if (!codes) {
      return [];
    }

    const ordered: DomainOption[] = [];
    for (const code of codes) {
      const opt = byCode.get(code);
      if (opt) ordered.push(opt);
    }
    if (!ordered.some(d => d.code === 'autre')) {
      const autre = byCode.get('autre');
      if (autre) ordered.push(autre);
    }
    return ordered;
  }

  recommendedModules(segment: string | null | undefined, domain: string | null | undefined): AppModule[] {
    const remote = this.remoteCatalog();
    if (!remote) {
      return recommendedModulesFor(segment, domain);
    }

    const coreSet = new Set(this.coreModuleIds);
    const set = new Set<AppModule>();

    const seg = remote.segments.find(s => s.code === segment);
    if (seg) {
      for (const id of seg.recommendedModuleIds) {
        if (this.isValidModuleId(id) && !coreSet.has(id)) set.add(id);
      }
    }

    const dom = remote.domains.find(d => d.code === domain);
    if (dom) {
      for (const id of dom.additionalModuleIds) {
        if (this.isValidModuleId(id) && !coreSet.has(id)) set.add(id);
      }
    }

    // Defensive closure (plan WP-F3): a recommended module never silently omits one of
    // its hard dependencies. No-op when `moduleDependencies` is empty.
    this.closeDependencies(set);

    return Array.from(set)
      .filter(m => m !== AppModule.Honoraires && !this.isLockedOnFreePlan(m))
      .sort((a, b) => a - b);
  }

  optionalModules(segment: string | null | undefined, domain: string | null | undefined): AppModule[] {
    const remote = this.remoteCatalog();
    if (!remote) {
      return optionalModulesFor(segment, domain);
    }
    const recommended = new Set(this.recommendedModules(segment, domain));
    const coreSet = new Set(this.coreModuleIds);
    return this.modules
      .map(m => m.id)
      .filter(id => id !== AppModule.Honoraires && !recommended.has(id) && !coreSet.has(id) && !this.isLockedOnFreePlan(id))
      .sort((a, b) => a - b);
  }

  /**
   * Modules locked on the Free plan that are present in the (remote or static)
   * catalog — the "Plan supérieur" group rendered as locked, non-toggleable cards
   * during signup. Returns only modules actually present in the catalog (so a
   * premium id the backend doesn't serve is silently absent), sorted ascending,
   * and never includes core modules (premium modules are never core). Disjoint from
   * `recommendedModules()` and `optionalModules()`, which both exclude locked modules.
   *
   * Ne prend pas de segment/domaine : le verrou « plan Free » est une propriété du module et du
   * plan, jamais du profil sectoriel. La signature en portait deux, qui n'étaient jamais lus.
   */
  premiumModules(): AppModule[] {
    const coreSet = new Set(this.coreModuleIds);
    return this.modules
      .map(m => m.id)
      .filter(id => !coreSet.has(id) && this.isLockedOnFreePlan(id))
      .sort((a, b) => a - b);
  }

  defaultWarehouseName(segment: string | null | undefined): string | undefined {
    const remote = this.remoteCatalog();
    if (!remote) {
      return defaultWarehouseNameFor(segment);
    }
    const seg = remote.segments.find(s => s.code === segment);
    return seg?.defaultWarehouseName ?? undefined;
  }

  /**
   * Transitive closure of "requires" edges for `moduleId` — every module that must be
   * ON for `moduleId` to work (plan WP-F3). Empty in static/fallback mode. Guards
   * against cycles with a visited set even though the backend rejects them.
   */
  requiredBy(moduleId: AppModule): AppModule[] {
    const edges = this.dependencyEdges;
    if (edges.length === 0) return [];

    const result: AppModule[] = [];
    const visited = new Set<AppModule>([moduleId]);
    const queue: AppModule[] = [moduleId];

    while (queue.length > 0) {
      const current = queue.shift() as AppModule;
      for (const edge of edges) {
        if (edge.moduleId === current && !visited.has(edge.requiresModuleId)) {
          visited.add(edge.requiresModuleId);
          result.push(edge.requiresModuleId);
          queue.push(edge.requiresModuleId);
        }
      }
    }

    return result;
  }

  /** Among `enabled`, the modules that (transitively) require `moduleId` (plan WP-F3). */
  dependentsOf(moduleId: AppModule, enabled: readonly AppModule[]): AppModule[] {
    if (this.dependencyEdges.length === 0) return [];
    return enabled.filter(id => id !== moduleId && this.requiredBy(id).includes(moduleId));
  }

  /** Number of retries attempted after the initial request before falling back (plan 2.1 — 3 attempts total). */
  private static readonly RETRY_COUNT = 2;
  /** Backoff base delay (ms); attempt N waits `RETRY_BACKOFF_MS_BASE * N` before retrying. */
  private static readonly RETRY_BACKOFF_MS_BASE = 1500;

  /**
   * True once the catalog has fallen back to the bundled static table after exhausting
   * its retries (plan 2.1). Drives the discreet "recommandations par défaut" wizard
   * indicator — kept separate from `loadState() === 'fallback'` so a future caller
   * (telemetry dashboard, support tooling) can query it independently of the load
   * lifecycle enum.
   */
  readonly usedStaticFallback = signal(false);

  /**
   * Fetches the live sector catalog once per SPA session and caches it in-memory
   * (plan WP-F1). No-op when already loading/loaded, or when the frontend kill-switch
   * `featureFlags.sectorCatalogHttp` is off. Never surfaces a blocking error to the
   * caller — registration must never be blocked by this endpoint — but a failure after
   * retries is now "loud": logged to the console/telemetry sink and reflected through
   * `usedStaticFallback()` so the wizard can show a discreet indicator (plan 2.1).
   * Root-provided means an admin editing rules mid-session won't be reflected without a
   * hard reload; acceptable for the registration flow.
   */
  load(): void {
    if (this.loadState() !== 'idle') return;
    if (!environment.featureFlags.sectorCatalogHttp) return;

    this.loadState.set('loading');

    this.http
      .get<ApiResponse<SectorCatalogDto>>(`${environment.apiUrl}/public/sector-catalog`)
      .pipe(
        // Plan 2.1: 3 attempts total (initial + 2 retries) with linear backoff before
        // falling back to the static catalog — was a single retry (2 attempts) in Phase 1.
        retry({
          count: RegistrationCatalogService.RETRY_COUNT,
          delay: (_error, retryCount) => timer(RegistrationCatalogService.RETRY_BACKOFF_MS_BASE * retryCount)
        }),
        catchError(() => of(null))
      )
      .subscribe(res => {
        const data = res?.data;
        if (!res || !res.success || !data || !Array.isArray(data.segments) || data.segments.length === 0) {
          this.reportStaticFallback(res);
          return;
        }
        this.remoteCatalog.set(data);
        this.loadState.set('remote');
      });
  }

  /**
   * Loud fallback reporting (plan 2.1 — "bruyant" instead of silent): console telemetry
   * with enough context to diagnose an endpoint outage, plus the `usedStaticFallback`
   * signal the wizard reads to show its discreet indicator.
   */
  private reportStaticFallback(res: ApiResponse<SectorCatalogDto> | null): void {
    console.warn(
      '[RegistrationCatalogService] Sector catalog unavailable or empty after ' +
        `${RegistrationCatalogService.RETRY_COUNT + 1} attempt(s) — using static fallback catalog.`,
      { lastResponseSuccess: res?.success ?? null, hasData: !!res?.data }
    );
    this.usedStaticFallback.set(true);
    this.loadState.set('fallback');
  }

  private get dependencyEdges(): readonly { moduleId: AppModule; requiresModuleId: AppModule }[] {
    const remote = this.remoteCatalog();
    if (!remote || !Array.isArray(remote.moduleDependencies)) return [];
    return remote.moduleDependencies
      .filter(d => this.isValidModuleId(d.moduleId) && this.isValidModuleId(d.requiredModuleId))
      .map(d => ({ moduleId: d.moduleId, requiresModuleId: d.requiredModuleId }));
  }

  private closeDependencies(set: Set<AppModule>): void {
    for (const id of Array.from(set)) {
      for (const dep of this.requiredBy(id)) {
        set.add(dep);
      }
    }
  }

  private toSegmentOption(seg: RemoteSectorSegmentDto): SegmentOption {
    const staticMatch = SEGMENT_OPTIONS.find(s => s.code === seg.code);
    return {
      code: seg.code,
      label: seg.labelFr,
      subtitle: seg.descriptionFr,
      icon: staticMatch?.icon ?? iconKeyToPiClass(seg.iconKey),
      tone: staticMatch?.tone ?? toneForIndex(seg.sortOrder)
    };
  }

  private toDomainOption(dom: RemoteSectorDomainDto): DomainOption {
    const staticMatch = DOMAIN_OPTIONS.find(d => d.code === dom.code);
    return {
      code: dom.code,
      label: dom.labelFr,
      icon: staticMatch?.icon ?? 'pi-sitemap',
      tone: staticMatch?.tone ?? toneForIndex(dom.sortOrder)
    };
  }
}
