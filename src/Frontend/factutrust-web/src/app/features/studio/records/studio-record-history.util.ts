/**
 * Règles d'affichage pures de l'historique d'un enregistrement Studio (4.7h3, D-47-64).
 * Aucune dépendance Angular : importable depuis le chunk lazy de la fiche et testable sans TestBed.
 * Libellés : `STUDIO_RUNTIME_LABELS.history` ; libellés de champ résolus sur le schéma complet
 * (champs actifs et inactifs, D-B8) avec repli sur la clé brute (`_raw`, champ supprimé).
 */
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { StudioRecordHistoryChange, StudioRecordHistoryEntry } from './studio-record-history.models';

export type StudioRecordHistoryLabels = typeof STUDIO_RUNTIME_LABELS.history;

/** Sévérités `p-tag` utilisées par la colonne Action. */
export type StudioRecordHistorySeverity = 'success' | 'info' | 'danger' | 'secondary';

/** Nombre de changements affichés avant le repli « Afficher les n autres » (D-B6). */
export const HISTORY_INLINE_CHANGES = 5;

export interface StudioRecordHistoryChangeView {
  key: string;
  label: string;
  kind: 'added' | 'changed' | 'removed';
  oldText: string;
  newText: string;
}

/** Libellé français d'une action connue ; une action inconnue est rendue brute. */
export function historyActionLabel(action: string, labels: StudioRecordHistoryLabels): string {
  switch (action) {
    case 'Studio.Record.Created': return labels.actionCreated;
    case 'Studio.Record.Updated': return labels.actionUpdated;
    case 'Studio.Record.Deleted': return labels.actionDeleted;
    default: return action;
  }
}

export function historyActionSeverity(action: string): StudioRecordHistorySeverity {
  switch (action) {
    case 'Studio.Record.Created': return 'success';
    case 'Studio.Record.Updated': return 'info';
    case 'Studio.Record.Deleted': return 'danger';
    default: return 'secondary';
  }
}

/** Libellé du champ (actif ou inactif) ; clé brute si le champ n'existe plus ou pour `_raw`. */
export function historyFieldLabel(key: string, fields: readonly CustomField[]): string {
  return fields.find(f => f.key === key)?.label ?? key;
}

/**
 * Texte affiché pour une valeur : nul ⇒ « (vide) » ; booléen ⇒ Oui/Non ; Select ⇒ libellé de l'option ;
 * sinon la valeur brute (déjà tronquée à 200 caractères côté serveur).
 */
export function formatHistoryValue(value: string | null, field: CustomField | undefined, labels: StudioRecordHistoryLabels): string {
  if (value === null || value === undefined) return labels.emptyValue;
  if (field?.fieldType === CustomFieldType.Boolean) {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return labels.yes;
    if (lowered === 'false') return labels.no;
    return value;
  }
  if (field?.fieldType === CustomFieldType.Select) {
    return field.options?.find(o => o.value === value)?.label ?? value;
  }
  return value;
}

/** Projection d'un changement brut vers sa vue (libellé, nature, textes). */
export function formatHistoryChange(
  change: StudioRecordHistoryChange,
  fields: readonly CustomField[],
  labels: StudioRecordHistoryLabels
): StudioRecordHistoryChangeView {
  const field = fields.find(f => f.key === change.key);
  // Nul → nul (clé explicitement nulle dans un document créé) est rendu « Champ : (vide) » — volontaire.
  const kind: StudioRecordHistoryChangeView['kind'] =
    change.oldValue === null ? 'added' : change.newValue === null ? 'removed' : 'changed';
  return {
    key: change.key,
    label: historyFieldLabel(change.key, fields),
    kind,
    oldText: formatHistoryValue(change.oldValue, field, labels),
    newText: formatHistoryValue(change.newValue, field, labels)
  };
}

/** Nom d'affichage ou « Utilisateur inconnu » (nul ou vide). */
export function historyUserLabel(userName: string | null | undefined, labels: StudioRecordHistoryLabels): string {
  const trimmed = userName?.trim();
  return trimmed ? trimmed : labels.unknownUser;
}

/**
 * Ajoute la page suivante en ignorant les `id` déjà présents : une entrée créée entre deux requêtes
 * décale la pagination serveur et ferait sinon apparaître un doublon.
 */
export function appendHistoryPage(
  current: readonly StudioRecordHistoryEntry[],
  next: readonly StudioRecordHistoryEntry[]
): StudioRecordHistoryEntry[] {
  const seen = new Set(current.map(e => e.id));
  const added = next.filter(e => !seen.has(e.id));
  return [...current, ...added];
}
