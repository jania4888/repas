import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { formatLocalDate } from '../shared/accounting-date-utils';
import { AccountingExportFormat } from '../shared/accounting-download.util';

export enum BankStatementFileFormat {
  Csv = 0,
  Excel = 1,
  Pdf = 2,
  Image = 3,
  Ofx = 4,
  Mt940 = 5
}

export enum BankStatementExtractionMethod {
  Unknown = 0,
  TextParser = 1,
  OcrTextParser = 2,
  OcrLlm = 3
}

export function normalizeExtractionMethod(value: unknown): BankStatementExtractionMethod {
  if (typeof value === 'number') return value as BankStatementExtractionMethod;
  const map: Record<string, BankStatementExtractionMethod> = {
    unknown: BankStatementExtractionMethod.Unknown,
    textParser: BankStatementExtractionMethod.TextParser,
    ocrTextParser: BankStatementExtractionMethod.OcrTextParser,
    ocrLlm: BankStatementExtractionMethod.OcrLlm
  };
  return map[String(value)] ?? BankStatementExtractionMethod.Unknown;
}

export interface BankStatementLineDto {
  id: string;
  transactionDate: string;
  reference: string;
  description: string;
  amount: number;
  isDebit: boolean;
  isReconciled: boolean;
  reconciledJournalEntryLineId?: string | null;
}

export interface BankStatementDto {
  id: string;
  bankName: string;
  accountNumber: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  bankAccountId?: string | null;
  chartOfAccountNumber?: string | null;
  sourceFileName?: string | null;
  importMethod?: number;
  lines: BankStatementLineDto[];
  skippedDuplicateCount?: number;
}

/** Poste de suspens d'un état de rapprochement. */
export interface BankReconciliationItemDto {
  date: string;
  reference: string;
  label: string;
  debit: number;
  credit: number;
}

/** État de rapprochement : confrontation solde comptable ↔ solde relevé, suspens, écart. */
export interface BankReconciliationStatementDto {
  statementId: string;
  bankName: string;
  accountNumber: string;
  chartOfAccountNumber: string;
  periodStart: string;
  periodEnd: string;
  statementClosingBalance: number;
  accountingBalance: number;
  unreconciledBookItems: BankReconciliationItemDto[];
  unreconciledStatementItems: BankReconciliationItemDto[];
  adjustedStatementBalance: number;
  adjustedAccountingBalance: number;
  difference: number;
  isReconciled: boolean;
}

export interface ImportBankStatementLineRequest {
  transactionDate: string;
  valueDate?: string | null;
  reference: string;
  description: string;
  amount: number;
  isDebit: boolean;
}

export interface ImportBankStatementRequest {
  bankName: string;
  accountNumber: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  currency?: string;
  bankAccountId?: string | null;
  chartOfAccountNumber?: string | null;
  sourceFileName?: string | null;
  sourceFileHash?: string | null;
  importMethod?: number;
  skipAlreadyImported?: boolean;
  lines: ImportBankStatementLineRequest[];
}

export interface BankImportIssueDto {
  ref: string;
  message: string;
  isBlocking: boolean;
}

export interface BankStatementFilePreviewDto {
  totalLines: number;
  validLines: number;
  totalDebit: number;
  totalCredit: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  canImport: boolean;
  issues: BankImportIssueDto[];
  lines: ImportBankStatementLineRequest[];
  detectedBankCode?: string | null;
  detectedRib?: string | null;
  detectedIban?: string | null;
  matchedBankAccountId?: string | null;
  matchedChartOfAccountNumber?: string | null;
  suggestedBankName?: string | null;
  suggestedOpeningBalance?: number | null;
  suggestedClosingBalance?: number | null;
  extractionMethod?: BankStatementExtractionMethod;
  confidenceScore?: number;
  sourcePageCount?: number;
  balanceDiscrepancy?: number | null;
  /**
   * Fichier contenant plusieurs relevés (ex. deux mois assemblés) : un aperçu par relevé, dans l'ordre
   * chronologique, chacun importable séparément. Absent ou null = un seul relevé.
   */
  statements?: BankStatementFilePreviewDto[] | null;
}

export interface ReconcileLineRequest {
  bankStatementLineId: string;
  journalEntryLineId: string;
}

/** Statut d'association d'une ligne de relevé (association automatique). */
export enum BankLineAssociationStatus {
  NotAssociated = 0,
  ToReconcile = 1,
  Associated = 2
}

export interface BankLineAssociationDto {
  bankStatementLineId: string;
  transactionDate: string;
  description: string;
  amount: number;
  isDebit: boolean;
  status: BankLineAssociationStatus;
  proposedJournalEntryLineId?: string | null;
  proposedEntryRef?: string | null;
  candidateCount: number;
}

export interface BankReconciliationSummaryDto {
  importedCount: number;
  autoMatchedCount: number;
  toReconcileCount: number;
  notAssociatedCount: number;
  totalCredit: number;
  totalDebit: number;
  statementBalance: number;
}

export interface AutoAssociationResultDto {
  associations: BankLineAssociationDto[];
  summary: BankReconciliationSummaryDto;
}

export interface ReconcilePairRequest {
  bankStatementLineId: string;
  journalEntryLineId: string;
}

export interface ApplyAssociationsResultDto {
  appliedCount: number;
  failures: string[];
}

export interface CreateEntryForLineRequest {
  journalCode: string;
  counterpartyAccount: string;
  label?: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class BankReconciliationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/bank-reconciliation`;

  getStatements(accountNumber?: string | null, from?: Date | null, to?: Date | null): Observable<ApiResponse<BankStatementDto[]>> {
    let p = new HttpParams();
    if (accountNumber && accountNumber.trim()) p = p.set('accountNumber', accountNumber.trim());
    if (from) p = p.set('from', formatLocalDate(from));
    if (to) p = p.set('to', formatLocalDate(to));
    return this.http.get<ApiResponse<BankStatementDto[]>>(`${this.base}/statements`, { params: p });
  }

  getStatement(id: string): Observable<ApiResponse<BankStatementDto>> {
    return this.http.get<ApiResponse<BankStatementDto>>(`${this.base}/statements/${id}`);
  }

  previewStatementFile(file: File, format: BankStatementFileFormat): Observable<ApiResponse<BankStatementFilePreviewDto>> {
    const form = new FormData();
    form.append('file', file);
    form.append('format', String(format));
    return this.http.post<ApiResponse<BankStatementFilePreviewDto>>(`${this.base}/statements/import-file`, form);
  }

  importStatement(request: ImportBankStatementRequest): Observable<ApiResponse<BankStatementDto>> {
    return this.http.post<ApiResponse<BankStatementDto>>(`${this.base}/statements`, request);
  }

  reconcileLine(request: ReconcileLineRequest): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/reconcile`, request);
  }

  unreconcileLine(bankStatementLineId: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/unreconcile/${bankStatementLineId}`, {});
  }

  /** Association automatique : propositions par ligne + récapitulatif (ne persiste rien). */
  autoAssociate(statementId: string): Observable<ApiResponse<AutoAssociationResultDto>> {
    return this.http.post<ApiResponse<AutoAssociationResultDto>>(`${this.base}/statements/${statementId}/auto-associate`, {});
  }

  /** Rapproche en lot les paires confirmées (ligne de relevé ↔ ligne d'écriture). */
  applyAssociations(statementId: string, pairs: ReconcilePairRequest[]): Observable<ApiResponse<ApplyAssociationsResultDto>> {
    return this.http.post<ApiResponse<ApplyAssociationsResultDto>>(
      `${this.base}/statements/${statementId}/apply-associations`, { pairs });
  }

  /** Comptabilise une ligne non rapprochée : écriture banque ↔ contrepartie + rapprochement. */
  createEntryForLine(statementId: string, lineId: string, request: CreateEntryForLineRequest): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(
      `${this.base}/statements/${statementId}/lines/${lineId}/create-entry`, request);
  }

  /** État de rapprochement d'un relevé (lecture seule). */
  getReconciliationStatement(statementId: string): Observable<ApiResponse<BankReconciliationStatementDto>> {
    return this.http.get<ApiResponse<BankReconciliationStatementDto>>(
      `${this.base}/statements/${statementId}/reconciliation-statement`);
  }

  /** Export de l'état de rapprochement (csv / excel / pdf). */
  exportReconciliationStatement(statementId: string, format: AccountingExportFormat): Observable<Blob> {
    const p = new HttpParams().set('format', format);
    return this.http.get(`${this.base}/statements/${statementId}/reconciliation-statement/export`,
      { params: p, responseType: 'blob' });
  }
}
