import {
  MonthlyDeclarationFamily,
  MonthlyDeclarationModelImportResultDto
} from '../services/accounting.service';
import {
  DM_MODEL_MAX_BYTES,
  describeImportOutcome,
  importChangedNothing,
  looksLikeModelFile,
  summariseModel
} from './monthly-declaration-model.view-model';

const MINIMAL = JSON.stringify({
  modelVersion: 'dm-model-v1',
  rubrics: [{ code: 'F9_TCL', family: 'Tcl' }]
});

function result(
  over: Partial<MonthlyDeclarationModelImportResultDto> = {}
): MonthlyDeclarationModelImportResultDto {
  return {
    inserted: 0,
    replaced: 0,
    skippedCodes: [],
    unknownAccounts: [],
    familiesChanged: 0,
    rejected: [],
    ...over
  };
}

describe('monthly-declaration-model.view-model', () => {
  describe('description du fichier', () => {
    it('refuse un contenu vide', () => {
      expect(summariseModel(null).error).toContain('vide');
      expect(summariseModel('   ').error).toContain('vide');
    });

    it("refuse un contenu qui n'est pas du JSON", () => {
      expect(summariseModel('{ pas du json').error).toContain('JSON');
    });

    it('refuse un document sans rubrique', () => {
      expect(summariseModel(JSON.stringify({ rubrics: [] })).error).toContain('aucune rubrique');
    });

    it('refuse un document qui dépasse le plafond du serveur', () => {
      const huge = JSON.stringify({ rubrics: [{ code: 'A'.repeat(DM_MODEL_MAX_BYTES) }] });
      expect(summariseModel(huge).error).toContain('Ko');
    });

    it('compte les rubriques et relève la version du format', () => {
      const summary = summariseModel(MINIMAL);

      expect(summary.error).toBeNull();
      expect(summary.rubricCount).toBe(1);
      expect(summary.modelVersion).toBe('dm-model-v1');
    });

    it('relève la version de catalogue d’un fichier d’amorçage', () => {
      const summary = summariseModel(
        JSON.stringify({ catalogVersion: 'tn-2026-v1', rubrics: [{ code: 'A' }] })
      );

      expect(summary.catalogVersion).toBe('tn-2026-v1');
      expect(summary.modelVersion).toBeNull();
    });

    it('dit quand le fichier ne parle pas des familles', () => {
      expect(summariseModel(MINIMAL).silentOnFamilies).toBe(true);
    });

    it('sépare les familles à inclure de celles à exclure, par leur libellé d’onglet', () => {
      const summary = summariseModel(
        JSON.stringify({
          rubrics: [{ code: 'A' }],
          families: [
            { family: 'Tfp', isIncluded: true },
            { family: 'Tcl', isIncluded: false }
          ]
        })
      );

      expect(summary.silentOnFamilies).toBe(false);
      expect(summary.includedFamilies).toEqual(['T.F.P']);
      expect(summary.excludedFamilies).toEqual(['T.C.L']);
    });

    it('garde le jeton brut d’une famille que cette version ne connaît pas', () => {
      const summary = summariseModel(
        JSON.stringify({ rubrics: [{ code: 'A' }], families: [{ family: 'Inventee', isIncluded: true }] })
      );

      expect(summary.includedFamilies).toEqual(['Inventee']);
    });

    it('ne se laisse pas troubler par une entrée de famille malformée', () => {
      const summary = summariseModel(
        JSON.stringify({ rubrics: [{ code: 'A' }], families: [null, 42, { isIncluded: true }] })
      );

      expect(summary.error).toBeNull();
      expect(summary.includedFamilies).toEqual([]);
      expect(summary.excludedFamilies).toEqual([]);
    });
  });

  describe('fichier choisi', () => {
    it('accepte un .json, quelle que soit la casse', () => {
      expect(looksLikeModelFile('modele-dm-20260915.json')).toBe(true);
      expect(looksLikeModelFile('MODELE.JSON')).toBe(true);
    });

    it('écarte les autres extensions', () => {
      expect(looksLikeModelFile('config.xlsx')).toBe(false);
      expect(looksLikeModelFile(null)).toBe(false);
    });
  });

  describe('compte rendu', () => {
    it('chiffre ce qui a été inséré et remplacé', () => {
      expect(describeImportOutcome(result({ inserted: 4, replaced: 2 }))).toBe(
        '4 rubrique(s) insérée(s), 2 remplacée(s).'
      );
    });

    it('ne mentionne les ignorées et les familles que lorsqu’il y en a', () => {
      const text = describeImportOutcome(
        result({ inserted: 1, skippedCodes: ['A', 'B'], familiesChanged: 3 })
      );

      expect(text).toContain('2 ignorée(s)');
      expect(text).toContain('3 inclusion(s)');
    });

    it('reconnaît un import qui n’a rien changé', () => {
      expect(importChangedNothing(result({ skippedCodes: ['A'] }))).toBe(true);
      expect(importChangedNothing(result({ inserted: 1 }))).toBe(false);
      expect(importChangedNothing(result({ familiesChanged: 1 }))).toBe(false);
    });
  });

  describe('fichiers antérieurs à la version 2', () => {
    it('distingue le format courant des fichiers plus anciens', () => {
      const v1 = summariseModel(JSON.stringify({ modelVersion: 'dm-model-v1', rubrics: [{ code: 'A' }] }));
      const v2 = summariseModel(JSON.stringify({ modelVersion: 'dm-model-v2', rubrics: [{ code: 'A' }] }));
      const catalogV2 = summariseModel(JSON.stringify({ catalogVersion: 'tn-2026-v2', rubrics: [{ code: 'A' }] }));
      const unversioned = summariseModel(JSON.stringify({ rubrics: [{ code: 'A' }] }));

      expect(v1.isCurrentFormat).toBeFalse();
      expect(unversioned.isCurrentFormat).toBeFalse();
      expect(v2.isCurrentFormat).toBeTrue();
      expect(catalogV2.isCurrentFormat).toBeTrue();
    });

    it('dit quand un fichier ancien a vu ses inclusions ignorées et ses familles passées en v2', () => {
      const text = describeImportOutcome(
        result({ inserted: 2, upgradedFamilies: [MonthlyDeclarationFamily.Tfp], familyInclusionsIgnored: true })
      );

      expect(text).toContain('1 famille(s) passée(s) en définition v2 (T.F.P)');
      expect(text).toContain('inclusions de familles ont été ignorées');
    });
  });
});
