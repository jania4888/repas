import {
  MonthlyDeclarationFamily,
  MonthlyDeclarationModelImportResultDto
} from '../services/accounting.service';
import { familyLabel } from './monthly-declaration-config.view-model';

/**
 * Logique d'affichage de l'écran « Modèle Intégration DM ». Fonctions pures : le conteneur ne
 * garde que les signaux et les appels réseau.
 */

/** Plafond aligné sur `MonthlyDeclarationModel.MaxDocumentBytes` côté serveur. */
export const DM_MODEL_MAX_BYTES = 2 * 1024 * 1024;

/** Ce que l'écran sait dire d'un fichier avant de l'envoyer au serveur. */
export interface DmModelSummary {
  /** Motif de refus si le fichier n'est pas exploitable ; `null` si la lecture a abouti. */
  error: string | null;
  modelVersion: string | null;
  catalogVersion: string | null;
  exportedAt: string | null;
  rubricCount: number;
  /** Familles que le fichier demande d'inclure, par leur libellé d'onglet. */
  includedFamilies: string[];
  /** Familles que le fichier demande d'exclure. */
  excludedFamilies: string[];
  /** Le fichier ne dit rien des inclusions : aucune ne sera touchée. */
  silentOnFamilies: boolean;
}

function emptySummary(error: string | null): DmModelSummary {
  return {
    error,
    modelVersion: null,
    catalogVersion: null,
    exportedAt: null,
    rubricCount: 0,
    includedFamilies: [],
    excludedFamilies: [],
    silentOnFamilies: true
  };
}

/**
 * Décrit un fichier avant l'import.
 *
 * Cette lecture est un **confort** : elle dit à l'utilisateur ce qu'il s'apprête à appliquer, et
 * lui épargne d'envoyer un fichier manifestement hors sujet. Elle ne valide rien — le serveur
 * reste seul juge, et refuse le fichier entier à la moindre entrée fautive. En particulier, un
 * fichier que cette fonction décrit sans erreur peut parfaitement être refusé ensuite.
 */
export function summariseModel(content: string | null | undefined): DmModelSummary {
  const text = (content ?? '').trim();
  if (!text) return emptySummary('Le fichier est vide.');
  if (byteLength(text) > DM_MODEL_MAX_BYTES)
    return emptySummary(`Le fichier dépasse ${DM_MODEL_MAX_BYTES / 1024} Ko.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptySummary("Le fichier n'est pas un JSON exploitable.");
  }

  if (!parsed || typeof parsed !== 'object') return emptySummary("Le fichier n'est pas un modèle DM.");

  const doc = parsed as Record<string, unknown>;
  const rubrics = Array.isArray(doc['rubrics']) ? (doc['rubrics'] as unknown[]) : null;
  if (!rubrics || rubrics.length === 0)
    return emptySummary('Le fichier ne contient aucune rubrique.');

  const families = Array.isArray(doc['families']) ? (doc['families'] as unknown[]) : null;
  const included: string[] = [];
  const excluded: string[] = [];
  for (const raw of families ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const label = labelOfServerFamily(entry['family']);
    if (!label) continue;
    (entry['isIncluded'] === true ? included : excluded).push(label);
  }

  return {
    error: null,
    modelVersion: asText(doc['modelVersion']),
    catalogVersion: asText(doc['catalogVersion']),
    exportedAt: asText(doc['exportedAt']),
    rubricCount: rubrics.length,
    includedFamilies: included,
    excludedFamilies: excluded,
    silentOnFamilies: families === null || families.length === 0
  };
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function byteLength(text: string): number {
  // Les libellés fiscaux sont accentués : compter les caractères sous-estimerait la taille réelle.
  return new TextEncoder().encode(text).length;
}

/** Le fichier nomme les familles par leur jeton serveur (« Tfp ») ; l'écran rend le libellé d'onglet. */
function labelOfServerFamily(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = (MonthlyDeclarationFamily as unknown as Record<string, unknown>)[value];
  return typeof parsed === 'number' ? familyLabel(parsed as MonthlyDeclarationFamily) : value;
}

/** Le fichier choisi ressemble-t-il à un modèle ? Confort de saisie, pas un contrôle. */
export function looksLikeModelFile(fileName: string | null | undefined): boolean {
  return (fileName ?? '').toLowerCase().endsWith('.json');
}

/**
 * Compte rendu d'import en une phrase. Le détail — codes ignorés, comptes inconnus — reste affiché
 * en liste : le résumé dit ce qui s'est passé, pas ce qu'il faut aller vérifier.
 */
export function describeImportOutcome(result: MonthlyDeclarationModelImportResultDto): string {
  const parts: string[] = [];
  parts.push(`${result.inserted} rubrique(s) insérée(s)`);
  parts.push(`${result.replaced} remplacée(s)`);
  if (result.skippedCodes.length) parts.push(`${result.skippedCodes.length} ignorée(s)`);
  if (result.familiesChanged) parts.push(`${result.familiesChanged} inclusion(s) de famille modifiée(s)`);
  return `${parts.join(', ')}.`;
}

/**
 * Rien n'a bougé : ni insertion, ni remplacement, ni inclusion. Le dire explicitement évite de
 * laisser croire qu'un import « réussi » a forcément changé quelque chose.
 */
export function importChangedNothing(result: MonthlyDeclarationModelImportResultDto): boolean {
  return result.inserted === 0 && result.replaced === 0 && result.familiesChanged === 0;
}
