/**
 * Modèles front de l'écran de lettrage (Phase 2). Alignés sur le contrat d'API fixé par la
 * section 4 du plan v2 : `GET lettering/lines`, `GET lettering/groups/{code}`, `POST letter`,
 * `POST lettering/groups/{code}/complete`, `POST unletter`.
 */

import { FUNCTIONAL_CURRENCY } from '../../manual-entry/models/entry-form.model';

/** État de lettrage demandé au serveur (filtre). */
export type LetteringStateFilter = 'all' | 'unlettered' | 'partial' | 'lettered';

/** Côté d'une ligne dans les deux volets de l'écran. */
export type LetteringSide = 'debit' | 'credit';

/** Devise de tenue par défaut (dinar tunisien). Réexportée pour ne pas faire remonter l'import
 *  de `manual-entry` partout dans le module lettrage. */
export const LETTERING_FUNCTIONAL_CURRENCY = FUNCTIONAL_CURRENCY;

/** Référence minimale d'un tiers, utilisée par le filtre et les deep-links. */
export interface LetteringThirdPartyRef {
  id: string;
  kind: number;
  name: string;
}

/** Filtres de l'écran, reflet direct des paramètres de `GET lettering/lines` (contrat §4.1). */
export interface LetteringFilters {
  account: string;
  accountMatch: 'exact' | 'prefix';
  thirdParty: LetteringThirdPartyRef | null;
  from: string;
  to: string;
  journalCode: string | null;
  state: LetteringStateFilter;
  documentType: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  /** Recherche libre (libellé, pièce, tiers), 100 caractères au plus (contrat §4.1, `search`). */
  search: string | null;
}

/** Longueur maximale de la recherche libre, alignée sur la borne serveur de `GET lettering/lines`. */
export const LETTERING_SEARCH_MAX_LENGTH = 100;

export function createDefaultLetteringFilters(from: string, to: string): LetteringFilters {
  return {
    account: '',
    accountMatch: 'exact',
    thirdParty: null,
    from,
    to,
    journalCode: null,
    state: 'unlettered',
    documentType: null,
    minAmount: null,
    maxAmount: null,
    search: null
  };
}

/** Ligne normalisée côté front, construite depuis `LetteringLineDto` (contrat §4.1). */
export interface LetteringLine {
  lineId: string;
  entryId: string;
  entryDate: string;
  journalCode: string;
  entryNumber: number;
  /** `LineNumber` du DTO serveur. Optionnel : non utilisé par l'UI, conservé pour la Phase 3. */
  lineNumber?: number;
  accountNumber: string;
  label: string;
  /** Libellé de l'écriture globale (`EntryLabel`), distinct du libellé de la ligne (`Label`). */
  entryLabel?: string;
  pieceRef: string | null;
  /** Code stable `SourceCategory` du serveur (invoice, payment, …), affiché via `$localize`. */
  documentType: string | null;
  thirdPartyId: string | null;
  thirdPartyKind: number | null;
  thirdPartyName: string | null;
  /** Montant au débit, devise de tenue (TND). */
  debit: number;
  /** Montant au crédit, devise de tenue (TND). */
  credit: number;
  /** Devise de l'opération (`JournalEntry.CurrencyCode ?? 'TND'`), jamais la devise de tenue. */
  currency: string;
  /** Montants dans la devise de l'opération. 0 en mono-devise. */
  debitInCurrency: number;
  creditInCurrency: number;
  letteringCode: string | null;
  isPartiallyLettered: boolean;
  isDraft: boolean;
  isReversed: boolean;
  isReversal: boolean;
  /** Règle stricte D8 : période clôturée. Une ligne verrouillée n'est jamais cochable (D9). */
  periodLocked: boolean;
}

export interface LetteringTotals {
  count: number;
  debitCount: number;
  creditCount: number;
  totalDebit: number;
  totalCredit: number;
}

/** Détail d'un groupe de lettrage (`GET lettering/groups/{code}`, contrat §4.2). */
export interface LetteringGroup {
  code: string;
  accountNumber: string;
  amount: number;
  currency: string;
  isPartial: boolean;
  letteredAt: string;
  createdByDisplayName: string | null;
  lines: LetteringLine[];
  canUnletter: boolean;
  /** `null` si délettrable, sinon la raison à afficher. */
  unletterBlockedReason: 'permission' | 'period_locked' | null;
  canComplete: boolean;
}

/** Résultat retourné par `letter` / `complete` (`LetteringResultDto`, contrat §4.3-4.4). */
export interface LetteringResult {
  code: string;
  groupId: string;
  isPartial: boolean;
  lineCount: number;
  previousCode: string | null;
}

/** Résumé de l'équilibre d'une sélection (copie littérale du `computed` historique, §5 annexe B). */
export interface LetteringSelectionSummary {
  count: number;
  debit: number;
  credit: number;
  gap: number;
  balanced: boolean;
  currency: string | null;
  foreign: boolean;
  debitCurrency: number;
  creditCurrency: number;
  currencyGap: number;
  hasExchangeDifference: boolean;
}

/** Compte par côté, utilisé par la synthèse pour « x au débit / y au crédit ». */
export interface LetteringSideCounts {
  debitCount: number;
  creditCount: number;
}

/** Garde-fous front, en complément de la fonction d'équilibre pure (§5 annexe B). */
export interface LetteringSelectionGuards {
  mixedCurrencies: boolean;
  multipleAccounts: boolean;
  /** Codes des groupes « P » (partiels) présents dans la sélection. Un seul code ⇒ complétion
   *  possible via l'action « Compléter » ; plusieurs ⇒ Valider doit être désactivé (ambigu). */
  partialGroupCodes: string[];
  /** Au moins une ligne sélectionnée (hors membres déjà lettrés d'un groupe en cours de
   *  complétion) est dans une période clôturée (D9). Défense en profondeur : les volets rendent
   *  déjà ces lignes non cochables, et le serveur refuse `LETTERING_PERIOD_LOCKED`. */
  lockedLines: boolean;
}

/** Codes d'erreur métier stables renvoyés par le serveur (contrat §4.6). */
export const LETTERING_ERROR_CODES = {
  validation: 'LETTERING_VALIDATION',
  linesNotFound: 'LETTERING_LINES_NOT_FOUND',
  alreadyLettered: 'LETTERING_ALREADY_LETTERED',
  accountMismatch: 'LETTERING_ACCOUNT_MISMATCH',
  currencyMismatch: 'LETTERING_CURRENCY_MISMATCH',
  unbalanced: 'LETTERING_UNBALANCED',
  periodLocked: 'LETTERING_PERIOD_LOCKED',
  groupNotFound: 'LETTERING_GROUP_NOT_FOUND',
  groupNotPartial: 'LETTERING_GROUP_NOT_PARTIAL',
  exchangeDifference: 'LETTERING_EXCHANGE_DIFFERENCE',
  featureDisabled: 'LETTERING_FEATURE_DISABLED',
  /** Phase 3 : le même lot est déjà en cours (HTTP 409). */
  bulkInProgress: 'LETTERING_BULK_IN_PROGRESS',
  /** Phase 3 : erreur inattendue sur un groupe d'un lot (rapport de masse seulement). */
  unexpected: 'LETTERING_UNEXPECTED'
} as const;

/**
 * Action en cours sur l'écran (verrou unique). `'suggestion'` : validation d'une proposition ;
 * `'bulk'` : lettrage en masse (Phase 3, `LetteringSuggestionsStore`). Les deux désactivent aussi
 * les actions principales.
 */
export type LetteringBusyAction = 'letter' | 'settle' | 'unletter' | 'complete' | 'suggestion' | 'bulk' | null;
