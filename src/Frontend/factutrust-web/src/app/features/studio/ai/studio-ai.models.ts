/**
 * Modèles TypeScript de l'atelier Studio IA (P1).
 *
 * 1. Spec canonique — miroir de `StudioAiSpecCanonical.cs` (backend, P0). Les noms sont ceux
 *    réellement émis par le serveur : une entité est identifiée par `ref`, les données de
 *    référence par `entityRef`, la cible d'une relation par `relationTo`.
 * 2. DTO des endpoints `api/studio/ai/plans`, `api/studio/templates`, `api/ai/studio/capabilities`
 *    (camelCase, enveloppés dans `ApiResponse<T>`).
 */

// ---------------------------------------------------------------------------------------------
// 1. Spec canonique
// ---------------------------------------------------------------------------------------------

/** Types de champ canoniques acceptés par le parseur serveur (`StudioAiSystemSpec` / `StudioAiAppSpec`). */
export type StudioSpecFieldType =
  | 'text'
  | 'multilinetext'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'money'
  | 'percentage'
  | 'rating'
  | 'qrcode'
  | 'barcode'
  | 'autonumber'
  | 'attachment'
  | 'signature'
  | 'relation';

export const STUDIO_SPEC_FIELD_TYPES: readonly StudioSpecFieldType[] = [
  'text', 'multilinetext', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiselect',
  'money', 'percentage', 'rating', 'qrcode', 'barcode', 'autonumber', 'attachment', 'signature', 'relation'
];

export interface StudioSpecOption {
  value: string;
  label: string;
}

export interface StudioSpecFieldConfig {
  currency?: string;
  max?: number;
  format?: string;
  [k: string]: unknown;
}

export interface StudioSpecField {
  key: string;
  label: string;
  type: StudioSpecFieldType;
  required: boolean;
  unique: boolean;
  options?: StudioSpecOption[];
  config?: StudioSpecFieldConfig | null;
  /** `ref` d'une autre entité de la spec, ou cible ERP (`clients`, `products`). */
  relationTo?: string;
}

export interface StudioSpecFormFieldRef {
  field: string;
  width?: 'full' | 'half';
  label?: string;
}

export interface StudioSpecFormSection {
  title?: string;
  fields: StudioSpecFormFieldRef[];
}

export interface StudioSpecForm {
  sections: StudioSpecFormSection[];
}

export interface StudioSpecReportMeasure {
  field?: string;
  fn: string;
}

export interface StudioSpecReportFilter {
  field: string;
  op: string;
  value: unknown;
}

export interface StudioSpecReportSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface StudioSpecReport {
  displayName: string;
  groupBy?: string[];
  measures?: StudioSpecReportMeasure[];
  columns?: string[];
  filters?: StudioSpecReportFilter[];
  sort?: StudioSpecReportSort[];
}

/**
 * Entité (table) d'une spec système. Les clés inconnues (`isReferenceData`, `workflow`,
 * `automations`… présentes dans certains modèles) sont conservées telles quelles pour ne pas
 * les perdre lors d'un `PUT spec` ; le serveur les ignore avant P2.
 */
export interface StudioSpecEntity {
  ref: string;
  displayName: string;
  displayNamePlural: string;
  icon?: string;
  description?: string;
  fields: StudioSpecField[];
  form?: StudioSpecForm;
  report?: StudioSpecReport;
  /**
   * Clé d'une table EXISTANTE à réutiliser telle quelle (alias serveur `existing` / `useExisting` /
   * `reuse`) : champs, formulaire et état de cette entité sont alors ignorés à l'exécution (R21).
   */
  existingKey?: string | null;
  /** Vues enregistrées proposées (canonique `StudioAiSpecCanonical` l.352–370 ; alias du plan maître tolérés en lecture). */
  views?: StudioSpecRecordView[];
  [k: string]: unknown;
}

/** Filtre d'une vue (`{ field, op, value? }`). */
export interface StudioSpecViewFilter {
  field: string;
  op: string;
  value?: unknown;
}

/** Tri d'une vue : canonique `desc`, alias plan maître `descending`. */
export interface StudioSpecViewSort {
  field: string;
  desc?: boolean;
  descending?: boolean;
}

/**
 * Vue enregistrée d'une entité (D17). Forme canonique : `{ name, mode, columns[], filters[], sort[],
 * groupBy?, start?, end?, title?, isDefault }` ; les alias du plan maître (`displayName`, `dateField`,
 * `endDateField`, `titleField`) sont conservés via la signature d'index et lus par `viewDisplayName`.
 */
export interface StudioSpecRecordView {
  name?: string;
  displayName?: string;
  mode: 'list' | 'kanban' | 'calendar' | 'liste' | 'calendrier' | string;
  columns?: string[];
  filters?: StudioSpecViewFilter[];
  sort?: StudioSpecViewSort[];
  groupBy?: string;
  start?: string;
  end?: string;
  title?: string;
  isDefault?: boolean;
  [k: string]: unknown;
}

/** Relation racine plusieurs-à-plusieurs de la spec canonique (`relations[]`, l.121–135). */
export interface StudioSpecRelation {
  kind: 'many_to_many' | string;
  from: string;
  to: string;
  label?: string;
  junctionName?: string;
}

export interface StudioSpecSeed {
  entityRef: string;
  records: Record<string, unknown>[];
}

export interface StudioSpecSystem {
  displayName: string;
  icon?: string;
  description?: string;
  onboarding?: string[];
  [k: string]: unknown;
}

/** Spec canonique d'un plan `CreateSystem`. */
export interface StudioSystemSpec {
  system: StudioSpecSystem;
  entities: StudioSpecEntity[];
  seed?: StudioSpecSeed[];
  /** Relations racine N-N (PR 2.2) ; omises par les specs P0. */
  relations?: StudioSpecRelation[];
  [k: string]: unknown;
}

/** Spec canonique d'un plan `CreateApp` (table seule). */
export interface StudioAppSpec {
  entity: { displayName: string; displayNamePlural: string; icon?: string; description?: string };
  fields: StudioSpecField[];
  report?: StudioSpecReport;
  [k: string]: unknown;
}

/** Bornes du parseur serveur (`MaxEntities`, `MaxFields`, `MaxSeedRecords`). */
export const STUDIO_SPEC_LIMITS = {
  maxEntities: 8,
  maxFields: 40,
  maxSeedRecords: 200
} as const;

/** Cibles ERP autorisées pour une relation vers des données existantes (`ExistingRelationSources.Targets`). */
export const ERP_RELATION_TARGETS: readonly { ref: string; label: string }[] = [
  { ref: 'clients', label: 'Clients' },
  { ref: 'products', label: 'Produits' }
];

export function isErpRelationTarget(ref: string | undefined | null): boolean {
  return !!ref && ERP_RELATION_TARGETS.some(t => t.ref === ref);
}

/** Nom affichable de la cible d'une relation (entité de la spec ou table ERP) ; retombe sur `ref`. */
export function relationTargetName(
  spec: Pick<StudioSystemSpec, 'entities'>,
  ref: string | undefined | null
): { name: string; erp: boolean } {
  const target = ref ?? '';
  if (isErpRelationTarget(target)) {
    return { name: ERP_RELATION_TARGETS.find(t => t.ref === target)?.label ?? target, erp: true };
  }
  return { name: spec.entities.find(e => e.ref === target)?.displayName || target, erp: false };
}

// ---------------------------------------------------------------------------------------------
// 2. DTO des endpoints P0
// ---------------------------------------------------------------------------------------------

/** Noms d'enum `StudioAiPlanKind` sérialisés par le serveur. */
export type StudioAiPlanKind = 'CreateApp' | 'CreateSystem' | 'Amendment' | 'View' | 'Report' | 'RecordView' | 'Workflow';

/** Noms d'enum `StudioAiPlanStatus` ; la liste renvoie `Expired` quand le plan a dépassé sa durée de vie. */
export type StudioAiPlanStatus = 'Pending' | 'Executing' | 'Completed' | 'Failed' | 'Cancelled' | 'Expired';

/** Miroir de `StudioAiCapabilitiesDto` (`GET api/ai/studio/capabilities`). */
export interface StudioAiCapabilitiesDto {
  planPreviewEnabled: boolean;
  systemGenerationEnabled: boolean;
  modifyToolsEnabled: boolean;
  viewToolsEnabled: boolean;
  reportToolsEnabled: boolean;
  workbenchEnabled: boolean;
  templatesEnabled: boolean;
  pagesEnabled: boolean;
  advancedModelAvailable: boolean;
  standardModelLabel: string;
  advancedModelLabel?: string | null;
  /** Relations plusieurs-à-plusieurs (PR 2.1, `Ollama:EnableStudioManyToMany`). */
  manyToManyEnabled: boolean;
  /** Vues d'enregistrements (kanban, calendrier…) côté runtime (PR 2.x). */
  recordViewsEnabled: boolean;
  /** Outils IA de création de vues d'enregistrements (PR 2.x). */
  recordViewToolsEnabled: boolean;
  /** Export / import / duplication d'un système au format JSON (PR 3.x). */
  systemExportEnabled: boolean;
  /** Moteur de workflows côté runtime (PR 4.x). */
  workflowsEnabled: boolean;
  /** Outils IA de génération de workflows (PR 4.x) ; pilote la carte « Workflow » de l'atelier. */
  workflowToolsEnabled: boolean;
}

/** Capacités « tout désactivé » utilisées en repli (backend sans P0, erreur réseau…). */
export const STUDIO_AI_CAPABILITIES_FALLBACK: StudioAiCapabilitiesDto = {
  planPreviewEnabled: false,
  systemGenerationEnabled: false,
  modifyToolsEnabled: false,
  viewToolsEnabled: false,
  reportToolsEnabled: false,
  workbenchEnabled: false,
  templatesEnabled: false,
  pagesEnabled: false,
  advancedModelAvailable: false,
  standardModelLabel: '',
  advancedModelLabel: null,
  manyToManyEnabled: false,
  recordViewsEnabled: false,
  recordViewToolsEnabled: false,
  systemExportEnabled: false,
  workflowsEnabled: false,
  workflowToolsEnabled: false
};

/** Forme paginée renvoyée par le backend (identique à `PagedResult<T>` des autres modules). */
export interface StudioPagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Miroir de `StudioAiPlanListItemDto` (`GET api/studio/ai/plans`). */
export interface StudioAiPlanListItemDto {
  id: string;
  kind: StudioAiPlanKind | string;
  status: StudioAiPlanStatus | string;
  title: string;
  entityCount: number;
  createdAt: string;
  expiresAt: string;
  executedAt?: string | null;
  systemKey?: string | null;
  errorMessage?: string | null;
  openUrl?: string | null;
  relationCount?: number;
  /** Omis par le serveur quand 0 (`JsonIgnore WhenWritingDefault`). */
  viewCount?: number;
  replayable?: boolean;
}

export interface StudioAiPlanListQuery {
  status?: StudioAiPlanStatus | null;
  kind?: StudioAiPlanKind | null;
  page?: number;
  pageSize?: number;
}

/** Miroir de `StudioAiPlanSpecDto` (`GET/PUT {id}/spec`). `rowVersion` est une chaîne base64 opaque. */
export interface StudioAiPlanSpecDto {
  id: string;
  kind: StudioAiPlanKind | string;
  status: StudioAiPlanStatus | string;
  expiresAt: string;
  rowVersion: string;
  spec: StudioSystemSpec | StudioAppSpec | Record<string, unknown>;
}

/** Miroir de `StudioAiSpecValidationDto` (`POST validate`) ; une spec invalide renvoie un 400, jamais `valid=false`. */
export interface StudioAiSpecValidationDto {
  valid: boolean;
  summary?: StudioPlanSummaryLike | null;
  canonicalJson?: unknown;
  warnings: string[];
}

/** Raison d'un doublon détecté par le serveur (`StudioAiDuplicateDetector`, par priorité décroissante). */
export type StudioDuplicateReason = 'same_key' | 'same_name' | 'singular_plural';

/**
 * Miroir de `DuplicateHint` (`summary.duplicates[]`, PR 1.3) : une entité de la spec ressemble à une
 * table déjà présente dans le tenant. Le bandeau de l'aperçu propose « Réutiliser » / « Créer quand même ».
 */
export interface StudioDuplicateHint {
  /** `ref` de l'entité dans la spec. */
  specRef: string;
  specDisplayName: string;
  /** Clé de la table existante (`CustomEntityDefinition.Key`). */
  existingKey: string;
  existingDisplayName: string;
  reason: StudioDuplicateReason | string;
}

/**
 * Différence entre la spec serveur et le brouillon local (`diffSpec`). `path` est un chemin lisible
 * (`entities.clients.fields.email`, `system.displayName`…) ; `label` un libellé FR prêt à afficher.
 */
export interface StudioSpecChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  label: string;
  before?: unknown;
  after?: unknown;
}

/** Forme minimale du `summary` (miroir de `StudioPlanSummary` du service de build, redéclarée pour éviter un import circulaire). */
export interface StudioPlanSummaryLike {
  kind: string;
  title: string;
  steps: { key: string; label: string; detail: string }[];
  entities: { displayName: string; fieldCount: number; relationCount: number; existingKey?: string | null }[];
  warnings: string[];
  /** Toujours émis par le serveur depuis la PR 1.3 (tableau vide par défaut). */
  duplicates?: StudioDuplicateHint[];
}

/** Miroir de `StudioAiPlanDto` (redéclaré ici pour les nouveaux endpoints ; identique à celui du service de build). */
export interface StudioAiPlanDtoLike {
  id: string;
  kind: string;
  status: string;
  summaryJson: string;
  resultJson?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  expiresAt: string;
  executedAt?: string | null;
}

/** Miroir de `StudioAiPlanCreationResponse` (`POST from-spec`, `POST from-template`). */
export interface StudioAiPlanCreationResponse {
  plan: StudioAiPlanDtoLike;
  spec: StudioAiPlanSpecDto;
}

/** Miroir de `UpdateStudioAiPlanSpecResponse` (`PUT {id}/spec`). */
export interface UpdateStudioAiPlanSpecResponse {
  plan: StudioAiPlanDtoLike;
  spec: StudioAiPlanSpecDto;
}

/** Miroir de `StudioTemplateListItemDto` (`GET api/studio/templates`). `source` vaut `builtin` pour le catalogue embarqué. */
export interface StudioTemplateListItemDto {
  key: string;
  id?: string | null;
  displayName: string;
  description: string;
  category: string;
  moduleTag: string;
  source: 'builtin' | string;
  visibility?: string | null;
  entityCount: number;
  updatedAt?: string | null;
  /** `StudioTemplateStats` (PR 3.3e2) — défauts `0` / `null` côté serveur. */
  relationCount?: number;
  viewModes?: string[] | null;
}

/** Miroir de `StudioTemplateDetailDto` (`GET api/studio/templates/{key}`). */
export interface StudioTemplateDetailDto extends StudioTemplateListItemDto {
  specJson: string;
}

// ---- Aperçu structuré d'un plan (`GET {id}/preview`, StudioAiPlanPreviewBuilder.cs — D11) ----------

export interface StudioPreviewField {
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  unique: boolean;
  options?: string[] | null;
  relationToRef?: string | null;
}

/** `PreviewFormFieldRef(Key, Width: string?, LabelOverride)` — `width` est une chaîne (`half`/`full`). */
export interface StudioPreviewFormFieldRef {
  key: string;
  width?: string | null;
  labelOverride?: string | null;
}

export interface StudioPreviewFormSection {
  title: string;
  fields: StudioPreviewFormFieldRef[];
}

export interface StudioPreviewFormLayout {
  sections: StudioPreviewFormSection[];
}

export interface StudioPreviewView {
  mode: 'list' | 'kanban' | 'calendar' | string;
  displayName: string;
}

export interface StudioPreviewEntity {
  ref: string;
  displayName: string;
  existingKey?: string | null;
  fields: StudioPreviewField[];
  formLayout?: StudioPreviewFormLayout | null;
  views: StudioPreviewView[];
  seedCount: number;
  seedSample: Record<string, string | null>[];
}

export interface StudioPreviewRelation {
  kind: string;
  fromRef: string;
  toRef: string;
  label?: string | null;
  junctionName?: string | null;
}

export interface StudioPreviewAmendmentItem {
  op: string;
  target?: string | null;
  before?: string | null;
  after?: string | null;
  severity: string;
  warning?: string | null;
}

export interface StudioPreviewAmendment {
  targetEntityRef: string;
  entityKey?: string | null;
  entityDisplayName?: string | null;
  degraded: boolean;
  items: StudioPreviewAmendmentItem[];
}

/** Miroir de `StudioAiPlanPreviewDto` ; `workflows` toujours vide en 3.x (404 si `EnableStudioAiPlanPreview` off). */
export interface StudioAiPlanPreviewDto {
  planId: string;
  kind: string;
  status: string;
  title: string;
  entities: StudioPreviewEntity[];
  relations: StudioPreviewRelation[];
  amendment?: StudioPreviewAmendment | null;
  workflows: unknown[];
  warnings: string[];
  duplicates: StudioDuplicateHint[];
}

/** Relation N-N du `summaryJson` (`StudioAiPlanSummary.SummaryRelation`). */
export interface StudioSummaryRelation {
  fromDisplayName: string;
  toDisplayName: string;
  kind: string;
  junctionName?: string | null;
}

// ---- Export / duplication / import de système (`api/studio/systems`, CustomSystemExportFeatures.cs) ----

/** `GET systems/{key}/export?includeSeed=` — 404 si `EnableStudioSystemExport` off. */
export interface StudioSystemExportDto {
  specVersion: number;
  systemKey: string;
  systemDisplayName: string;
  exportedAt: string;
  entityCount: number;
  relationCount: number;
  viewCount: number;
  includesSeed: boolean;
  warnings: string[];
  spec: StudioSystemSpec;
}

/** Corps de `POST systems/{key}/duplicate`. */
export interface DuplicateCustomSystemRequest {
  displayName?: string | null;
}

/**
 * Corps de `POST systems/import` (`ImportCustomSystemRequest(JsonNode? Spec, DisplayNameOverride, IncludeSeed = true)`) :
 * `spec` accepte un objet JSON ou une chaîne JSON ; 400 `Validation.spec` ; 413 au-delà de 512 Ko.
 */
export interface ImportCustomSystemRequest {
  spec: unknown;
  displayNameOverride?: string | null;
  includeSeed?: boolean;
}

/** Miroir de `StudioBuildStep` (contenu JSON des événements SSE `studio_progress` du flux `confirm`).
 *  `skipped` (PR 2.5) : étape non exécutée (ex. relation N-N ignorée si `manyToManyEnabled=false`) —
 *  comptée comme terminée dans la barre de progression, au même titre que `done`. */
export type StudioBuildStepStatus = 'running' | 'done' | 'error' | 'skipped' | string;

export interface StudioBuildStep {
  phase: string;
  label: string;
  status: StudioBuildStepStatus;
  entityRef?: string | null;
  detail?: string | null;
}

/** `resultJson` d'un plan `CreateSystem` exécuté (payload construit par `StudioAiSystemOrchestrator`). */
export interface StudioSystemBuildResult {
  success: boolean;
  systemKey: string;
  systemUrl: string;
  displayName: string;
  entityCount: number;
  entities: { refKey: string; entityKey: string; displayName: string; openUrl: string }[];
  warnings: string[];
  buildSteps?: StudioBuildStep[];
  message: string;
}

/** `resultJson` d'un plan `CreateApp` exécuté. */
export interface StudioAppBuildResult {
  entityKey: string;
  displayName: string;
  fieldsCreated?: number;
  reportCreated?: boolean;
  warnings: string[];
  openUrl: string;
  message: string;
}

/** Résultat d'exécution d'un plan `Workflow` (PR 4.3f) — contrat figé A-43/A-44b. */
export interface StudioWorkflowBuildResultItem { id: string; key: string; entityKey: string; name: string; stepCount: number; }
export interface StudioWorkflowBuildResult { success?: boolean; workflows: StudioWorkflowBuildResultItem[]; openUrl?: string; warnings?: string[]; message?: string; }   // forme 4.3f1 (N-10) ; `openUrl` non utilisé (D-44-73)

export type StudioBuildResult = StudioSystemBuildResult | StudioAppBuildResult | StudioWorkflowBuildResult;

export function isSystemBuildResult(result: StudioBuildResult | null | undefined): result is StudioSystemBuildResult {
  return !!result && typeof (result as StudioSystemBuildResult).systemKey === 'string';
}

export function isWorkflowBuildResult(result: StudioBuildResult | null | undefined): result is StudioWorkflowBuildResult {
  return !!result && Array.isArray((result as StudioWorkflowBuildResult).workflows) && !isSystemBuildResult(result);
}

// ---------------------------------------------------------------------------------------------
// 3. Types UI partagés par l'atelier
// ---------------------------------------------------------------------------------------------

/** Intentions des 8 cartes « Que voulez-vous créer ? ». */
export type StudioAiIntent =
  | 'system'
  | 'table'
  | 'relations'
  | 'form'
  | 'reference_data'
  | 'report'
  | 'workflow'
  | 'page';

/** Onglets de l'aperçu (Workflow et Pages sont rendus désactivés en P1). */
export type StudioAiPreviewTab =
  | 'overview'
  | 'tables'
  | 'relations'
  | 'forms'
  | 'seed'
  | 'reports'
  | 'views'
  | 'workflow'
  | 'pages'
  | 'menu';

/** Modes de l'aperçu (barre de modes 3.4c) : lecture, simulation, édition du brouillon. */
export type StudioAiPreviewMode = 'preview' | 'test' | 'customize';

/** Phases de la session d'atelier (machine à états du `StudioAiSessionStore`). */
export type StudioAiSessionPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_confirmation'
  | 'editing'
  | 'executing'
  | 'completed'
  | 'failed';

/** Compteurs affichés dans l'en-tête de l'aperçu et le dialogue de confirmation. */
export interface StudioSpecCounters {
  entities: number;
  fields: number;
  relations: number;
  forms: number;
  seedRecords: number;
  reports: number;
  views: number;
  /** Toujours 0 en 3.x (`entity.workflow` + `spec.workflows[]`, programme 4.x). */
  workflows: number;
}

export function isSystemSpec(spec: unknown): spec is StudioSystemSpec {
  return !!spec && typeof spec === 'object' && Array.isArray((spec as StudioSystemSpec).entities);
}

export function isAppSpec(spec: unknown): spec is StudioAppSpec {
  return !!spec && typeof spec === 'object' && !!(spec as StudioAppSpec).entity && Array.isArray((spec as StudioAppSpec).fields);
}

/**
 * Normalise une spec `CreateApp` en spec système à une seule entité pour que l'aperçu, le
 * sandbox et les compteurs n'aient qu'une seule forme à traiter. La conversion inverse n'est
 * pas nécessaire : le `PUT spec` d'un plan `CreateApp` renvoie la forme `{ entity, fields }`.
 */
export function toSystemSpecView(spec: StudioSystemSpec | StudioAppSpec): StudioSystemSpec {
  if (isSystemSpec(spec)) return spec;
  const { entity, fields, report } = spec;
  return {
    system: { displayName: entity.displayName, icon: entity.icon, description: entity.description },
    entities: [
      {
        ref: 'entity',
        displayName: entity.displayName,
        displayNamePlural: entity.displayNamePlural,
        icon: entity.icon,
        description: entity.description,
        fields,
        ...(report ? { report } : {})
      }
    ]
  };
}

/**
 * Inverse de `toSystemSpecView` pour un plan `CreateApp` : le serveur attend `{ entity, fields, report? }`
 * (contrat `PUT {id}/spec`), pas la vue « système » affichée par l'atelier.
 */
export function toAppSpecPayload(view: StudioSystemSpec): StudioAppSpec {
  const first = view.entities[0];
  const { ref: _ref, form: _form, fields, report, ...entity } = first ?? {
    ref: 'entity', displayName: view.system.displayName, displayNamePlural: view.system.displayName, fields: []
  };
  return {
    entity: {
      displayName: entity.displayName,
      displayNamePlural: entity.displayNamePlural,
      ...(entity.icon ? { icon: entity.icon } : {}),
      ...(entity.description ? { description: entity.description } : {})
    },
    fields: fields ?? [],
    ...(report ? { report } : {})
  };
}

/** Charge `specJson` à envoyer au serveur selon le type de plan (vue système → format d'origine). */
export function specPayloadForKind(kind: string, view: StudioSystemSpec): StudioSystemSpec | StudioAppSpec {
  return kind === 'CreateApp' ? toAppSpecPayload(view) : view;
}

export function countSpec(spec: StudioSystemSpec | null | undefined): StudioSpecCounters {
  if (!spec) return { entities: 0, fields: 0, relations: 0, forms: 0, seedRecords: 0, reports: 0, views: 0, workflows: 0 };
  let fields = 0;
  let relations = 0;
  let forms = 0;
  let reports = 0;
  let views = 0;
  let workflows = 0;
  for (const e of spec.entities) {
    fields += e.fields.length;
    relations += e.fields.filter(f => f.type === 'relation').length;
    if (e.form?.sections?.length) forms++;
    if (e.report) reports++;
    views += e.views?.length ?? 0;
    if (e['workflow']) workflows++;
  }
  const seedRecords = (spec.seed ?? []).reduce((acc, s) => acc + (s.records?.length ?? 0), 0);
  const rootWorkflows = spec['workflows'];
  if (Array.isArray(rootWorkflows)) workflows += rootWorkflows.length;
  return { entities: spec.entities.length, fields, relations, forms, seedRecords, reports, views, workflows };
}

/** Mode de vue normalisé : `liste|list|table` → `list`, `calendrier|calendar|planning|agenda` → `calendar`, `kanban` → `kanban`, défaut `list`. */
export function normalizeViewMode(mode: string | undefined): 'list' | 'kanban' | 'calendar' {
  switch ((mode ?? '').trim().toLowerCase()) {
    case 'kanban':
      return 'kanban';
    case 'calendrier':
    case 'calendar':
    case 'planning':
    case 'agenda':
      return 'calendar';
    default:
      return 'list';
  }
}

/** Nom affiché d'une vue : `name` (canonique) puis `displayName` (alias plan maître), sinon chaîne vide. */
export function viewDisplayName(view: StudioSpecRecordView): string {
  return view.name ?? view.displayName ?? '';
}
