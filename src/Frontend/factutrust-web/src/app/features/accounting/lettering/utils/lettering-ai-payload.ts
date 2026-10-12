import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import type { LetteringSuggestionCategory, LetteringSuggestionKind } from '../../services/accounting.service';
import { LetteringLine } from '../models/lettering.models';
import { LetteringSuggestion } from '../models/lettering-suggestions.models';

/** Propositions de lettrage (Phase 3) résumées pour l'assistant ; absentes si le drapeau est éteint. */
export interface LetteringAiSuggestionsState {
  list: readonly LetteringSuggestion[];
  /** Nombre trouvé par le serveur (peut dépasser `list.length`). */
  totalFound: number;
  truncated: boolean;
}

export interface LetteringAiPayloadState {
  account: string;
  from: string;
  to: string;
  lines: readonly LetteringLine[];
  selectedCount: number;
  selectionBalanced: boolean;
  /** Optionnel : sans propositions (ou liste vide), le payload est strictement identique à la Phase 2. */
  suggestions?: LetteringAiSuggestionsState | null;
}

/** Au plus 10 propositions résumées ; le serveur n'en affiche que 5 dans « Points d'attention ». */
export const LETTERING_AI_MAX_HIGHLIGHTS = 10;
/** Longueur maximale de toute chaîne issue d'une proposition. */
export const LETTERING_AI_MAX_TEXT = 50;
const MAX_PIECE_REFS = 4;

/** Libellés stables en français (pas de `$localize` : la requête au LLM ne doit pas varier). */
const CATEGORY_LABEL: Record<LetteringSuggestionCategory, string> = {
  Exact: 'Proposition de lettrage : match exact',
  Multiple: 'Proposition de lettrage : match multiple',
  SameAmount: 'Proposition de lettrage : montant identique'
};

const KIND_CONTEXT: Record<LetteringSuggestionKind, string> = {
  DocumentLink: 'Pièce liée au règlement',
  SameReference: 'Même référence de pièce',
  SameThirdPartyAmount: 'Même tiers et même montant',
  SubsetSum: 'Plusieurs écritures pour un montant',
  AmountOnly: 'Même montant seulement'
};

/**
 * Construit le payload du bouton « Analyser avec l'assistant IA », à l'identique de l'ancien
 * `buildLetteringAnalyzePayload` (méthode liée du composant historique) : même filtres, même
 * résumé, mêmes 200 lignes au plus triées par date, mêmes champs par ligne. Volontairement
 * **pure et sans `$localize`** : `scripts/i18n/gate/check-ai-payload-messages.mjs` l'exige.
 *
 * Ne pas ajouter les nouveaux filtres (tiers, journal, type de pièce…), ni des ids : la forme
 * doit rester strictement identique pour le prompt serveur (`AiScreenAnalysisPromptBuilder.cs`).
 *
 * Seule extension autorisée (plan v2, Phase 3, décision 17) : les propositions de lettrage, et
 * seulement si `state.suggestions` contient au moins une proposition. Alors :
 * - `summary` reçoit trois scalaires : `suggestionsCount`, `suggestionsHigh`, `suggestionsTruncated` ;
 * - `highlights` reçoit au plus 10 entrées `{ type: 'top', label, value, context }` (meilleurs
 *   scores d'abord) : libellé et contexte stables en français, `value` = score, confiance, montant,
 *   devise, nombre de lignes, code de la raison principale et au plus 4 références de pièce.
 * Jamais d'id (ligne, écriture, proposition), de tiers ni de compte ; chaînes ≤ 50 caractères.
 */
export function buildLetteringAnalyzePayload(state: LetteringAiPayloadState): unknown {
  const sortedLines = [...state.lines].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return wrapLegacyAnalyzePayload(
    'accounting-lettering',
    {
      screen: 'accounting-lettering',
      filters: {
        account: state.account || null,
        from: state.from || null,
        to: state.to || null
      },
      summary: {
        totalLines: state.lines.length,
        selectedCount: state.selectedCount,
        selectionBalanced: state.selectionBalanced,
        ...suggestionsSummary(state.suggestions)
      },
      lines: sortedLines.slice(0, 200).map(l => ({
        entryDate: l.entryDate,
        label: l.label,
        debit: l.debit,
        credit: l.credit,
        letteringCode: l.letteringCode ?? null
      })),
      ...suggestionsHighlights(state.suggestions)
    } as Record<string, unknown>,
    { rowsKey: 'lines' }
  );
}

function hasSuggestions(state: LetteringAiSuggestionsState | null | undefined): state is LetteringAiSuggestionsState {
  return !!state && state.list.length > 0;
}

function suggestionsSummary(state: LetteringAiSuggestionsState | null | undefined): Record<string, number | boolean> {
  if (!hasSuggestions(state)) return {};
  return {
    suggestionsCount: Math.max(state.totalFound, state.list.length),
    suggestionsHigh: state.list.filter(s => s.confidence === 'High').length,
    suggestionsTruncated: state.truncated || state.totalFound > state.list.length
  };
}

function suggestionsHighlights(state: LetteringAiSuggestionsState | null | undefined): { highlights?: unknown[] } {
  if (!hasSuggestions(state)) return {};
  const top = [...state.list]
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, LETTERING_AI_MAX_HIGHLIGHTS);
  return {
    highlights: top.map(s => ({
      type: 'top',
      label: clip(CATEGORY_LABEL[s.category] ?? 'Proposition de lettrage'),
      value: {
        score: s.score,
        confidence: clip(s.confidence),
        amount: s.totalAmount,
        currency: clip(s.currency),
        lineCount: s.lineIds.length,
        reason: s.reasons[0] ? clip(s.reasons[0].code) : null,
        pieceRefs: pieceRefs(s)
      },
      context: clip(KIND_CONTEXT[s.kind] ?? 'Proposition de lettrage')
    }))
  };
}

function pieceRefs(s: LetteringSuggestion): string[] {
  const refs = new Set<string>();
  for (const l of [...s.debit.lines, ...s.credit.lines]) {
    const ref = l.pieceRef?.trim();
    if (ref) refs.add(clip(ref));
    if (refs.size >= MAX_PIECE_REFS) break;
  }
  return [...refs];
}

function clip(text: string): string {
  return text.length > LETTERING_AI_MAX_TEXT ? text.slice(0, LETTERING_AI_MAX_TEXT) : text;
}
