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
  /** Période imprimée sur le relevé (et non déduite des opérations). */
  periodPrinted?: boolean;
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
  /**
   * Pages confiées à l'IA et pourquoi (« tout document par l'IA ») ; absent ou null = ancien
   * fonctionnement (pages scannées seulement). Plan vide = lecture directe prouvée, aucune IA.
   */
  aiPlan?: BankStatementAiPlan | null;
}

/** Codes stables du motif de relecture IA. */
export type AiReadingReason = 'scanned' | 'line_issues' | 'unverified';

/**
 * Moteur qui a fourni une page (lecture « IA seule ») : GLM-OCR (gabarit JSON), GLM-OCR en
 * reconnaissance de tableau, modèle texte local (repli D2) ou échec des trois étages.
 */
export type BankStatementPageReadingEngine = 'glm-ocr' | 'glm-ocr-table' | 'text-model' | 'failed' | (string & {});

/** Trace de lecture d'une page, alimentée au fil de la lecture ; aucune donnée de relevé. */
export interface BankStatementPageReading {
  page: number;
  engine: BankStatementPageReadingEngine;
  model: string | null;
  attempts: number;
  durationMs: number;
  lineCount: number;
  failureReason: string | null;
}

export interface BankStatementAiPlan {
  scannedPages: number[];
  textPages: number[];
  reason: AiReadingReason | null;
  estimatedCalls: number;
  estimatedSeconds: number;
  engine?: 'vision' | 'text' | null;
  /** Pages relues par le modèle texte (dérivé de `pageReadings` en lecture IA seule). */
  fallbackPages?: number[];
  /** `complement` : IA en complément de la lecture directe ; `ai_only` : toutes les pages par l'IA. */
  mode?: 'complement' | 'ai_only';
  /** Lecture page par page (remplie progressivement pendant `Extracting`). */
  pageReadings?: BankStatementPageReading[];
}

/**
 * Méthode de lecture : « layout », « layout+ai », « ai » (historique) ; « ai-vision », « ai-text »,
 * « none » en lecture IA seule. Toute autre valeur s'affiche « — ».
 */
export type ExtractionMethod = 'layout' | 'layout+ai' | 'ai' | 'ai-vision' | 'ai-text' | 'none' | (string & {});

/** Codes d'échec connus d'une session `Failed` (lecture IA). */
export type SessionErrorCode = 'ai_timeout' | 'ai_failed' | 'ai_unavailable' | (string & {});

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
  extractionMethod: ExtractionMethod | null;
  profileId: string | null;
  aiProviderKind: 'local' | 'external' | null;
  errorCode: SessionErrorCode | null;
  statementId: string | null;
  expiresAt: string;
  extraction: ExtractedBankStatement | null;
  balanceCheck: BalanceCheck | null;
  canConfirm: boolean;
  /**
   * L'enregistrement exige l'accusé explicite de l'écart de solde (relevé lu entièrement par l'IA,
   * contrôle en avertissement). Calculé par le serveur ; absent = faux, jamais dérivé côté client.
   */
  requiresBalanceAcknowledgement?: boolean;
  /** Rang (1…N) du relevé dans un fichier qui en contient plusieurs ; null = fichier d'un seul relevé. */
  segmentIndex?: number | null;
  segmentCount?: number | null;
  /** Les autres relevés du même fichier, une session chacun (ordre chronologique). */
  siblings?: BankStatementImportSibling[];
}

export interface BankStatementImportSibling {
  id: string;
  segmentIndex: number;
  periodStart: string | null;
  periodEnd: string | null;
  status: SessionStatus;
  statementId: string | null;
}

/**
 * Correction d'une ligne lue par l'IA, indexée par `lineIndex` ; seuls les champs modifiés sont
 * renseignés. `exclude` retire la ligne (les autres champs sont alors ignorés par le serveur).
 */
export interface StatementLineCorrection {
  lineIndex: number;
  transactionDate?: string;
  amount?: number;
  isDebit?: boolean;
  label?: string;
  exclude?: boolean;
}

/** Corps de `POST sessions/{id}/confirm` ; `acknowledgeBalanceWarning` n'est émis que s'il vaut vrai. */
export interface ConfirmBankStatementImportRequest {
  corrections: StatementLineCorrection[];
  acknowledgeBalanceWarning?: boolean;
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
  /** Tout relevé PDF ou image passe par l'import IA (le rapprochement y bascule ces fichiers). */
  allDocumentsViaAi?: boolean;
  aiEngine?: 'vision' | 'text' | null;
  /** Pourquoi aucune lecture IA n'est possible (code court) ; null quand l'IA est disponible. */
  aiUnavailableReason?: string | null;
  /** Pourquoi GLM-OCR n'est pas prêt alors que le modèle texte reste disponible ; null sinon. */
  visionUnavailableReason?: string | null;
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
