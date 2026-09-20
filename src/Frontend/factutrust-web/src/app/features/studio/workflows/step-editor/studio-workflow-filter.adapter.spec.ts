import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { WorkflowFilterSpec, WorkflowStepSpec } from '../studio-workflows.models';
import { contextFieldOptions, toRecordViewFilters, toWorkflowFilters } from './studio-workflow-filter.adapter';

function field(key: string, fieldType: CustomFieldType, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key, fieldType, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

describe('studio-workflow-filter.adapter', () => {
  it('between aller-retour value/value2 ↔ [min, max]', () => {
    const server: WorkflowFilterSpec[] = [{ field: 'montant', op: 'between', value: 100, value2: 500 }];

    const view = toRecordViewFilters(server);
    expect(view).toEqual([{ fieldKey: 'montant', op: 'between', value: [100, 500] }]);
    expect(toWorkflowFilters(view)).toEqual(server);

    // Bornes nulles conservées dans les deux sens.
    expect(toRecordViewFilters([{ field: 'montant', op: 'between', value2: 500 }]))
      .toEqual([{ fieldKey: 'montant', op: 'between', value: [null, 500] }]);
    expect(toWorkflowFilters([{ fieldKey: 'montant', op: 'between', value: [null, 500] }]))
      .toEqual([{ field: 'montant', op: 'between', value: null, value2: 500 }]);
  });

  it('is_empty n\'émet pas de value', () => {
    const out = toWorkflowFilters([
      { fieldKey: 'statut', op: 'is_empty' },
      { fieldKey: 'statut', op: 'is_not_empty', value: 'ignorée' }
    ]);

    expect(out).toEqual([{ field: 'statut', op: 'is_empty' }, { field: 'statut', op: 'is_not_empty' }]);
    expect('value' in out[0]).toBeFalse();
    expect('value2' in out[0]).toBeFalse();
  });

  it('contextFieldOptions ajoute _previous, _approval.<clé>.* et _results.<clé>.* des étapes antérieures seulement', () => {
    const fields = [
      field('montant', CustomFieldType.Number, { label: 'Montant' }),
      field('calc', CustomFieldType.Formula),
      field('off', CustomFieldType.Text, { isActive: false })
    ];
    const steps: WorkflowStepSpec[] = [
      { key: 'act_1', type: 'erp_action', saveResultAs: 'facture' },
      { key: 'appro_1', type: 'approval' },
      { key: 'cur', type: 'condition' },
      { key: 'appro_2', type: 'approval' }                                            // postérieure : non proposée
    ];

    const opts = contextFieldOptions(fields, steps, 2);
    const keys = opts.map(f => f.key);

    expect(keys).toContain('montant');
    expect(keys).not.toContain('calc');                                               // champ Formula exclu
    expect(keys).not.toContain('off');                                                // champ inactif exclu
    expect(keys).toContain('_previous.montant');
    expect(keys).not.toContain('_previous.calc');
    expect(keys).toContain('_approval.appro_1.status');
    expect(keys).toContain('_approval.appro_1.decidedAt');
    expect(keys).toContain('_results.facture.id');
    expect(keys.some(k => k.startsWith('_approval.appro_2.'))).toBeFalse();           // étape à l'index 3 > currentIndex

    const prev = opts.find(f => f.key === '_previous.montant')!;
    expect(prev.fieldType).toBe(CustomFieldType.Number);                              // même type que le champ
    expect(prev.label).toBe('Valeur précédente · Montant');
    const synth = opts.find(f => f.key === '_approval.appro_1.status')!;
    expect(synth.fieldType).toBe(CustomFieldType.Text);                               // ⇒ TextVariableOperators côté builder
    expect(synth.isActive).toBeTrue();                                                // requis par fieldOptions (filter builder l.121)
  });
});
