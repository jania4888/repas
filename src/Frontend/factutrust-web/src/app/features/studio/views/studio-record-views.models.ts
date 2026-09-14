import { CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import type { CustomRecord } from '../studio.models';

/**
 * Miroir de `RecordViewDefinition.cs` / `CustomRecordViewFeatures.cs` (PR 2.3 backend, camelCase,
 * enums en chaîne PascalCase — `JsonStringEnumConverter` global, `Program.cs` l. 370).
 */
export type RecordViewMode = 'List' | 'Kanban' | 'Calendar';

export type RecordViewFilterOp =
  | 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_empty' | 'is_not_empty' | 'between';

export interface RecordViewColumn {
  fieldKey: string;
  width?: number | null;
  hidden: boolean;
}

export interface RecordViewFilter {
  fieldKey: string;
  op: RecordViewFilterOp;
  value?: unknown;
}

export interface RecordViewSort {
  fieldKey: string;
  descending: boolean;
}

export interface RecordViewKanban {
  groupByFieldKey: string;
  titleFieldKey?: string | null;
  cardFieldKeys?: string[] | null;
  columnOrder?: string[] | null;
  showEmptyGroup: boolean;
}

export interface RecordViewCalendar {
  startFieldKey: string;
  endFieldKey?: string | null;
  titleFieldKey?: string | null;
  colorFieldKey?: string | null;
}

export interface RecordViewDefinition {
  columns: RecordViewColumn[];
  filters: RecordViewFilter[];
  sort: RecordViewSort[];
  kanban?: RecordViewKanban | null;
  calendar?: RecordViewCalendar | null;
  searchEnabled: boolean;
  pageSize: number;
}

export interface CustomRecordViewDto {
  id: string;
  key: string;
  displayName: string;
  mode: RecordViewMode;
  definition: RecordViewDefinition;
  isDefault: boolean;
  isActive: boolean;
  rowVersion: string;
  updatedAt: string;
}

export interface SaveCustomRecordViewRequest {
  key: string;
  displayName: string;
  mode: RecordViewMode;
  definition: RecordViewDefinition;
  isDefault?: boolean;
  rowVersion?: string | null;
}

/** Dates ISO `yyyy-MM-dd` (`DateOnly` côté backend) pour `rangeStart`/`rangeEnd`. */
export interface RecordViewRunRequest {
  page?: number;
  pageSize?: number | null;
  search?: string | null;
  extraFilters?: RecordViewFilter[] | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}

export interface RecordViewKanbanGroupDto {
  value: string | null;
  label: string;
  count: number;
  items: CustomRecord[];
}

export interface RecordViewCalendarEventDto {
  recordId: string;
  title: string;
  start: string;
  end?: string | null;
  colorValue?: string | null;
}

export interface RecordViewRunResultDto {
  mode: RecordViewMode;
  items: CustomRecord[];
  total: number;
  page: number;
  pageSize: number;
  groups?: RecordViewKanbanGroupDto[] | null;
  events?: RecordViewCalendarEventDto[] | null;
  truncated: boolean;
}

/**
 * Bornes appliquées par le concepteur de vue (2.5c) et revérifiées à l'exécution (miroir
 * `RecordViewDefinitionValidator` + `CustomRecordViewFeatures.cs` : `MaxColumns/MaxFilters/MaxSort` l.
 * ~85, `CardFieldKeys` ≤ 6 l. ~259, filtre `in` ≤ 100 valeurs l. ~178, `MaxExtraFilters` l. 416).
 */
export const RECORD_VIEW_LIMITS = {
  maxViewsPerEntity: 20,
  maxColumns: 25,
  maxFilters: 10,
  maxSorts: 3,
  maxPageSize: 200,
  maxKanbanCards: 500,
  maxCalendarEvents: 1000,
  maxCalendarDays: 92,
  maxCardFields: 6,
  maxInValues: 100,
  maxExtraFilters: 5
} as const;

/**
 * Table de compatibilité opérateur / type de champ, miroir exact de
 * `RecordViewDefinitionValidator.IsOperatorCompatible` (`RecordViewDefinition.cs` l. ~233-244) : clé =
 * `CustomFieldType` numérique (le schéma runtime normalise déjà `fieldType`, `studio.service.ts`
 * `getSchema`), valeur = opérateurs autorisés pour ce type de champ.
 */
export const OPERATORS_BY_TYPE: Readonly<Record<CustomFieldType, RecordViewFilterOp[]>> = {
  [CustomFieldType.Text]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'contains'],
  [CustomFieldType.MultilineText]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'contains'],
  [CustomFieldType.Number]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Decimal]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Boolean]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Date]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.DateTime]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Select]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'contains', 'in'],
  [CustomFieldType.MultiSelect]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'contains', 'in'],
  [CustomFieldType.RelationCustom]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'in'],
  [CustomFieldType.RelationExisting]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'in'],
  [CustomFieldType.Money]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Percentage]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Rating]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.QrCode]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Barcode]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.AutoNumber]: ['eq', 'neq', 'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between'],
  [CustomFieldType.Formula]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Lookup]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Rollup]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Attachment]: ['eq', 'neq', 'is_empty', 'is_not_empty'],
  [CustomFieldType.Signature]: ['eq', 'neq', 'is_empty', 'is_not_empty']
};
