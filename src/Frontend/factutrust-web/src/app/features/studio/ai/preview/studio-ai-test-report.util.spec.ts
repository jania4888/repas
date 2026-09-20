import { StudioSpecEntity, StudioSpecReport } from '../studio-ai.models';
import { sampleFromSeed } from './studio-ai-test-report.util';

describe('sampleFromSeed (rapport simulé du mode Tester)', () => {
  const entity: StudioSpecEntity = {
    ref: 'demandes',
    displayName: 'Demande de congé',
    displayNamePlural: 'Demandes de congés',
    fields: [
      { key: 'statut', label: 'Statut', type: 'select', required: false, unique: false },
      { key: 'nb_jours', label: 'Nombre de jours', type: 'number', required: false, unique: false }
    ]
  };
  const report: StudioSpecReport = {
    displayName: 'Congés par statut',
    groupBy: ['statut'],
    measures: [{ fn: 'count' }, { fn: 'sum', field: 'nb_jours' }]
  };

  it('agrège count et sum par groupe', () => {
    const result = sampleFromSeed(report, entity, [
      { statut: 'actif', nb_jours: 5 },
      { statut: 'actif', nb_jours: '3' }, // chaîne numérique : coercée
      { statut: 'inactif', nb_jours: 'n/a' }, // non numérique : ignoré par sum, compté par count
      { statut: 'inactif', nb_jours: 2 }
    ]);

    expect(result).not.toBeNull();
    expect(result!.columns).toEqual([
      { key: 'statut', label: 'Statut', kind: 'dimension' },
      { key: 'count', label: 'count', kind: 'measure' },
      { key: 'sum_nb_jours', label: 'sum (Nombre de jours)', kind: 'measure' }
    ]);
    expect(result!.rows).toEqual([
      { statut: 'actif', count: 2, sum_nb_jours: 8 },
      { statut: 'inactif', count: 2, sum_nb_jours: 2 }
    ]);
    // Ligne « Total » volontairement absente : le rendu des totaux relève du composant de rapport.
    expect(result!.totalRows).toBe(2);
  });

  it('retourne null sans données de départ', () => {
    expect(sampleFromSeed(report, entity, [])).toBeNull();
  });
});
