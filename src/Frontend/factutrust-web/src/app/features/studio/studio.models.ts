// Render/field types live in the shared studio-runtime layer; re-exported here so existing
// feature imports keep working.
export {
  CustomFieldType,
  FIELD_TYPE_OPTIONS,
  parseFieldType
} from '@shared/studio-runtime/studio-runtime.models';
export type {
  FieldValidationRules,
  SelectOption,
  RelationRef,
  CustomField,
  FormFieldRef,
  FormSection,
  FormLayout,
  ReportColumn,
  ReportResult
} from '@shared/studio-runtime/studio-runtime.models';

import { CustomFieldType, CustomField, FormLayout, SelectOption, RelationRef, FieldValidationRules } from '@shared/studio-runtime/studio-runtime.models';
import type { EntityRelationDto } from './relations/studio-relations.models';
import type { CustomRecordViewDto } from './views/studio-record-views.models';

/** Miroir de `CustomEntityKind` (backend) : jonction N-N invisible par défaut dans la liste des tables. */
export type CustomEntityKind = 'Standard' | 'Junction';

export interface CustomEntity {
  id: string;
  key: string;
  displayName: string;
  displayNamePlural: string;
  icon: string | null;
  description: string | null;
  isActive: boolean;
  fieldCount: number;
  systemId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** `Standard` par défaut ; `Junction` pour les tables de liaison créées par une relation N-N (PR 2.1). */
  kind?: CustomEntityKind;
}

export interface CustomEntitySchema {
  entity: CustomEntity;
  fields: CustomField[];
  form: FormLayout;
  /** Relations dans lesquelles la table intervient (PR 2.1) ; vide si `manyToManyEnabled=false`. */
  relations?: EntityRelationDto[] | null;
  /** Vues enregistrées actives, vue par défaut en tête (PR 2.3) ; vide si `recordViewsEnabled=false`. */
  views?: CustomRecordViewDto[] | null;
}

/** Résultat de `POST entities/{id}/relations/many-to-many` : la jonction et ses deux champs de relation. */
export interface ManyToManyRelationDto {
  junction: CustomEntity;
  sourceField: CustomField;
  targetField: CustomField;
}

export interface CustomRecord {
  id: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  rowVersion?: string | null;
}

export interface CustomForm {
  id: string;
  key: string;
  displayName: string;
  isDefault: boolean;
  layout: FormLayout;
}

export interface StudioNavItem {
  key: string;
  label: string;
  icon: string | null;
}

export interface StudioNavNode {
  kind: 'system' | 'entity';
  key: string;
  label: string;
  icon: string | null;
  route: string | null;
  children: StudioNavNode[] | null;
}

export interface CustomSystem {
  id: string;
  key: string;
  displayName: string;
  icon: string | null;
  description: string | null;
  onboardingSteps: string[] | null;
  isActive: boolean;
  entityCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomSystemDetail {
  system: CustomSystem;
  entities: CustomEntity[];
}

export interface CreateCustomEntityRequest {
  key: string;
  displayName: string;
  displayNamePlural?: string | null;
  icon?: string | null;
  description?: string | null;
}

export interface UpdateCustomEntityRequest {
  displayName: string;
  displayNamePlural?: string | null;
  icon?: string | null;
  description?: string | null;
  isActive: boolean;
}

export interface CreateCustomFieldRequest {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isUnique: boolean;
  rules?: FieldValidationRules | null;
  options?: SelectOption[] | null;
  relation?: RelationRef | null;
  /** Per-type settings (money.currency, rating.max, render.format) keyed for backend BuildOptionsJson. */
  config?: Record<string, unknown> | null;
}

export interface UpdateCustomFieldRequest {
  label: string;
  isRequired: boolean;
  isUnique: boolean;
  rules?: FieldValidationRules | null;
  options?: SelectOption[] | null;
  relation?: RelationRef | null;
  isActive: boolean;
  /** Per-type settings (money.currency, rating.max, render.format) keyed for backend BuildOptionsJson. */
  config?: Record<string, unknown> | null;
}

export interface SaveFormLayoutRequest {
  layout: FormLayout;
  displayName?: string | null;
}

// ---- Reports ----

export type ReportFilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'between';
export type ReportAggFn = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface ReportFilter {
  field: string;
  op: ReportFilterOp;
  value: unknown;
  value2?: unknown;
}

export interface ReportAggregation {
  field: string;
  fn: ReportAggFn;
}

export interface ReportSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface ReportDefinition {
  fields: string[];
  filters: ReportFilter[];
  grouping: string[];
  aggregations: ReportAggregation[];
  sort: ReportSort[];
}

/** 0 = CustomEntity, 1 = ExistingSource, 2 = SqlQuery (mirrors backend CustomReportDataSourceKind). */
export enum ReportDataSourceKind {
  CustomEntity = 0,
  ExistingSource = 1,
  /** Table réelle du tenant : filtres, jointures et agrégation exécutés par SQL. */
  SqlQuery = 2
}

export interface ReportFieldMeta {
  key: string;
  label: string;
  numeric: boolean;
}

export interface ReportSource {
  kind: 'custom' | 'existing' | 'sql';
  ref: string;
  displayName: string;
  /** Vide pour les sources `sql` : les champs sont chargés à la sélection (introspection à la demande). */
  fields: ReportFieldMeta[];
  /** Domaine métier (Ventes, Achats, Stock…), utilisé pour grouper le sélecteur de source. */
  domain?: string;
}

/** État métier prêt à l'emploi : le concepteur le charge d'un clic, l'assistant le nomme. */
export interface ReportPreset {
  key: string;
  displayName: string;
  description: string;
  domain: string;
  factTable: string;
  hasPeriod: boolean;
}

export interface CustomReport {
  id: string;
  key: string;
  displayName: string;
  dataSourceKind: number;
  dataSourceRef: string;
  definition: ReportDefinition;
  isActive: boolean;
}

export interface SaveCustomReportRequest {
  key?: string | null;
  displayName: string;
  dataSourceKind: number;
  dataSourceRef: string;
  definition: ReportDefinition;
}

export interface RunReportPreviewRequest {
  dataSourceKind: number;
  dataSourceRef: string;
  definition: ReportDefinition;
}

// ---- SQL schema introspection + read-only views ----

export interface SqlTable {
  name: string;
}

export interface SqlColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  numeric: boolean;
  suggestedFormat?: string | null;
  foreignKey?: { referencedTable: string; referencedColumn: string } | null;
}

export interface SqlQueryColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  format?: string | null;
  formatOptions?: ViewColumnFormatOptions | null;
  dataType?: string | null;
  numeric?: boolean;
}

export interface SqlQueryResult {
  columns: SqlQueryColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  displayValues?: Record<string, string> | null;
}

export interface ViewColumnFormatOptions {
  statusMap?: Record<string, string>;
  lookupTable?: string | null;
  lookupDisplayColumn?: string | null;
  dateFormat?: string | null;
}

export interface ViewColumn {
  name: string;
  label?: string | null;
  width?: 'full' | 'half' | null;
  format?: string | null;
  formatOptions?: ViewColumnFormatOptions | null;
}

export interface ViewDefinition {
  columns: ViewColumn[];
  search: boolean;
}

export interface CustomView {
  id: string;
  key: string;
  displayName: string;
  sourceTable: string;
  definition: ViewDefinition;
  isActive: boolean;
}

export interface SaveCustomViewRequest {
  key?: string | null;
  displayName: string;
  sourceTable: string;
  definition: ViewDefinition;
}

// ---- ERP bridge automations ----

/** Mirrors backend StudioAutomationTrigger. */
export enum AutomationTrigger {
  OnCreate = 0,
  OnUpdate = 1,
  Manual = 2,
  Scheduled = 3
}

export interface AutomationActionParam {
  name: string;
  description: string;
  required: boolean;
  allowedValues?: string[] | null;
}

export interface AutomationAction {
  name: string;
  description: string;
  parameters: AutomationActionParam[];
}

export interface BridgeParamMapping {
  param: string;
  source: 'field' | 'const';
  value: string | null;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actionKey: string;
  mapping: BridgeParamMapping[];
  runOnce: boolean;
  isActive: boolean;
}

export interface SaveAutomationRequest {
  name: string;
  trigger: AutomationTrigger;
  actionKey: string;
  mapping: BridgeParamMapping[];
  runOnce: boolean;
  isActive: boolean;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: string;
  resultJson: string | null;
  error: string | null;
  runAt: string;
}
