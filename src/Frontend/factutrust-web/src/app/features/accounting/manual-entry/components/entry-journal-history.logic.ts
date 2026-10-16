import { JournalEntryDto } from '../../services/accounting.service';
import { toMillime } from '../models/entry-form.model';

/** Dernières pièces affichées sous la saisie. Le serveur borne take à 30. */
export const JOURNAL_HISTORY_TAKE = 20;

/** Fenêtre glissante jusqu'à aujourd'hui, en jours locaux. */
export const JOURNAL_HISTORY_LOOKBACK_DAYS = 365;

export interface JournalHistoryLine {
  lineNumber: number;
  accountNumber: string;
  accountLabel: string | null;
  label: string;
  debit: number;
  credit: number;
}

export interface JournalHistoryDocument {
  id: string;
  entryDate: string;
  pieceDate: string | null;
  journalCode: string;
  entryNumber: number;
  documentNumber: string;
  pieceRef: string | null;
  label: string;
  /** Total débit. Affiché quand la pièce est équilibrée au millime. */
  amount: number;
  /** Débit − crédit quand la pièce n'est pas équilibrée ; null sinon. */
  imbalance: number | null;
  isDraft: boolean;
  isReversed: boolean;
  status: number;
  isCurrent: boolean;
  lines: JournalHistoryLine[];
}

export function journalHistoryRange(today = new Date()): { from: Date; to: Date } {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - JOURNAL_HISTORY_LOOKBACK_DAYS);
  return { from, to };
}

/**
 * Conserve l'ordre renvoyé par le serveur (date puis numéro décroissants) et ne garde
 * que les premières pièces. Les lignes de chaque pièce sont remises dans l'ordre du numéro.
 */
export function buildJournalHistory(
  entries: readonly JournalEntryDto[],
  options: {
    limit?: number;
    currentEntryId?: string | null;
    accountLabel?: (accountNumber: string) => string | null;
  } = {}
): JournalHistoryDocument[] {
  const limit = options.limit ?? JOURNAL_HISTORY_TAKE;
  const labelOf = options.accountLabel ?? (() => null);
  const currentId = options.currentEntryId ?? null;

  return entries.slice(0, limit).map(entry => {
    const lines = [...(entry.lines ?? [])].sort((a, b) => a.lineNumber - b.lineNumber);
    const debit = toMillime(lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0));
    const credit = toMillime(lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0));
    const balanced = toMillime(Math.abs(debit - credit)) === 0;
    const pieceRef = entry.pieceRef?.trim() ? entry.pieceRef.trim() : null;

    return {
      id: entry.id,
      entryDate: entry.entryDate,
      pieceDate: entry.pieceDate?.trim() ? entry.pieceDate : null,
      journalCode: entry.journalCode,
      entryNumber: entry.entryNumber,
      documentNumber: `${entry.journalCode} ${entry.entryNumber}`,
      pieceRef,
      label: entry.label,
      amount: debit,
      imbalance: balanced ? null : toMillime(debit - credit),
      isDraft: entry.isDraft,
      isReversed: entry.isReversed,
      status: entry.status,
      isCurrent: currentId != null && entry.id === currentId,
      lines: lines.map(line => ({
        lineNumber: line.lineNumber,
        accountNumber: line.accountNumber,
        accountLabel: labelOf(line.accountNumber),
        label: line.label,
        debit: line.debit,
        credit: line.credit
      }))
    };
  });
}
