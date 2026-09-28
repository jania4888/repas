import { formatLocalDate } from '../../../shared/accounting-date-utils';
import { ChartOfAccountDto } from '../../../services/accounting.service';
import { EntryLine } from '../../models/entry-form.model';
import {
  DocumentDirection,
  JournalEntryProposal,
  ProposedAccountStatus,
  ProposedLine,
  ProposedLineRole,
  ProposalDiagnostic
} from '../../models/accounting-document-import.models';
import { computeTotals, isBalancedTotals } from '../../services/entry-form.store';

/** Codes recalculés côté client après édition des lignes ou de l'en-tête. */
export const CLIENT_RECALC_DIAGNOSTIC_CODES = new Set([
  'AccountMissing',
  'AccountInactive',
  'PeriodClosed',
  'FutureDate',
  'ThirdPartyNotMatched',
  'TotalsMismatch'
]);

export interface ImportProposalHeaderSnapshot {
  journalCode: string;
  entryDate: string;
  entryLabel: string;
  pieceRef: string;
  pieceDate: string;
}

export interface ImportProposalStoreSnapshot {
  header: ImportProposalHeaderSnapshot;
  lines: EntryLine[];
  periodClosed: boolean;
  periodsLoaded: boolean;
}

export function buildStoreSnapshot(
  header: ImportProposalHeaderSnapshot,
  lines: EntryLine[],
  periodClosed: boolean,
  periodsLoaded: boolean
): ImportProposalStoreSnapshot {
  return { header, lines, periodClosed, periodsLoaded };
}

function inferLineRole(accountNumber: string, direction: DocumentDirection): ProposedLineRole {
  const n = accountNumber.trim();
  if (n.startsWith('411') || n.startsWith('401')) return 'thirdparty';
  if (n.startsWith('436')) return 'vat';
  if (n.includes('fodec') || n === '4352') return 'fodec';
  if (n === '4311' || n === '6354') return 'stamp';
  return direction === 'SALE' ? 'revenue' : 'expense';
}

function resolveAccountStatus(
  accountNumber: string,
  accounts: ChartOfAccountDto[]
): ProposedAccountStatus {
  const acc = accountNumber.trim();
  if (!acc) return 'missing';
  const found = accounts.find(a => a.accountNumber === acc);
  if (!found) return 'missing';
  if (!found.isActive) return 'inactive';
  return 'found';
}

function resolveAccountLabel(accountNumber: string, accounts: ChartOfAccountDto[]): string | null {
  const found = accounts.find(a => a.accountNumber === accountNumber.trim());
  return found?.label ?? null;
}

/** Lignes avec compte et montant — alignées sur getSubmittableLines du store. */
export function getSubmittableEntryLines(lines: EntryLine[]): EntryLine[] {
  return lines.filter(l => {
    const d = Number(l.debit) || 0;
    const c = Number(l.credit) || 0;
    return l.accountNumber.trim().length > 0 && (d > 0 || c > 0);
  });
}

export function entryLinesToProposedLines(
  lines: EntryLine[],
  originalLines: ProposedLine[],
  accounts: ChartOfAccountDto[],
  direction: DocumentDirection
): ProposedLine[] {
  const submittable = getSubmittableEntryLines(lines);
  return submittable.map((line, index) => {
    const orig = originalLines[index];
    const accountNumber = line.accountNumber.trim();
    const tp = line.thirdParty && typeof line.thirdParty === 'object' ? line.thirdParty : null;
    return {
      accountNumber,
      accountLabel: resolveAccountLabel(accountNumber, accounts) ?? orig?.accountLabel ?? null,
      accountStatus: resolveAccountStatus(accountNumber, accounts),
      role: orig?.role ?? inferLineRole(accountNumber, direction),
      label: line.lineLabel,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      vatRatePercent: line.vatRatePercent ?? orig?.vatRatePercent ?? null,
      thirdPartyId: tp?.id ?? null,
      thirdPartyKind: tp?.kind ?? null
    };
  });
}

function lineAmountFingerprint(line: EntryLine): string {
  const d = Number(line.debit) || 0;
  const c = Number(line.credit) || 0;
  const tp = line.thirdParty && typeof line.thirdParty === 'object' ? line.thirdParty.id : '';
  return [
    line.accountNumber.trim(),
    line.lineLabel.trim(),
    d.toFixed(3),
    c.toFixed(3),
    tp
  ].join('|');
}

function proposedLineFingerprint(line: ProposedLine): string {
  return [
    line.accountNumber.trim(),
    line.label.trim(),
    line.debit.toFixed(3),
    line.credit.toFixed(3),
    line.thirdPartyId ?? ''
  ].join('|');
}

export function hasMeaningfulHeaderEdits(
  original: JournalEntryProposal,
  header: ImportProposalHeaderSnapshot
): boolean {
  const origDate = original.entryDate ?? '';
  const origPieceDate = original.pieceDate ?? '';
  return (
    header.journalCode !== original.journalCode ||
    header.entryDate !== origDate ||
    header.entryLabel.trim() !== (original.label ?? '').trim() ||
    header.pieceRef.trim() !== (original.pieceRef ?? '').trim() ||
    header.pieceDate !== origPieceDate
  );
}

export function hasMeaningfulLineEdits(
  originalLines: ProposedLine[],
  currentLines: EntryLine[]
): boolean {
  const origFp = originalLines.map(proposedLineFingerprint).join('\n');
  const submittable = getSubmittableEntryLines(currentLines);
  const curFp = submittable.map(lineAmountFingerprint).join('\n');
  if (origFp !== curFp) return true;

  const emptyExtra = currentLines.filter(l => {
    const d = Number(l.debit) || 0;
    const c = Number(l.credit) || 0;
    const hasAmount = d > 0 || c > 0;
    const hasAccount = l.accountNumber.trim().length > 0;
    return hasAmount || hasAccount;
  });
  return emptyExtra.length > submittable.length;
}

export function hasMeaningfulEdits(
  original: JournalEntryProposal,
  snapshot: ImportProposalStoreSnapshot
): boolean {
  if (hasMeaningfulHeaderEdits(original, snapshot.header)) return true;
  return hasMeaningfulLineEdits(original.lines, snapshot.lines);
}

function preserveServerDiagnostics(original: JournalEntryProposal): ProposalDiagnostic[] {
  return original.diagnostics.filter(d => !CLIENT_RECALC_DIAGNOSTIC_CODES.has(d.code));
}

function buildAccountDiagnostics(
  proposedLines: ProposedLine[],
  accounts: ChartOfAccountDto[]
): ProposalDiagnostic[] {
  const out: ProposalDiagnostic[] = [];
  for (let i = 0; i < proposedLines.length; i++) {
    const line = proposedLines[i];
    const status = resolveAccountStatus(line.accountNumber, accounts);
    if (status === 'missing') {
      out.push({
        severity: 'blocking',
        code: 'AccountMissing',
        message: $localize`:@@accounting.import-proposal.ts.le.compte.accountnumber.est.absent.du.pl.84069a81:Le compte ${line.accountNumber}:accountNumber: est absent du plan comptable.`,
        relatedLineIndex: i
      });
    } else if (status === 'inactive') {
      out.push({
        severity: 'blocking',
        code: 'AccountInactive',
        message: $localize`:@@accounting.import-proposal.ts.le.compte.accountnumber.est.desactive.4a2dd509:Le compte ${line.accountNumber}:accountNumber: est désactivé.`,
        relatedLineIndex: i
      });
    }
  }
  return out;
}

function buildPeriodDiagnostics(
  entryDate: string,
  periodClosed: boolean,
  periodsLoaded: boolean
): ProposalDiagnostic[] {
  const out: ProposalDiagnostic[] = [];
  if (!entryDate) return out;

  const today = formatLocalDate(new Date());
  if (entryDate > today) {
    out.push({
      severity: 'blocking',
      code: 'FutureDate',
      message: $localize`:@@accounting.import-proposal.ts.la.date.d.ecriture.est.posterieure.a.la.65800431:La date d'écriture est postérieure à la date du jour.`,
      relatedLineIndex: null
    });
  }

  if (periodsLoaded && periodClosed) {
    out.push({
      severity: 'blocking',
      code: 'PeriodClosed',
      message: $localize`:@@accounting.import-proposal.ts.la.periode.comptable.de.cette.date.est.c.9c7d9809:La période comptable de cette date est clôturée.`,
      relatedLineIndex: null
    });
  }

  return out;
}

function buildThirdPartyDiagnostics(
  proposal: JournalEntryProposal,
  proposedLines: ProposedLine[]
): ProposalDiagnostic[] {
  const tp = proposal.thirdParty;
  if (!tp) return [];

  const collective = tp.collectiveAccountNumber?.trim();
  if (!collective) return [];

  const collectiveLine = proposedLines.find(l => l.accountNumber === collective);
  if (!collectiveLine) return [];

  const hasAux =
    collectiveLine.thirdPartyId != null ||
    proposedLines.some(l => l.thirdPartyId != null && l.accountNumber === collective);

  if (tp.matchedId || hasAux) return [];

  return [{
    severity: 'warning',
    code: 'ThirdPartyNotMatched',
    message: $localize`:@@accounting.import-proposal.ts.tiers.non.rapproche.l.ecriture.restera.s.afe0cf92:Tiers non rapproché — l'écriture restera sans auxiliaire si vous ne sélectionnez pas un tiers.`,
    relatedLineIndex: proposedLines.indexOf(collectiveLine)
  }];
}

function buildTotalsMismatchDiagnostic(
  documentTotalTtc: number | null,
  totals: { debit: number; credit: number }
): ProposalDiagnostic | null {
  if (documentTotalTtc == null) return null;
  const entryTotal = Math.max(totals.debit, totals.credit);
  const gap = Math.abs(documentTotalTtc - entryTotal);
  if (gap < 0.001) return null;
  return {
    severity: 'warning',
    code: 'TotalsMismatch',
    message: $localize`:@@accounting.import-proposal.ts.le.total.ttc.du.document.tofixed.differe.9c9c7662:Le total TTC du document (${documentTotalTtc.toFixed(3)}:toFixed:) diffère du total de l'écriture (${entryTotal.toFixed(3)}:toFixed1:).`,
    relatedLineIndex: null
  };
}

export function recomputeImportDiagnostics(
  original: JournalEntryProposal,
  proposedLines: ProposedLine[],
  snapshot: ImportProposalStoreSnapshot,
  accounts: ChartOfAccountDto[]
): ProposalDiagnostic[] {
  const submittable = getSubmittableEntryLines(snapshot.lines);
  const totals = computeTotals(submittable);

  const diagnostics: ProposalDiagnostic[] = [
    ...preserveServerDiagnostics(original),
    ...buildAccountDiagnostics(proposedLines, accounts),
    ...buildPeriodDiagnostics(
      snapshot.header.entryDate,
      snapshot.periodClosed,
      snapshot.periodsLoaded
    ),
    ...buildThirdPartyDiagnostics(original, proposedLines)
  ];

  const totalsDiag = buildTotalsMismatchDiagnostic(original.documentTotalTtc, totals);
  if (totalsDiag) diagnostics.push(totalsDiag);

  return diagnostics;
}

export function hasBlockingDiagnostics(diagnostics: ProposalDiagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'blocking');
}

export function mergeProposalWithStore(
  original: JournalEntryProposal,
  snapshot: ImportProposalStoreSnapshot,
  accounts: ChartOfAccountDto[]
): JournalEntryProposal {
  const proposedLines = entryLinesToProposedLines(
    snapshot.lines,
    original.lines,
    accounts,
    original.direction
  );
  const submittable = getSubmittableEntryLines(snapshot.lines);
  const totals = computeTotals(submittable);
  const diagnostics = recomputeImportDiagnostics(original, proposedLines, snapshot, accounts);

  return {
    ...original,
    journalCode: snapshot.header.journalCode,
    entryDate: snapshot.header.entryDate || original.entryDate,
    label: snapshot.header.entryLabel,
    pieceRef: snapshot.header.pieceRef.trim() || null,
    pieceDate: snapshot.header.pieceDate || null,
    lines: proposedLines,
    totalDebit: totals.debit,
    totalCredit: totals.credit,
    diagnostics,
    hasBlockingDiagnostic: hasBlockingDiagnostics(diagnostics)
  };
}

export function isImportProposalBalanced(lines: EntryLine[]): boolean {
  const submittable = getSubmittableEntryLines(lines);
  return isBalancedTotals(computeTotals(submittable));
}
