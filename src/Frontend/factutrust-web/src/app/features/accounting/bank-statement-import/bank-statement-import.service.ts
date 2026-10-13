import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import {
  AiClassificationResult,
  BankStatementImportCapabilities,
  BankStatementImportHistoryPage,
  BankStatementImportSession,
  BankStatementProposals,
  BankStatementTabularMapping,
  BankStatementTabularPreview,
  ConfirmBankStatementImportRequest,
  ConfirmResult,
  GenerateItem,
  GenerateOptions,
  GenerateResult
} from './bank-statement-import.models';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
}

/**
 * Erreur API portant un code stable (le front ne teste jamais le texte). `data` porte la charge
 * utile optionnelle d'un refus (ex. `GenerateResult` figé pour `atomic_rejected`, ou
 * `{ missingLineIds }` pour `atomic_incomplete`) ; absente pour les autres codes.
 */
export class BankStatementImportError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number, readonly data?: unknown) {
    super(message);
  }
}

/** Client HTTP de l'import IA de relevés bancaires (`/api/accounting/bank-statement-import`). */
@Injectable({ providedIn: 'root' })
export class BankStatementImportService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accounting/bank-statement-import`;
  private readonly context = createHttpContextSkipGlobalErrorUi();

  /**
   * Capacités ; `null` = fonctionnalité indisponible pour cet écran, quelle qu'en soit la raison :
   * désactivée (`enabled:false`), serveur plus ancien (404) ou erreur. Seul signal « désactivé » des appelants.
   * `includeAi:false` épargne la sonde du moteur IA aux écrans qui n'ont besoin que de l'interrupteur.
   */
  capabilities(options: { includeAi?: boolean } = {}): Observable<BankStatementImportCapabilities | null> {
    const params = options.includeAi === false ? new HttpParams().set('includeAi', 'false') : undefined;
    return this.http
      .get<ApiEnvelope<BankStatementImportCapabilities>>(`${this.base}/capabilities`, { context: this.context, params })
      .pipe(
        map(res => (res?.success && res.data?.enabled ? res.data : null)),
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

  retarget(sessionId: string, bankAccountId: string): Observable<BankStatementImportSession> {
    return this.unwrap(
      this.http.post<ApiEnvelope<BankStatementImportSession>>(
        `${this.base}/sessions/${sessionId}/retarget`,
        { bankAccountId },
        { context: this.context }
      )
    );
  }

  /**
   * Relance la lecture complète du fichier sur le même compte (IA indisponible avant lancement,
   * session en échec) ; renvoie la nouvelle session.
   */
  retry(sessionId: string): Observable<BankStatementImportSession> {
    return this.unwrap(
      this.http.post<ApiEnvelope<BankStatementImportSession>>(`${this.base}/sessions/${sessionId}/retry`, {}, { context: this.context })
    );
  }

  /**
   * Enregistre le relevé avec les corrections de lignes ; `acknowledgeBalanceWarning` n'est émis
   * que lorsqu'il vaut vrai (accusé explicite de l'écart de solde, D4).
   */
  confirm(id: string, request: ConfirmBankStatementImportRequest = { corrections: [] }): Observable<ConfirmResult> {
    const body: ConfirmBankStatementImportRequest = { corrections: request.corrections ?? [] };
    if (request.acknowledgeBalanceWarning === true) body.acknowledgeBalanceWarning = true;
    return this.unwrap(this.http.post<ApiEnvelope<ConfirmResult>>(`${this.base}/sessions/${id}/confirm`, body, { context: this.context }));
  }

  proposals(statementId: string, options: { assist?: boolean } = {}): Observable<BankStatementProposals> {
    const params = options.assist ? new HttpParams().set('assist', 'full') : undefined;
    return this.unwrap(
      this.http.get<ApiEnvelope<BankStatementProposals>>(`${this.base}/statements/${statementId}/proposals`, { context: this.context, params })
    );
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

  /**
   * Génère les écritures en brouillard de ce relevé. Sans `options`, le corps reste exactement
   * `{ journalCode, items }` (comportement historique inchangé). Avec `options.atomic`, la
   * génération est « tout ou rien » (D4) et accepte `assist`/`excludedLineIds`.
   */
  generate(statementId: string, journalCode: string, items: GenerateItem[], options?: GenerateOptions): Observable<GenerateResult> {
    const body: Record<string, unknown> = { journalCode, items };
    if (options?.atomic !== undefined) body['atomic'] = options.atomic;
    if (options?.assist !== undefined) body['assist'] = options.assist;
    if (options?.excludedLineIds !== undefined) body['excludedLineIds'] = options.excludedLineIds;
    return this.unwrap(this.http.post<ApiEnvelope<GenerateResult>>(`${this.base}/statements/${statementId}/generate`, body, { context: this.context }));
  }

  /**
   * Aperçu sans état d'un fichier CSV/XLSX : détection, mappage suggéré ou mémorisé, lignes brutes
   * et interprétées (20 au plus chacune), signalements. N'écrit rien côté serveur (ni session, ni
   * fichier, ni audit) : chaque changement de mappage relance cet appel (D2, debounce 400 ms).
   */
  tabularPreview(file: File, mapping?: BankStatementTabularMapping, bankAccountId?: string): Observable<BankStatementTabularPreview> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (mapping) form.append('mapping', JSON.stringify(mapping));
    if (bankAccountId) form.append('bankAccountId', bankAccountId);
    return this.unwrap(
      this.http.post<ApiEnvelope<BankStatementTabularPreview>>(`${this.base}/tabular/preview`, form, { context: this.context })
    );
  }

  /** Crée la session d'import tabulaire (CSV/XLSX) avec le mappage final ; renvoie une session `AwaitingReview`. */
  startTabular(file: File, bankAccountId: string, journalCode: string, mapping: BankStatementTabularMapping): Observable<BankStatementImportSession> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('bankAccountId', bankAccountId);
    form.append('journalCode', journalCode);
    form.append('mapping', JSON.stringify(mapping));
    return this.unwrap(
      this.http.post<ApiEnvelope<BankStatementImportSession>>(`${this.base}/sessions/tabular`, form, { context: this.context })
    );
  }

  /** Historique paginé des relevés importés par ce parcours (hors rapprochement manuel). */
  history(page: number, pageSize: number, bankAccountId?: string): Observable<BankStatementImportHistoryPage> {
    let params = new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
    if (bankAccountId) params = params.set('bankAccountId', bankAccountId);
    return this.unwrap(
      this.http.get<ApiEnvelope<BankStatementImportHistoryPage>>(`${this.base}/statements`, { context: this.context, params })
    );
  }

  private unwrap<T>(request: Observable<ApiEnvelope<T>>): Observable<T> {
    return request.pipe(
      map(res => {
        if (!res?.success) {
          throw new BankStatementImportError(res?.error ?? res?.message ?? '', res?.code ?? null, 200, res?.data);
        }
        return res.data as T;
      }),
      catchError((err: unknown) => {
        if (err instanceof BankStatementImportError) return throwError(() => err);
        if (err instanceof HttpErrorResponse) {
          const body = err.error as ApiEnvelope<unknown> | null;
          return throwError(
            () => new BankStatementImportError(body?.error ?? body?.message ?? '', body?.code ?? null, err.status, body?.data)
          );
        }
        return throwError(() => new BankStatementImportError('', null, 0));
      })
    );
  }
}
