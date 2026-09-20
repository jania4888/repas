import {
  isRecordViewFilterOp,
  recordViewFiltersToSpecViewFilters,
  specViewFiltersToRecordViewFilters
} from './studio-ai-view-filters.util';
import { StudioSpecViewFilter } from './studio-ai.models';

describe('studio-ai-view-filters.util', () => {
  it('la conversion des filtres est réversible', () => {
    const filters: StudioSpecViewFilter[] = [
      { field: 'statut', op: 'eq', value: 'actif' },
      { field: 'nb_jours', op: 'gte', value: 2 },
      { field: 'commentaire', op: 'is_empty' },
      { field: 'date_debut', op: 'between', value: ['2026-01-01', '2026-01-31'] },
      { field: 'tags', op: 'in', value: ['a', 'b'] },
      // Opérateur inconnu du runtime (serveur plus récent) : conservé brut, jamais d'exception.
      { field: 'prochaine_echeance', op: 'within_days', value: 7 }
    ];

    const records = specViewFiltersToRecordViewFilters(filters);
    expect(records.map(r => r.fieldKey)).toEqual(filters.map(f => f.field));
    expect(records.map(r => r.op as string)).toEqual(filters.map(f => f.op));

    // Aller-retour = identité, y compris pour les opérateurs partagés et l'opérateur inconnu.
    expect(recordViewFiltersToSpecViewFilters(records)).toEqual(filters);
  });

  it('tolère une spec sans filtres et reconnaît les opérateurs du runtime', () => {
    expect(specViewFiltersToRecordViewFilters(undefined)).toEqual([]);
    expect(specViewFiltersToRecordViewFilters([])).toEqual([]);
    expect(isRecordViewFilterOp('contains')).toBeTrue();
    expect(isRecordViewFilterOp('within_days')).toBeFalse();
  });
});
