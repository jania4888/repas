/**
 * Miroir TypeScript des DTO de `/api/accounting/bank-statement-import`.
 *
 * Analyse (session) → relecture → enregistrement du relevé → propositions → génération des
 * brouillons (une écriture par ligne). Les montants et dates ne sont jamais renvoyés au serveur
 * lors de la génération : seuls le compte, le tiers, la TVA et le libellé le sont.
 */

export type SessionStatus = 'Pending' | 'Extracting' | 'AwaitingReview' | 'Confirmed' | 'Failed' | 'Cancelled';

export type IssueSeverity = 'Info' | 'Warning' | 'Blocking';

export type LineSource = 'Layout' | 'Ai' | 'Manual';

export interface StatementAmount {
  value: number;
  printedDecimals: number;
  signSource: 'Column' | 'Keyword' | 'Assumed';
}

export interface ExtractedStatementHeader {
  rib: string | null;
  bankCode: string | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: StatementAmount | null;
  closingBalance: StatementAmount | null;
  totalDebits: StatementAmount | null;
  totalCredits: StatementAmount | null;
  totalsLabelled: boolean;
}

export interface ExtractedStatementLine {
  index: number;
  pageNumber: number;
  transactionDate: string;
  valueDate: string | null;
  label: string;
  labelLines: string[];
  amount: number;
  isDebit: boolean;
  source: LineSource;
}

export interface StatementExtractionIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  pageNumber: number | null;
  lineIndex: number | null;
}

export interface ExtractedBankStatement {
  header: ExtractedStatementHeader;
  lines: ExtractedStatementLine[];
  issues: StatementExtractionIssue[];
  profileId: string;
  pageCount: number;
  unresolvedPages: number[];
}

export interface BalanceCheck {
  sumDebits: number;
  sumCredits: number;
  computedClosing: number | null;
  difference: number | null;
  isBalanced: boolean;
}

export interface BankStatementImportSession {
  id: string;
  status: SessionStatus;
  progressPercent: number;
  bankAccountId: string;
  journalCode: string;
  fileName: string;
  pageCount: number;
  extractionMethod: string | null;
  profileId: string | null;
  aiProviderKind: 'local' | 'external' | null;
  errorCode: string | null;
  statementId: string | null;
  expiresAt: string;
  extraction: ExtractedBankStatement | null;
  balanceCheck: BalanceCheck | null;
  canConfirm: boolean;
}

export interface ConfirmResult {
  statementId: string;
  lineCount: number;
  alreadyImportedCount: number;
}

export interface BankStatementImportCapabilities {
  enabled: boolean;
  aiAvailable: boolean;
  aiProviderKind: 'local' | 'external' | null;
  maxFileBytes: number;
  maxPages: number;
  acceptedExtensions: string[];
  recognizedBanks: string[];
}

export type LineStatus =
  | 'Generated'
  | 'Reconciled'
  | 'AlreadyPosted'
  | 'Ambiguous'
  | 'AlreadyImported'
  | 'Blocked'
  | 'Proposed'
  | 'ToComplete';

export type LineConfidence = 'Certain' | 'Probable' | 'ToCheck';

export type LineProposalSource = 'ExistingEntry' | 'DossierRule' | 'Catalog' | 'ThirdPartyMatch' | 'Ai';

/** `ThirdPartyKind` du domaine, tel que sérialisé par l'API (nom de l'énumération). */
export type ThirdPartyKindName = 'None' | 'Client' | 'Supplier' | 'Employee';

const KIND_NAMES: readonly ThirdPartyKindName[] = ['None', 'Client', 'Supplier', 'Employee'];

/** Nom d'énumération → code numérique des références de saisie (0 aucun, 1 client, 2 fournisseur, 3 salarié). */
export function thirdPartyKindCode(kind: ThirdPartyKindName | null | undefined): number {
  const index = kind ? KIND_NAMES.indexOf(kind) : -1;
  return index < 0 ? 0 : index;
}

export function thirdPartyKindName(code: number): ThirdPartyKindName {
  return KIND_NAMES[code] ?? 'None';
}

export interface EntryRef {
  journalEntryId: string;
  journalEntryLineId: string | null;
  reference: string;
  entryDate: string;
  isDraft: boolean;
}

export interface VatSplit {
  netAmount: number;
  vatAmount: number;
  vatAccountNumber: string;
  implied: boolean;
}

export interface LineDiagnostic {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
}

export interface BankLineProposal {
  lineId: string;
  transactionDate: string;
  valueDate: string | null;
  label: string;
  reference: string;
  amount: number;
  isDebit: boolean;
  isReconciled: boolean;
  status: LineStatus;
  confidence: LineConfidence | null;
  source: LineProposalSource | null;
  explanation: string;
  accountNumber: string | null;
  accountLabel: string | null;
  accountStatus: 'found' | 'inactive' | 'missing' | 'none';
  thirdPartyId: string | null;
  /** Énumération sérialisée par son NOM (`JsonStringEnumConverter` côté API). */
  thirdPartyKind: ThirdPartyKindName;
  thirdPartyName: string | null;
  requiresThirdParty: boolean;
  vatSplit: VatSplit | null;
  existingEntry: EntryRef | null;
  generatedEntry: EntryRef | null;
  candidateCount: number;
  diagnostics: LineDiagnostic[];
  selectedByDefault: boolean;
}

export interface BankStatementProposals {
  statementId: string;
  bankAccountId: string | null;
  bankName: string;
  bankGlAccount: string | null;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  lines: BankLineProposal[];
  unclassifiedDistinctLabels: number;
}

export interface GenerateItem {
  lineId: string;
  accountNumber: string;
  thirdPartyId: string | null;
  thirdPartyKind: ThirdPartyKindName;
  vatAmount: number | null;
  vatAccountNumber: string | null;
  label: string | null;
  rememberRule: boolean;
}

export interface GenerateOutcome {
  lineId: string;
  outcome: 'created' | 'already_posted' | 'failed';
  code: string | null;
  message: string | null;
  journalEntryId: string | null;
  entryNumber: number | null;
}

export interface GenerateResult {
  created: number;
  skipped: number;
  failed: number;
  firstEntryNumber: number | null;
  lastEntryNumber: number | null;
  outcomes: GenerateOutcome[];
}

export interface AiClassificationResult {
  classified: number;
  remaining: number;
  providerKind: string | null;
}

/** Statuts pour lesquels aucune écriture n'est à créer. */
export const SETTLED_STATUSES: readonly LineStatus[] = ['Generated', 'Reconciled', 'AlreadyPosted', 'AlreadyImported'];

/** Racines des comptes collectifs : un tiers est obligatoire. */
export const COLLECTIVE_ROOTS: readonly string[] = ['411', '401', '413', '403', '425', '421'];

export function requiresThirdParty(account: string | null | undefined): boolean {
  return !!account && COLLECTIVE_ROOTS.some(root => account.startsWith(root));
}

/** Type de tiers attendu par le compte (1 client, 2 fournisseur, 3 salarié, 0 aucun). */
export function expectedThirdPartyKind(account: string | null | undefined): number {
  if (!account) return 0;
  if (account.startsWith('411') || account.startsWith('413')) return 1;
  if (account.startsWith('401') || account.startsWith('403')) return 2;
  if (account.startsWith('425') || account.startsWith('421')) return 3;
  return 0;
}
