import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { StudioRecordHistoryEntry } from './studio-record-history.models';
import {
  HISTORY_INLINE_CHANGES,
  appendHistoryPage,
  formatHistoryChange,
  formatHistoryValue,
  historyActionLabel,
  historyActionSeverity,
  historyFieldLabel,
  historyUserLabel
} from './studio-record-history.util';

const labels = STUDIO_RUNTIME_LABELS.history;

function field(key: string, fieldType: CustomFieldType, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key.toUpperCase(), fieldType, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

const FIELDS: CustomField[] = [
  field('nom', CustomFieldType.Text, { label: 'Nom' }),
  field('statut', CustomFieldType.Select, {
    label: 'Statut',
    options: [{ value: 'a_planifier', label: 'À planifier' }, { value: 'termine', label: 'Terminé' }]
  }),
  field('urgent', CustomFieldType.Boolean, { label: 'Urgent' }),
  field('ancien_code', CustomFieldType.Text, { label: 'Ancien code', isActive: false })
];

function entry(id: string): StudioRecordHistoryEntry {
  return { id, action: 'Studio.Record.Updated', createdAt: '2026-09-19T10:00:00Z', userName: 'Alice Martin', changes: [] };
}

describe('studio-record-history.util (4.7h3, D-47-64)', () => {
  it('historyActionLabel traduit les trois actions et rend une action inconnue telle quelle', () => {
    expect(historyActionLabel('Studio.Record.Created', labels)).toBe('Création');
    expect(historyActionLabel('Studio.Record.Updated', labels)).toBe('Modification');
    expect(historyActionLabel('Studio.Record.Deleted', labels)).toBe('Suppression');
    expect(historyActionLabel('Studio.Record.Archived', labels)).toBe('Studio.Record.Archived');
  });

  it('historyActionSeverity associe success/info/danger et secondary pour une action inconnue', () => {
    expect(historyActionSeverity('Studio.Record.Created')).toBe('success');
    expect(historyActionSeverity('Studio.Record.Updated')).toBe('info');
    expect(historyActionSeverity('Studio.Record.Deleted')).toBe('danger');
    expect(historyActionSeverity('autre')).toBe('secondary');
  });

  it('historyFieldLabel résout un champ actif, un champ inactif et replie sur la clé brute (_raw, champ supprimé)', () => {
    expect(historyFieldLabel('nom', FIELDS)).toBe('Nom');
    expect(historyFieldLabel('ancien_code', FIELDS)).toBe('Ancien code');
    expect(historyFieldLabel('_raw', FIELDS)).toBe('_raw');
    expect(historyFieldLabel('champ_supprime', FIELDS)).toBe('champ_supprime');
  });

  it('formatHistoryValue rend « (vide) » pour une valeur nulle et le texte brut sinon', () => {
    expect(formatHistoryValue(null, FIELDS[0], labels)).toBe('(vide)');
    expect(formatHistoryValue(null, undefined, labels)).toBe('(vide)');
    expect(formatHistoryValue('Alice', FIELDS[0], labels)).toBe('Alice');
    expect(formatHistoryValue('42', undefined, labels)).toBe('42');
  });

  it('formatHistoryValue traduit un booléen en Oui/Non (texte true/false, insensible à la casse)', () => {
    const urgent = FIELDS[2];
    expect(formatHistoryValue('true', urgent, labels)).toBe('Oui');
    expect(formatHistoryValue('False', urgent, labels)).toBe('Non');
    expect(formatHistoryValue('peut-être', urgent, labels)).toBe('peut-être');
    expect(formatHistoryValue('true', FIELDS[0], labels)).toBe('true');
  });

  it('formatHistoryValue remplace la valeur d’un Select par le libellé de l’option, sinon la valeur brute', () => {
    const statut = FIELDS[1];
    expect(formatHistoryValue('a_planifier', statut, labels)).toBe('À planifier');
    expect(formatHistoryValue('termine', statut, labels)).toBe('Terminé');
    expect(formatHistoryValue('inconnu', statut, labels)).toBe('inconnu');
  });

  it('formatHistoryChange qualifie added / changed / removed avec les textes formatés', () => {
    const added = formatHistoryChange({ key: 'nom', oldValue: null, newValue: 'Alice' }, FIELDS, labels);
    expect(added).toEqual({ key: 'nom', label: 'Nom', kind: 'added', oldText: '(vide)', newText: 'Alice' });

    const changed = formatHistoryChange({ key: 'statut', oldValue: 'a_planifier', newValue: 'termine' }, FIELDS, labels);
    expect(changed.kind).toBe('changed');
    expect(changed.label).toBe('Statut');
    expect(changed.oldText).toBe('À planifier');
    expect(changed.newText).toBe('Terminé');

    const removed = formatHistoryChange({ key: 'urgent', oldValue: 'true', newValue: null }, FIELDS, labels);
    expect(removed.kind).toBe('removed');
    expect(removed.oldText).toBe('Oui');
    expect(removed.newText).toBe('(vide)');

    const raw = formatHistoryChange({ key: '_raw', oldValue: null, newValue: '{"a":1}' }, FIELDS, labels);
    expect(raw.label).toBe('_raw');
    expect(raw.kind).toBe('added');

    // Clé explicitement nulle dans un document créé : rendu « Statut : (vide) » (added, sans flèche).
    const nullToNull = formatHistoryChange({ key: 'statut', oldValue: null, newValue: null }, FIELDS, labels);
    expect(nullToNull).toEqual({ key: 'statut', label: 'Statut', kind: 'added', oldText: '(vide)', newText: '(vide)' });
  });

  it('historyUserLabel rend le nom ou « Utilisateur inconnu » pour un nom nul ou vide', () => {
    expect(historyUserLabel('Alice Martin', labels)).toBe('Alice Martin');
    expect(historyUserLabel('  Bob  ', labels)).toBe('Bob');
    expect(historyUserLabel(null, labels)).toBe('Utilisateur inconnu');
    expect(historyUserLabel('   ', labels)).toBe('Utilisateur inconnu');
    expect(historyUserLabel(undefined, labels)).toBe('Utilisateur inconnu');
  });

  it('appendHistoryPage concatène la page suivante en dédoublonnant par id et n’altère pas la page courante', () => {
    const current = [entry('h1'), entry('h2')];
    const next = [entry('h2'), entry('h3')];
    const merged = appendHistoryPage(current, next);
    expect(merged.map(e => e.id)).toEqual(['h1', 'h2', 'h3']);
    expect(current.length).toBe(2);
    expect(appendHistoryPage([], next).map(e => e.id)).toEqual(['h2', 'h3']);
    expect(HISTORY_INLINE_CHANGES).toBe(5);
  });
});
