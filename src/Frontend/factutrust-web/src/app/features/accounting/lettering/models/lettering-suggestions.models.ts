/**
 * Modèles front des propositions de lettrage (plan v2, Phase 3, annexe C §5). Construits depuis
 * `LetteringSuggestionDto` par `mapSuggestion` (`utils/lettering-suggestions.ts`).
 */

import type {
  LetteringSuggestionCategory,
  LetteringSuggestionConfidence,
  LetteringSuggestionKind,
  LetteringSuggestionReasonDto
} from '../../services/accounting.service';

/**
 * Plafonds du lot, alignés sur les défauts serveur (`AccountingSettings.BulkMax*`).
 * Dépendance connue : le serveur peut être configuré plus bas (`Clamped()` ne fixe que des
 * maximums). Dans ce cas, un lot construit avec ces valeurs reçoit un 400 `LETTERING_VALIDATION`
 * pour tout le lot ; le dialogue de masse (p3-20) affiche alors un message clair. Le plafond de
 * lignes par groupe est sûr : `bulkEligible` (serveur) l'applique déjà.
 */
export const LETTERING_BULK_MAX_GROUPS = 200;
export const LETTERING_BULK_MAX_LINES_PER_GROUP = 50;
export const LETTERING_BULK_MAX_TOTAL_LINES = 2000;

/** Nombre de cartes du bandeau. */
export const LETTERING_TOP_SUGGESTIONS = 3;

export interface LetteringSuggestionLine {
  lineId: string;
  entryId: string;
  entryDate: string;
  journalCode: string;
  entryNumber: number;
  pieceRef: string | null;
  label: string;
  /** Devise de tenue (TND). */
  debit: number;
  credit: number;
  /** Montant absolu de la ligne dans la devise de l'opération du groupe. */
  amount: number;
}

/** Un côté d'une proposition, résumé pour une carte : première pièce, puis « + n écritures ». */
export interface LetteringSuggestionSide {
  lines: LetteringSuggestionLine[];
  first: LetteringSuggestionLine | null;
  /** Nombre de lignes après la première. */
  extraCount: number;
  /** Somme du côté, devise de l'opération (arrondie au millième). */
  total: number;
}

export interface LetteringSuggestion {
  key: string;
  kind: LetteringSuggestionKind;
  category: LetteringSuggestionCategory;
  score: number;
  confidence: LetteringSuggestionConfidence;
  accountNumber: string;
  /** Devise de l'opération du groupe. */
  currency: string;
  thirdPartyId: string | null;
  thirdPartyKind: number | null;
  thirdPartyName: string | null;
  debit: LetteringSuggestionSide;
  credit: LetteringSuggestionSide;
  /** Toutes les lignes, débit puis crédit : le corps de `letterEntries` et de `bulkLetter`. */
  lineIds: string[];
  /** Montant lettré, devise de l'opération. */
  totalAmount: number;
  /** Écart en devise de tenue. */
  localGap: number;
  hasExchangeDifference: boolean;
  bulkEligible: boolean;
  reasons: LetteringSuggestionReasonDto[];
}
