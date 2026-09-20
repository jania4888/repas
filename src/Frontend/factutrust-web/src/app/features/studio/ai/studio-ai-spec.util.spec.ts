import { HttpErrorResponse } from '@angular/common/http';
import { CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_AI_LABELS } from './studio-ai-labels';
import { STUDIO_SPEC_LIMITS, StudioSystemSpec, countSpec } from './studio-ai.models';
import { studioAiSpecFixture, studioAiSpecWithViewsFixture } from './preview/testing/studio-ai-spec.fixture';
import {
  checkSpecBounds,
  cloneSpec,
  counterChips,
  diffSpec,
  ensureIntegrity,
  parseCsv,
  parseSpecPayload,
  serializeSpec,
  slugify,
  specEntityToCustomFields,
  specFieldToCustomField,
  specFormToLayout,
  studioAiHttpError,
  summarizeChanges,
  uniqueKey
} from './studio-ai-spec.util';

/** Spec minimale « congés » réutilisée par les cas ci-dessous. */
function baseSpec(): StudioSystemSpec {
  return {
    system: { displayName: 'Congés' },
    entities: [
      {
        ref: 'employe',
        displayName: 'Employé',
        displayNamePlural: 'Employés',
        fields: [
          { key: 'nom', label: 'Nom', type: 'text', required: true, unique: false },
          { key: 'solde', label: 'Solde', type: 'number', required: false, unique: false }
        ],
        form: { sections: [{ title: 'Identité', fields: [{ field: 'nom', width: 'half' }] }] },
        report: {
          displayName: 'Soldes',
          groupBy: ['nom'],
          measures: [{ field: 'solde', fn: 'sum' }, { fn: 'count' }],
          columns: ['nom', 'solde'],
          sort: [{ field: 'nom', dir: 'asc' }],
          filters: [{ field: 'solde', op: 'gt', value: 0 }]
        }
      },
      {
        ref: 'demande',
        displayName: 'Demande',
        displayNamePlural: 'Demandes',
        fields: [
          { key: 'employe', label: 'Employé', type: 'relation', required: true, unique: false, relationTo: 'employe' },
          { key: 'client', label: 'Client', type: 'relation', required: false, unique: false, relationTo: 'clients' }
        ]
      }
    ],
    seed: [{ entityRef: 'employe', records: [{ nom: 'Amine' }, { nom: 'Sonia' }] }]
  };
}

describe('studio-ai-spec.util', () => {
  describe('counterChips', () => {
    it('counterChips ajoute la puce Vues seulement si la spec en contient', () => {
      const without = counterChips(countSpec(studioAiSpecFixture()));
      expect(without.length).toBe(6);
      expect(without.some(c => c.label === STUDIO_AI_LABELS.views.title)).toBeFalse();

      const withViews = counterChips(countSpec(studioAiSpecWithViewsFixture()));
      expect(withViews.length).toBe(7);
      expect(withViews[6]).toEqual({ label: STUDIO_AI_LABELS.views.title, value: 2 });
    });
  });

  describe('slugify', () => {
    it('lowercases, strips accents and collapses separators', () => {
      expect(slugify('Congés payés')).toBe('conges_payes');
      expect(slugify('  Numéro // de   pièce ')).toBe('numero_de_piece');
      expect(slugify('Coût (TND)')).toBe('cout_tnd');
    });

    it('prefixes keys that do not start with a letter', () => {
      expect(slugify('2e trimestre')).toBe('f_2e_trimestre');
      expect(slugify('_montant')).toBe('montant');
      expect(slugify('123')).toBe('f_123');
    });

    it('falls back to "field" for an empty label', () => {
      expect(slugify('')).toBe('field');
      expect(slugify('—')).toBe('field');
    });

    it('caps the key at 64 characters', () => {
      const key = slugify('a'.repeat(90));
      expect(key.length).toBe(64);
    });
  });

  describe('uniqueKey', () => {
    it('returns the base key when free', () => {
      expect(uniqueKey('nom', ['prenom'])).toBe('nom');
    });

    it('suffixes with _2 then _3 on collision', () => {
      expect(uniqueKey('nom', ['nom'])).toBe('nom_2');
      expect(uniqueKey('nom', ['nom', 'nom_2'])).toBe('nom_3');
    });

    it('accepts any iterable of taken keys', () => {
      expect(uniqueKey('nom', new Set(['nom', 'nom_2', 'nom_3']))).toBe('nom_4');
    });
  });

  describe('checkSpecBounds', () => {
    it('accepts a sane spec', () => {
      expect(checkSpecBounds(baseSpec())).toEqual([]);
    });

    it('flags too many entities', () => {
      const spec = baseSpec();
      const template = spec.entities[0];
      spec.entities = Array.from({ length: STUDIO_SPEC_LIMITS.maxEntities + 1 }, (_, i) => ({
        ...cloneSpec(template),
        ref: `t${i}`,
        form: undefined,
        report: undefined
      }));
      spec.seed = [];
      const messages = checkSpecBounds(spec);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('Trop de tables');
      expect(messages[0]).toContain(String(STUDIO_SPEC_LIMITS.maxEntities));
    });

    it('flags too many fields on an entity', () => {
      const spec = baseSpec();
      spec.entities[0].fields = Array.from({ length: STUDIO_SPEC_LIMITS.maxFields + 2 }, (_, i) => ({
        key: `f${i}`, label: `F${i}`, type: 'text' as const, required: false, unique: false
      }));
      spec.entities[0].form = undefined;
      spec.entities[0].report = undefined;
      const messages = checkSpecBounds(spec);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('Employé');
      expect(messages[0]).toContain('42 champs');
    });

    it('flags too many seed records', () => {
      const spec = baseSpec();
      spec.seed = [{
        entityRef: 'employe',
        records: Array.from({ length: STUDIO_SPEC_LIMITS.maxSeedRecords + 1 }, (_, i) => ({ nom: `n${i}` }))
      }];
      const messages = checkSpecBounds(spec);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('valeurs de référence');
    });

    it('flags duplicate entity refs and duplicate field keys', () => {
      const spec = baseSpec();
      spec.entities.push({ ...cloneSpec(spec.entities[0]), form: undefined, report: undefined });
      spec.entities[0].fields.push({ key: 'nom', label: 'Nom (bis)', type: 'text', required: false, unique: false });
      const messages = checkSpecBounds(spec);
      expect(messages.some(m => m.includes('la même clé « employe »'))).toBeTrue();
      expect(messages.filter(m => m.includes('deux champs « nom »')).length).toBe(1);
    });

    it('flags a relation pointing to neither a spec entity nor an ERP target', () => {
      const spec = baseSpec();
      spec.entities[1].fields[0].relationTo = 'inconnue';
      const messages = checkSpecBounds(spec);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('table inconnue « inconnue »');
    });

    it('accepts ERP relation targets and flags a relation without target', () => {
      const spec = baseSpec();
      expect(checkSpecBounds(spec)).toEqual([]);
      delete spec.entities[1].fields[1].relationTo;
      expect(checkSpecBounds(spec)[0]).toContain('relation sans table cible');
    });
  });

  describe('ensureIntegrity', () => {
    it('leaves a coherent spec untouched and never mutates the input', () => {
      const spec = baseSpec();
      const before = serializeSpec(spec);
      const cleaned = ensureIntegrity(spec);
      expect(serializeSpec(cleaned)).toBe(before);
      expect(serializeSpec(spec)).toBe(before);
      expect(cleaned).not.toBe(spec);
    });

    it('drops form field refs pointing to removed fields', () => {
      const spec = baseSpec();
      spec.entities[0].form = {
        sections: [
          { title: 'Identité', fields: [{ field: 'nom' }, { field: 'disparu' }] },
          { title: 'Vide', fields: [{ field: 'disparu2' }] }
        ]
      };
      const cleaned = ensureIntegrity(spec);
      expect(cleaned.entities[0].form?.sections.length).toBe(1);
      expect(cleaned.entities[0].form?.sections[0].fields).toEqual([{ field: 'nom' }]);
    });

    it('removes the form entirely when no referenced field survives', () => {
      const spec = baseSpec();
      spec.entities[0].form = { sections: [{ fields: [{ field: 'disparu' }] }] };
      expect(ensureIntegrity(spec).entities[0].form).toBeUndefined();
    });

    it('drops seed blocks of unknown entities', () => {
      const spec = baseSpec();
      spec.seed = [
        { entityRef: 'employe', records: [{ nom: 'Amine' }] },
        { entityRef: 'fantome', records: [{ nom: 'X' }] }
      ];
      const cleaned = ensureIntegrity(spec);
      expect(cleaned.seed?.length).toBe(1);
      expect(cleaned.seed?.[0].entityRef).toBe('employe');
    });

    it('prunes report parts referencing unknown fields', () => {
      const spec = baseSpec();
      spec.entities[0].report = {
        displayName: 'Soldes',
        groupBy: ['nom', 'disparu'],
        measures: [{ field: 'disparu', fn: 'sum' }, { fn: 'count' }],
        columns: ['disparu'],
        sort: [{ field: 'disparu', dir: 'asc' }],
        filters: [{ field: 'solde', op: 'gt', value: 0 }, { field: 'disparu', op: 'eq', value: 1 }]
      };
      const report = ensureIntegrity(spec).entities[0].report!;
      expect(report.groupBy).toEqual(['nom']);
      expect(report.measures).toEqual([{ fn: 'count' }]);
      expect(report.columns).toBeUndefined();
      expect(report.sort).toBeUndefined();
      expect(report.filters).toEqual([{ field: 'solde', op: 'gt', value: 0 }]);
    });

    it('removes relation fields whose target no longer exists', () => {
      const spec = baseSpec();
      spec.entities[1].fields[0].relationTo = 'disparue';
      const cleaned = ensureIntegrity(spec);
      expect(cleaned.entities[1].fields.map(f => f.key)).toEqual(['client']);
    });

    it('keeps ERP relation targets', () => {
      const cleaned = ensureIntegrity(baseSpec());
      expect(cleaned.entities[1].fields.map(f => f.relationTo)).toEqual(['employe', 'clients']);
    });

    it('only clears relationTo on non relation fields', () => {
      const spec = baseSpec();
      spec.entities[0].fields.push({
        key: 'note', label: 'Note', type: 'text', required: false, unique: false, relationTo: 'disparue'
      });
      const cleaned = ensureIntegrity(spec);
      const field = cleaned.entities[0].fields.find(f => f.key === 'note');
      expect(field).toBeTruthy();
      expect(field?.relationTo).toBeUndefined();
    });
  });

  describe('spec → runtime mapping', () => {
    it('maps a text field to a runtime CustomField with a synthetic id', () => {
      const spec = baseSpec();
      const field = specFieldToCustomField(spec.entities[0].fields[0], 'employe', 0, spec);
      expect(field.id).toBe('employe:nom');
      expect(field.key).toBe('nom');
      expect(field.fieldType).toBe(CustomFieldType.Text);
      expect(field.isRequired).toBeTrue();
      expect(field.isUnique).toBeFalse();
      expect(field.sortOrder).toBe(0);
      expect(field.isActive).toBeTrue();
      expect(field.options).toBeNull();
      expect(field.relation).toBeNull();
    });

    it('maps each spec type to its runtime type', () => {
      const spec = baseSpec();
      const cases: [string, CustomFieldType][] = [
        ['multilinetext', CustomFieldType.MultilineText],
        ['number', CustomFieldType.Number],
        ['decimal', CustomFieldType.Decimal],
        ['boolean', CustomFieldType.Boolean],
        ['date', CustomFieldType.Date],
        ['datetime', CustomFieldType.DateTime],
        ['select', CustomFieldType.Select],
        ['multiselect', CustomFieldType.MultiSelect],
        ['money', CustomFieldType.Money],
        ['percentage', CustomFieldType.Percentage],
        ['rating', CustomFieldType.Rating],
        ['qrcode', CustomFieldType.QrCode],
        ['barcode', CustomFieldType.Barcode],
        ['autonumber', CustomFieldType.AutoNumber],
        ['attachment', CustomFieldType.Attachment],
        ['signature', CustomFieldType.Signature]
      ];
      for (const [type, expected] of cases) {
        const mapped = specFieldToCustomField(
          { key: 'k', label: 'K', type: type as never, required: false, unique: false }, 'e', 0, spec
        );
        expect(mapped.fieldType).toBe(expected);
      }
    });

    it('maps select options', () => {
      const spec = baseSpec();
      const mapped = specFieldToCustomField({
        key: 'statut', label: 'Statut', type: 'select', required: false, unique: false,
        options: [{ value: 'a', label: 'A' }]
      }, 'demande', 3, spec);
      expect(mapped.options).toEqual([{ value: 'a', label: 'A' }]);
    });

    it('builds relation options from the target seed records (no network)', () => {
      const spec = baseSpec();
      const mapped = specFieldToCustomField(spec.entities[1].fields[0], 'demande', 0, spec);
      expect(mapped.fieldType).toBe(CustomFieldType.RelationCustom);
      expect(mapped.relation).toEqual({ kind: 'custom', ref: 'employe' });
      expect(mapped.options).toEqual([
        { value: 'Amine', label: 'Amine' },
        { value: 'Sonia', label: 'Sonia' }
      ]);
    });

    it('falls back to the target display name when the seed row has no label value', () => {
      const spec = baseSpec();
      spec.seed = [{ entityRef: 'employe', records: [{ solde: 3 }] }];
      const mapped = specFieldToCustomField(spec.entities[1].fields[0], 'demande', 0, spec);
      expect(mapped.options).toEqual([{ value: 'Employé 1', label: 'Employé 1' }]);
    });

    it('maps an ERP relation to RelationExisting with no options', () => {
      const spec = baseSpec();
      const mapped = specFieldToCustomField(spec.entities[1].fields[1], 'demande', 1, spec);
      expect(mapped.fieldType).toBe(CustomFieldType.RelationExisting);
      expect(mapped.relation).toEqual({ kind: 'existing', ref: 'clients' });
      expect(mapped.options).toEqual([]);
    });

    it('nests the per-type config expected by the renderers and derives rules', () => {
      const spec = baseSpec();
      const money = specFieldToCustomField(
        { key: 'montant', label: 'Montant', type: 'money', required: false, unique: false, config: { currency: 'EUR', max: 1000 } },
        'e', 0, spec
      );
      expect(money.config).toEqual({ money: { currency: 'EUR' } });
      expect(money.rules).toEqual({ max: 1000 });

      const rating = specFieldToCustomField(
        { key: 'note', label: 'Note', type: 'rating', required: false, unique: false, config: { max: 10 } }, 'e', 1, spec
      );
      expect(rating.config).toEqual({ rating: { max: 10 } });
      expect(rating.rules).toBeNull();

      const barcode = specFieldToCustomField(
        { key: 'code', label: 'Code', type: 'barcode', required: false, unique: false, config: { format: 'code128' } }, 'e', 2, spec
      );
      expect(barcode.config).toEqual({ render: { format: 'code128' } });

      const text = specFieldToCustomField(
        { key: 'nom', label: 'Nom', type: 'text', required: false, unique: false, config: { max: 30 } }, 'e', 3, spec
      );
      expect(text.rules).toEqual({ maxLength: 30 });
      expect(text.config).toBeNull();
    });

    it('maps all fields of an entity in spec order', () => {
      const spec = baseSpec();
      const fields = specEntityToCustomFields(spec.entities[0], spec);
      expect(fields.map(f => f.key)).toEqual(['nom', 'solde']);
      expect(fields.map(f => f.sortOrder)).toEqual([0, 1]);
    });

    it('maps the spec form to a runtime FormLayout', () => {
      const spec = baseSpec();
      spec.entities[0].form = {
        sections: [
          { title: ' Identité ', fields: [{ field: 'nom', width: 'half', label: 'Nom complet' }, { field: 'solde' }] },
          { fields: [{ field: 'solde', width: 'full' }] }
        ]
      };
      expect(specFormToLayout(spec.entities[0])).toEqual({
        sections: [
          {
            title: ' Identité ',
            fields: [
              { key: 'nom', labelOverride: 'Nom complet', width: 'half' },
              { key: 'solde', labelOverride: null, width: 'full' }
            ]
          },
          { title: null, fields: [{ key: 'solde', labelOverride: null, width: 'full' }] }
        ]
      });
    });

    it('returns null when the entity has no form', () => {
      const spec = baseSpec();
      expect(specFormToLayout(spec.entities[1])).toBeNull();
      spec.entities[0].form = { sections: [] };
      expect(specFormToLayout(spec.entities[0])).toBeNull();
    });
  });

  describe('cloneSpec / serializeSpec', () => {
    it('clones deeply without sharing references', () => {
      const spec = baseSpec();
      const copy = cloneSpec(spec);
      copy.entities[0].fields[0].label = 'Modifié';
      expect(spec.entities[0].fields[0].label).toBe('Nom');
    });

    it('serializes with a 2-space indent', () => {
      expect(serializeSpec({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
  });

  describe('parseSpecPayload', () => {
    it('accepts an already deserialized system spec', () => {
      const spec = baseSpec();
      expect(parseSpecPayload(spec)).toBe(spec);
    });

    it('accepts a JSON string', () => {
      const parsed = parseSpecPayload(JSON.stringify(baseSpec())) as StudioSystemSpec | null;
      expect(parsed?.entities.length).toBe(2);
    });

    it('accepts an app spec', () => {
      const app = { entity: { displayName: 'Contrat', displayNamePlural: 'Contrats' }, fields: [] };
      expect(parseSpecPayload(app)).toBe(app as never);
    });

    it('rejects junk', () => {
      expect(parseSpecPayload('{ pas du json')).toBeNull();
      expect(parseSpecPayload('"texte"')).toBeNull();
      expect(parseSpecPayload({ system: { displayName: 'X' } })).toBeNull();
      expect(parseSpecPayload(null)).toBeNull();
      expect(parseSpecPayload(42)).toBeNull();
    });
  });

  describe('studioAiHttpError', () => {
    const labels = STUDIO_AI_LABELS.errors;
    const httpError = (status: number, body: unknown = null) =>
      new HttpErrorResponse({ status, statusText: 'x', error: body, url: '/api' });

    it('maps status 0 to a network message', () => {
      expect(studioAiHttpError(httpError(0))).toBe(labels.network);
    });

    it('prefers the server message on 400 and falls back to the invalid spec message', () => {
      expect(studioAiHttpError(httpError(400, { message: 'Clé en double.' }))).toBe('Clé en double.');
      expect(studioAiHttpError(httpError(400, { errors: ['Trop de tables.', 'Clé vide.'] })))
        .toBe('Trop de tables. Clé vide.');
      expect(studioAiHttpError(httpError(400))).toBe(labels.invalidSpec);
    });

    it('maps 401 and 403', () => {
      expect(studioAiHttpError(httpError(401))).toBe(labels.unauthorized);
      expect(studioAiHttpError(httpError(403))).toBe(labels.forbidden);
    });

    it('disambiguates 404 with the context', () => {
      expect(studioAiHttpError(httpError(404), 'plan')).toBe(labels.planNotFound);
      expect(studioAiHttpError(httpError(404), 'workbench')).toBe(labels.workbenchDisabled);
      expect(studioAiHttpError(httpError(404))).toBe(labels.workbenchDisabled);
    });

    it('always uses the fixed message on 409', () => {
      expect(studioAiHttpError(httpError(409, { message: 'RowVersion mismatch' }))).toBe(labels.conflict);
    });

    it('maps 413 and 429', () => {
      expect(studioAiHttpError(httpError(413))).toBe(labels.tooLarge);
      expect(studioAiHttpError(httpError(429))).toBe(labels.rateLimited);
    });

    it('falls back to the server message then to the generic message', () => {
      expect(studioAiHttpError(httpError(500, { message: 'Boom' }))).toBe('Boom');
      expect(studioAiHttpError(httpError(500))).toBe(labels.generic);
      expect(studioAiHttpError(new Error('Flux interrompu'))).toBe('Flux interrompu');
      expect(studioAiHttpError({ nope: true })).toBe(labels.generic);
    });
  });

  describe('diffSpec / summarizeChanges', () => {
    it('returns no change for an identical draft', () => {
      expect(diffSpec(baseSpec(), cloneSpec(baseSpec()))).toEqual([]);
    });

    it('detects added, removed and changed fields with a readable path', () => {
      const draft = baseSpec();
      draft.entities[0].fields.push({ key: 'email', label: 'E-mail', type: 'text', required: false, unique: true });
      draft.entities[0].fields = draft.entities[0].fields.filter(f => f.key !== 'solde');
      draft.entities[1].fields[0].required = false;

      const changes = diffSpec(baseSpec(), draft);

      expect(changes).toContain(jasmine.objectContaining({ path: 'entities.employe.fields.email', kind: 'added' }));
      expect(changes).toContain(jasmine.objectContaining({ path: 'entities.employe.fields.solde', kind: 'removed' }));
      expect(changes).toContain(jasmine.objectContaining({ path: 'entities.demande.fields.employe', kind: 'changed' }));
    });

    it('detects renamed, added and reused entities plus system / seed / form / report changes', () => {
      const draft = baseSpec();
      draft.system.displayName = 'Congés 2026';
      draft.entities[0].displayName = 'Salarié';
      draft.entities[1].existingKey = 'demandes';
      draft.entities.push({ ref: 'contrat', displayName: 'Contrat', displayNamePlural: 'Contrats', fields: [] });
      draft.seed = [{ entityRef: 'employe', records: [{ nom: 'Amine' }] }];
      draft.entities[0].form = { sections: [] };
      delete draft.entities[0].report;

      const changes = diffSpec(baseSpec(), draft);
      const labels = changes.map(c => c.label);

      expect(changes).toContain(jasmine.objectContaining({ path: 'system', kind: 'changed' }));
      expect(labels).toContain('Table « Employé » renommée « Salarié »');
      expect(labels).toContain('Table « Demande » : réutilise la table existante demandes');
      expect(labels).toContain('Table « Contrat » ajoutée');
      // Les lignes de détail portent le nom courant (renommé) de la table.
      expect(labels).toContain('Données de référence de « Salarié » modifiées');
      expect(labels).toContain('Formulaire de « Salarié » modifié');
      expect(labels).toContain('Rapport de « Salarié » modifié');
    });

    it('summarizeChanges groups field changes per table in French and keeps the other lines verbatim', () => {
      const draft = baseSpec();
      draft.entities[0].fields.push(
        { key: 'email', label: 'E-mail', type: 'text', required: false, unique: false },
        { key: 'tel', label: 'Téléphone', type: 'text', required: false, unique: false }
      );
      draft.entities[0].fields = draft.entities[0].fields.filter(f => f.key !== 'solde');
      draft.entities.push({ ref: 'contrat', displayName: 'Contrat', displayNamePlural: 'Contrats', fields: [] });

      const lines = summarizeChanges(diffSpec(baseSpec(), draft));

      expect(lines).toContain('2 champ(s) ajouté(s) à Employé');
      expect(lines).toContain('1 champ(s) supprimé(s) de Employé');
      expect(lines).toContain('Table « Contrat » ajoutée');
      expect(summarizeChanges([])).toEqual([]);
    });
  });

  describe('parseCsv', () => {
    it('parses comma separated text with quotes, escaped quotes and embedded line breaks', () => {
      const parsed = parseCsv('nom,ville\n"Dupont, Jean","Paris"\n"Ligne ""citée""","Lyon\nCentre"\n');

      expect(parsed.headers).toEqual(['nom', 'ville']);
      expect(parsed.rows).toEqual([
        ['Dupont, Jean', 'Paris'],
        ['Ligne "citée"', 'Lyon\nCentre']
      ]);
      expect(parsed.truncated).toBeFalse();
    });

    it('detects semicolon and tab delimiters, strips the BOM and skips blank lines', () => {
      const semi = parseCsv('\uFEFFnom;ville\r\nAmine;Tunis\r\n\r\nSonia;Sfax');
      expect(semi.headers).toEqual(['nom', 'ville']);
      expect(semi.rows).toEqual([['Amine', 'Tunis'], ['Sonia', 'Sfax']]);

      const tab = parseCsv('nom\tville\nAmine\tTunis');
      expect(tab.rows).toEqual([['Amine', 'Tunis']]);
    });

    it('pads or trims rows to the header length and honours the forced delimiter', () => {
      const parsed = parseCsv('a,b,c\n1,2\n1,2,3,4', { delimiter: ',' });
      expect(parsed.rows).toEqual([['1', '2', ''], ['1', '2', '3']]);
    });

    it('flags truncation beyond maxRows', () => {
      const text = ['nom', ...Array.from({ length: 10 }, (_, i) => `n${i}`)].join('\n');
      const parsed = parseCsv(text, { maxRows: 3 });
      expect(parsed.rows.length).toBe(3);
      expect(parsed.truncated).toBeTrue();
    });

    it('returns empty headers for empty input', () => {
      expect(parseCsv('')).toEqual({ headers: [], rows: [], truncated: false });
    });
  });
});
