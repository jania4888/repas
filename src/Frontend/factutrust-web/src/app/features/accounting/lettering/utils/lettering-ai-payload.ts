import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { LetteringLine } from '../models/lettering.models';

export interface LetteringAiPayloadState {
  account: string;
  from: string;
  to: string;
  lines: readonly LetteringLine[];
  selectedCount: number;
  selectionBalanced: boolean;
}

/**
 * Construit le payload du bouton « Analyser avec l'assistant IA », à l'identique de l'ancien
 * `buildLetteringAnalyzePayload` (méthode liée du composant historique) : même filtres, même
 * résumé, mêmes 200 lignes au plus triées par date, mêmes champs par ligne. Volontairement
 * **pure et sans `$localize`** : `scripts/i18n/gate/check-ai-payload-messages.mjs` l'exige.
 *
 * Ne pas ajouter les nouveaux filtres (tiers, journal, type de pièce…), ni des ids : la forme
 * doit rester strictement identique pour le prompt serveur (`AiScreenAnalysisPromptBuilder.cs`).
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
        selectionBalanced: state.selectionBalanced
      },
      lines: sortedLines.slice(0, 200).map(l => ({
        entryDate: l.entryDate,
        label: l.label,
        debit: l.debit,
        credit: l.credit,
        letteringCode: l.letteringCode ?? null
      }))
    } as Record<string, unknown>,
    { rowsKey: 'lines' }
  );
}
