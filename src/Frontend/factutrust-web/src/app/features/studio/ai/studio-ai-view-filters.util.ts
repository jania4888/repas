import { RecordViewFilter, RecordViewFilterOp } from '../views/studio-record-views.models';
import { StudioSpecViewFilter } from './studio-ai.models';

/**
 * Conversions pures entre les filtres d'une vue de la spec (`StudioSpecViewFilter`, clés
 * `{ field, op, value? }`, opérateur en chaîne libre côté serveur) et ceux du constructeur de
 * filtres partagé (`RecordViewFilter`, clés `{ fieldKey, op, value? }`, opérateur restreint à
 * `RecordViewFilterOp`). Utilisées par l'onglet « Vues » en mode Personnaliser (3.4g2).
 *
 * Les opérateurs communs aux deux formes passent tels quels ; un opérateur inconnu du runtime
 * (spec produite par un serveur plus récent) est conservé brut — jamais d'exception, jamais de
 * perte — de sorte que l'aller-retour est réversible (`spec → record → spec` = identité).
 */

/** Opérateurs reconnus par le constructeur partagé (miroir de l'union `RecordViewFilterOp`). */
const RECORD_VIEW_FILTER_OPS: ReadonlySet<string> = new Set<RecordViewFilterOp>([
  'eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_empty', 'is_not_empty', 'between'
]);

/** `true` si `op` est un opérateur que le runtime sait exécuter. */
export function isRecordViewFilterOp(op: string): op is RecordViewFilterOp {
  return RECORD_VIEW_FILTER_OPS.has(op);
}

/** Spec → constructeur partagé. `value` absent (ex. `is_empty`) le reste : la clé n'est pas ajoutée. */
export function specViewFiltersToRecordViewFilters(filters: StudioSpecViewFilter[] | undefined): RecordViewFilter[] {
  return (filters ?? []).map(filter => ({
    fieldKey: filter.field,
    // Repli tolérant : l'opérateur brut est gardé même s'il est hors de l'union connue, pour ne
    // rien perdre de la spec ; le constructeur retombe alors sur son éditeur de valeur texte.
    op: filter.op as RecordViewFilterOp,
    ...(filter.value === undefined ? {} : { value: filter.value })
  }));
}

/** Constructeur partagé → spec (écrite dans le brouillon via `updateView`). */
export function recordViewFiltersToSpecViewFilters(filters: RecordViewFilter[]): StudioSpecViewFilter[] {
  return filters.map(filter => ({
    field: filter.fieldKey,
    op: filter.op as string,
    ...(filter.value === undefined ? {} : { value: filter.value })
  }));
}
