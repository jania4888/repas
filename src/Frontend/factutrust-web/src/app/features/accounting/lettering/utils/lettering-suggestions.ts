import type {
  LetteringSuggestionCategory,
  LetteringSuggestionConfidence,
  LetteringSuggestionDto,
  LetteringSuggestionLineDto,
  LetteringSuggestionReasonDto
} from '../../services/accounting.service';
import { LETTERING_FUNCTIONAL_CURRENCY } from '../models/lettering.models';
import {
  LETTERING_BULK_MAX_GROUPS,
  LETTERING_BULK_MAX_LINES_PER_GROUP,
  LETTERING_BULK_MAX_TOTAL_LINES,
  LETTERING_TOP_SUGGESTIONS,
  LetteringSuggestion,
  LetteringSuggestionLine,
  LetteringSuggestionSide
} from '../models/lettering-suggestions.models';

/**
 * Utilitaires purs des propositions de lettrage (plan v2, Phase 3, annexe C §5). Aucun état,
 * aucun appel réseau : le store (p3-17) et les composants (p3-18 à p3-20) s'appuient dessus.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function mapLine(dto: LetteringSuggestionLineDto, foreign: boolean): LetteringSuggestionLine {
  const amount = foreign ? dto.debitInCurrency + dto.creditInCurrency : dto.debit + dto.credit;
  return {
    lineId: dto.lineId,
    entryId: dto.entryId,
    entryDate: dto.entryDate,
    journalCode: dto.journalCode,
    entryNumber: dto.entryNumber,
    pieceRef: dto.pieceRef ?? null,
    label: dto.label,
    debit: dto.debit,
    credit: dto.credit,
    amount: Math.abs(amount)
  };
}

function side(lines: LetteringSuggestionLine[]): LetteringSuggestionSide {
  return {
    lines,
    first: lines[0] ?? null,
    extraCount: Math.max(0, lines.length - 1),
    total: round3(lines.reduce((sum, l) => sum + l.amount, 0))
  };
}

/** DTO serveur → modèle de carte. Les montants de ligne sont dans la devise de l'opération. */
export function mapSuggestion(dto: LetteringSuggestionDto): LetteringSuggestion {
  const foreign = dto.currencyCode !== LETTERING_FUNCTIONAL_CURRENCY;
  const debitLines = (dto.debitLines ?? []).map(l => mapLine(l, foreign));
  const creditLines = (dto.creditLines ?? []).map(l => mapLine(l, foreign));
  return {
    key: dto.key,
    kind: dto.kind,
    category: dto.category,
    score: dto.score,
    confidence: dto.confidence,
    accountNumber: dto.accountNumber,
    currency: dto.currencyCode,
    thirdPartyId: dto.thirdPartyId ?? null,
    thirdPartyKind: dto.thirdPartyId ? dto.thirdPartyKind : null,
    thirdPartyName: dto.thirdPartyName ?? null,
    debit: side(debitLines),
    credit: side(creditLines),
    lineIds: [...debitLines, ...creditLines].map(l => l.lineId),
    totalAmount: dto.totalAmount,
    localGap: dto.localGap,
    hasExchangeDifference: dto.hasExchangeDifference,
    bulkEligible: dto.bulkEligible,
    reasons: dto.reasons ?? []
  };
}

/**
 * Les `count` meilleures propositions, score décroissant. Le tri est stable : à score égal,
 * l'ordre du serveur (déjà déterministe) est gardé.
 */
export function topSuggestions(
  list: readonly LetteringSuggestion[], count = LETTERING_TOP_SUGGESTIONS
): LetteringSuggestion[] {
  return [...list].sort((a, b) => b.score - a.score).slice(0, Math.max(0, count));
}

/** Vrai si la proposition peut partir dans un lot (éligible et sous le plafond de lignes). */
export function isBulkCandidate(s: LetteringSuggestion): boolean {
  return s.bulkEligible && s.lineIds.length >= 2 && s.lineIds.length <= LETTERING_BULK_MAX_LINES_PER_GROUP;
}

/**
 * Sélection par défaut du dialogue de masse : seulement les propositions de confiance `High`
 * éligibles, dans l'ordre reçu, dans la limite des plafonds serveur (groupes et lignes au total).
 * Une proposition qui réutilise une clé ou une ligne déjà retenue est ignorée : le serveur
 * refuserait tout le lot (400, une ligne dans deux groupes ou clé en double). Le moteur ne produit
 * pas de chevauchement dans une même réponse ; la garde protège d'une fusion de listes.
 */
export function defaultBulkSelection(list: readonly LetteringSuggestion[]): string[] {
  const keys: string[] = [];
  const usedKeys = new Set<string>();
  const usedLines = new Set<string>();
  let lines = 0;
  for (const s of list) {
    if (keys.length >= LETTERING_BULK_MAX_GROUPS) break;
    if (s.confidence !== 'High' || !isBulkCandidate(s)) continue;
    if (lines + s.lineIds.length > LETTERING_BULK_MAX_TOTAL_LINES) continue;
    if (usedKeys.has(s.key) || s.lineIds.some(id => usedLines.has(id))) continue;
    keys.push(s.key);
    usedKeys.add(s.key);
    for (const id of s.lineIds) usedLines.add(id);
    lines += s.lineIds.length;
  }
  return keys;
}

function selected(list: readonly LetteringSuggestion[], keys: Iterable<string>): LetteringSuggestion[] {
  const wanted = new Set(keys);
  return list.filter(s => wanted.has(s.key));
}

/**
 * Total du lot **par devise de l'opération**. Les montants de devises différentes ne sont
 * jamais additionnés : une entrée par devise, dans l'ordre de première apparition.
 */
export function bulkTotalsByCurrency(
  list: readonly LetteringSuggestion[], keys: Iterable<string>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of selected(list, keys)) {
    totals.set(s.currency, round3((totals.get(s.currency) ?? 0) + s.totalAmount));
  }
  return totals;
}

/** Nombre total de lignes du lot. */
export function bulkLineCount(list: readonly LetteringSuggestion[], keys: Iterable<string>): number {
  return selected(list, keys).reduce((sum, s) => sum + s.lineIds.length, 0);
}

/** Corps de `bulkLetter` pour les clés choisies, dans l'ordre de la liste. */
export function bulkGroups(
  list: readonly LetteringSuggestion[], keys: Iterable<string>
): { clientKey: string; journalEntryLineIds: string[] }[] {
  return selected(list, keys).map(s => ({ clientKey: s.key, journalEntryLineIds: [...s.lineIds] }));
}

/** Montant invariant du serveur (`"1234.500"`) → texte affiché. Formateur injectable (locale). */
export type SuggestionAmountFormatter = (value: number, currency: string) => string;

const defaultAmountFormatter: SuggestionAmountFormatter = (value, currency) => `${value.toFixed(3)} ${currency}`.trim();

/** Argument numérique du serveur ; absent ou illisible → 0 (jamais `NaN` à l'écran). */
function numberArg(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Traduit une raison structurée du serveur. Code inconnu → texte générique (jamais le code brut). */
export function reasonText(
  reason: LetteringSuggestionReasonDto, formatAmount: SuggestionAmountFormatter = defaultAmountFormatter
): string {
  const args = reason.args ?? {};
  switch (reason.code) {
    case 'DocumentLink': {
      const invoiceNumber = args['invoiceNumber'] ?? '';
      const paymentCount = args['paymentCount'] ?? '';
      return $localize`:@@accounting.lettering.suggestions.reason.documentLink:Facture ${invoiceNumber}:invoiceNumber: et ses règlements liés (${paymentCount}:paymentCount:).`;
    }
    case 'SameReference': {
      const reference = args['reference'] ?? '';
      return $localize`:@@accounting.lettering.suggestions.reason.sameReference:Même référence : ${reference}:reference:.`;
    }
    case 'SameThirdParty':
      return $localize`:@@accounting.lettering.suggestions.reason.sameThirdParty:Même tiers des deux côtés.`;
    case 'ExactAmount': {
      const amount = formatAmount(numberArg(args['amount']), args['currency'] ?? '');
      return $localize`:@@accounting.lettering.suggestions.reason.exactAmount:Montant identique : ${amount}:amount:.`;
    }
    case 'SubsetSum': {
      const count = args['count'] ?? '';
      return $localize`:@@accounting.lettering.suggestions.reason.subsetSum:Combinaison de ${count}:count: lignes de somme nulle.`;
    }
    case 'AmountOnly':
      return $localize`:@@accounting.lettering.suggestions.reason.amountOnly:Rapprochement sur le montant seul : à vérifier.`;
    case 'AmbiguousAmount': {
      const alternatives = args['alternatives'] ?? '';
      return $localize`:@@accounting.lettering.suggestions.reason.ambiguousAmount:Autres lignes du même montant : ${alternatives}:alternatives:.`;
    }
    case 'DateGap': {
      const days = args['days'] ?? '';
      return $localize`:@@accounting.lettering.suggestions.reason.dateGap:Écart de dates : ${days}:days: jours.`;
    }
    case 'ExchangeDifference': {
      const gap = formatAmount(numberArg(args['localGap']), LETTERING_FUNCTIONAL_CURRENCY);
      return $localize`:@@accounting.lettering.suggestions.reason.exchangeDifference:Écart de change : ${gap}:gap:.`;
    }
    default:
      return $localize`:@@accounting.lettering.suggestions.reason.other:Rapprochement détecté par les règles comptables.`;
  }
}

/** Raison principale d'une carte : la première raison du serveur, ou le texte générique. */
export function mainReasonText(s: LetteringSuggestion, formatAmount?: SuggestionAmountFormatter): string {
  return reasonText(s.reasons[0] ?? { code: '', args: {} }, formatAmount);
}

/** Badge de catégorie (maquette : Match exact / Match multiple / Montant identique). */
export function categoryText(category: LetteringSuggestionCategory): string {
  switch (category) {
    case 'Exact':
      return $localize`:@@accounting.lettering.suggestions.category.exact:Correspondance exacte`;
    case 'Multiple':
      return $localize`:@@accounting.lettering.suggestions.category.multiple:Correspondance multiple`;
    case 'SameAmount':
      return $localize`:@@accounting.lettering.suggestions.category.sameAmount:Montant identique`;
    default:
      return $localize`:@@accounting.lettering.suggestions.category.other:Proposition`;
  }
}

/** Indicateur de confiance : un texte, jamais la couleur seule. */
export function confidenceText(confidence: LetteringSuggestionConfidence): string {
  switch (confidence) {
    case 'High':
      return $localize`:@@accounting.lettering.suggestions.confidence.high:Confiance élevée`;
    case 'Medium':
      return $localize`:@@accounting.lettering.suggestions.confidence.medium:Confiance moyenne`;
    default:
      return $localize`:@@accounting.lettering.suggestions.confidence.low:Confiance faible`;
  }
}
