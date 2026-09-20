import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import type { RecordViewFilter } from '../../views/studio-record-views.models';
import { COMPUTED_FIELD_TYPES, WorkflowFilterSpec, WorkflowStepSpec } from '../studio-workflows.models';

const COMPUTED: ReadonlySet<CustomFieldType> = new Set(COMPUTED_FIELD_TYPES);

/**
 * Adaptateur de filtres de workflow (4.4c1 — D-44-11) : le filter builder existant stocke
 * `between` en `value: [min, max]` (`shared/studio-filter-builder.component.ts` l.24 `range`,
 * l.133) alors que le serveur lit `value` + `value2` scalaires (`StudioFilterEvaluator.cs`
 * l.45–46 et l.124 ; `ConditionStepHandler.cs` l.103).
 */

/** Serveur → builder : `value` + `value2` repliés en `[min, max]` pour `between`. */
export function toRecordViewFilters(filters: readonly WorkflowFilterSpec[]): RecordViewFilter[] {
  return filters.map(f => ({ fieldKey: f.field, op: f.op, value: f.op === 'between' ? [f.value ?? null, f.value2 ?? null] : f.value ?? null }));
}

/** Builder → serveur : `between` éclaté en `value`/`value2` ; `is_empty`/`is_not_empty` sans valeur. */
export function toWorkflowFilters(filters: readonly RecordViewFilter[]): WorkflowFilterSpec[] {
  return filters.map(f => {
    if (f.op === 'between' && Array.isArray(f.value)) return { field: f.fieldKey, op: f.op, value: f.value[0] ?? null, value2: f.value[1] ?? null };
    if (f.op === 'is_empty' || f.op === 'is_not_empty') return { field: f.fieldKey, op: f.op };          // pas de value : ValidateConditionFilter l.389–420
    return { field: f.fieldKey, op: f.op, value: f.value ?? null };
  });
}

/**
 * Champs réels actifs (hors calculés) + variables de contexte acceptées par
 * `TryResolveFilterFieldType` (`StudioWorkflowStepsSpec.cs` l.426–456) : `_previous.<champ>`
 * (même type que le champ), `_approval.<clé>.<prop>` et `_results.<saveResultAs>.<prop>` des
 * étapes **antérieures** uniquement. Les variables `_approval.*`/`_results.*` sont typées
 * `Text` ⇒ le filter builder propose `eq | neq | contains | is_empty | is_not_empty`
 * (`OPERATORS_BY_TYPE[Text]`) = exactement les `TextVariableOperators` serveur (l.58–59).
 * D-44-17 : liste fermée — `recordId`/`entityKey` pour `create_record`
 * (`CreateRecordStepHandler.cs` l.114–118), `id` pour `erp_action` ; pas de champ texte libre
 * « Variable personnalisée » en 4.4 (question ouverte n°9).
 */
export function contextFieldOptions(fields: readonly CustomField[], steps: readonly WorkflowStepSpec[], currentIndex: number): CustomField[] {
  const active = fields.filter(f => f.isActive && !COMPUTED.has(f.fieldType));
  const previous = active.map(f => synthetic(`_previous.${f.key}`, `Valeur précédente · ${f.label}`, f.fieldType));         // même type que le champ
  const before = steps.slice(0, currentIndex);
  const approvals = before.filter(s => s.type === 'approval')
    .flatMap(s => ['status', 'comment', 'decidedBy', 'decidedAt'].map(p => synthetic(`_approval.${s.key}.${p}`, `Approbation ${s.key} · ${p}`, CustomFieldType.Text)));
  const results = before
    .filter(s => (s.type === 'erp_action' || s.type === 'create_record') && typeof s['saveResultAs'] === 'string' && s['saveResultAs'] !== '')
    .flatMap(s => {
      const saveAs = s['saveResultAs'] as string;
      const props = s.type === 'create_record' ? ['recordId', 'entityKey'] : ['id'];
      return props.map(p => synthetic(`_results.${saveAs}.${p}`, `Résultat ${saveAs} · ${p}`, CustomFieldType.Text));     // D-44-17
    });
  return [...active, ...previous, ...approvals, ...results];
}

/** `isActive: true` obligatoire : `fieldOptions` du filter builder filtre sur `isActive` (l.121). */
function synthetic(key: string, label: string, fieldType: CustomFieldType): CustomField {
  return { id: key, key, label, fieldType, isRequired: false, isUnique: false, sortOrder: 0, rules: null, options: null, relation: null, isActive: true };
}
