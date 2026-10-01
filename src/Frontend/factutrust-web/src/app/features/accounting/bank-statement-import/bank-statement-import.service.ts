import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import {
  AiClassificationResult,
  BankStatementImportCapabilities,
  BankStatementImportSession,
  BankStatementProposals,
  ConfirmResult,
  GenerateItem,
  GenerateResult
} from './bank-statement-import.models';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
}

/** Erreur API portant un code stable (le front ne teste jamais le texte). */
export class BankStatementImportError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
  }
}

/** Client HTTP de l'import IA de relevés bancaires (`/api/accounting/bank-statement-import`). */
@Injectable({ providedIn: 'root' })
export class BankStatementImportService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accounting/bank-statement-import`;
  private readonly context = createHttpContextSkipGlobalErrorUi();

  /** Capacités ; `null` si la fonctionnalité est désactivée (404) ou inaccessible. */
  capabilities(): Observable<BankStatementImportCapabilities | null> {
    return this.http.get<ApiEnvelope<BankStatementImportCapabilities>>(`${this.base}/capabilities`, { context: this.context }).pipe(
      map(res => (res?.success && res.data ? res.data : null)),
      catchError(() => of(null))
    );
  }

  start(file: File, bankAccountId: string, journalCode: string): Observable<BankStatementImportSession> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('bankAccountId', bankAccountId);
    form.append('journalCode', journalCode);
    return this.unwrap(this.http.post<ApiEnvelope<BankStatementImportSession>>(`${this.base}/sessions`, form, { context: this.context }));
  }

  session(id: string): Observable<BankStatementImportSession> {
    return this.unwrap(this.http.get<ApiEnvelope<BankStatementImportSession>>(`${this.base}/sessions/${id}`, { context: this.context }));
  }

  cancel(id: string): Observable<unknown> {
    return this.unwrap(this.http.delete<ApiEnvelope<unknown>>(`${this.base}/sessions/${id}`, { context: this.context }));
  }

  confirm(id: string): Observable<ConfirmResult> {
    return this.unwrap(this.http.post<ApiEnvelope<ConfirmResult>>(`${this.base}/sessions/${id}/confirm`, { corrections: [] }, { context: this.context }));
  }

  proposals(statementId: string): Observable<BankStatementProposals> {
    return this.unwrap(this.http.get<ApiEnvelope<BankStatementProposals>>(`${this.base}/statements/${statementId}/proposals`, { context: this.context }));
  }

  classifyWithAi(statementId: string): Observable<AiClassificationResult> {
    return this.unwrap(this.http.post<ApiEnvelope<AiClassificationResult>>(`${this.base}/statements/${statementId}/ai-classify`, {}, { context: this.context }));
  }

  /** Pièce justificative (fichier d'origine) d'un relevé enregistré par l'import IA. */
  sourceFile(statementId: string): Observable<Blob> {
    return this.http.get(`${this.base}/statements/${statementId}/source-file`, { responseType: 'blob', context: this.context }).pipe(
      catchError((err: unknown) =>
        throwError(() => new BankStatementImportError('', null, err instanceof HttpErrorResponse ? err.status : 0))
      )
    );
  }

  generate(statementId: string, journalCode: string, items: GenerateItem[]): Observable<GenerateResult> {
    return this.unwrap(this.http.post<ApiEnvelope<GenerateResult>>(`${this.base}/statements/${statementId}/generate`, { journalCode, items }, { context: this.context }));
  }

  private unwrap<T>(request: Observable<ApiEnvelope<T>>): Observable<T> {
    return request.pipe(
      map(res => {
        if (!res?.success) {
          throw new BankStatementImportError(res?.error ?? res?.message ?? '', res?.code ?? null, 200);
        }
        return res.data as T;
      }),
      catchError((err: unknown) => {
        if (err instanceof BankStatementImportError) return throwError(() => err);
        if (err instanceof HttpErrorResponse) {
          const body = err.error as ApiEnvelope<unknown> | null;
          return throwError(() => new BankStatementImportError(body?.error ?? body?.message ?? '', body?.code ?? null, err.status));
        }
        return throwError(() => new BankStatementImportError('', null, 0));
      })
    );
  }
}
