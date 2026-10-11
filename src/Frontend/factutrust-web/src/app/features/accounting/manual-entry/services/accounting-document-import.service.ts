import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError, timeout, TimeoutError } from 'rxjs';
import { environment } from '@environments/environment';
import { ApiResponse } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import {
  DocumentDirection,
  DocumentImportCapabilities,
  JournalEntryProposal
} from '../models/accounting-document-import.models';

/**
 * Import d'une pièce comptable (facture de vente ou d'achat) depuis la saisie manuelle
 * d'écritures. L'endpoint est en lecture seule : il renvoie une PROPOSITION d'écriture,
 * que l'utilisateur relit puis applique au formulaire avant d'enregistrer.
 */
@Injectable()
export class AccountingDocumentImportService {
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly baseUrl = `${environment.apiUrl}/accounting/document-import`;

  /** Aligné sur Ollama:ImportLlmTimeoutSeconds (+ marge 10 s), comme l'import du wizard. */
  private static readonly ImportTimeoutMs = 190_000;

  /**
   * Message stable affiché pour un 502/503/504 (passerelle/proxy) sans erreur API structurée, à la place du texte brut du
   * fournisseur (p. ex. « Bad Gateway »). Local à ce service : le gestionnaire d'erreurs global
   * et le message de délai (`TimeoutError`) ne sont pas concernés.
   */
  private static readonly GatewayErrorMessage = $localize`:@@accounting.accounting-document-import.ts.l.analyse.n.a.pas.abouti.le.serveur.d.an.35b77eb9:L'analyse n'a pas abouti : le serveur d'analyse n'a pas répondu à temps. Réessayez dans un instant ; si la pièce est longue, seules les pages 1, 2 et les 3 dernières sont lues.`;

  /**
   * Analyse la pièce et renvoie la proposition d'écriture.
   *
   * @param direction Force le sens (vente/achat) lorsque l'utilisateur corrige la détection,
   *                  ce qui évite de re-téléverser le fichier.
   */
  propose(file: File, direction?: DocumentDirection): Observable<JournalEntryProposal> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    let params = new HttpParams();
    if (direction) {
      params = params.set('direction', direction);
    }

    return this.http
      .post<ApiResponse<JournalEntryProposal>>(`${this.baseUrl}/propose`, formData, {
        params,
        context: createHttpContextSkipGlobalErrorUi()
      })
      .pipe(
        timeout(AccountingDocumentImportService.ImportTimeoutMs),
        map((res) => {
          if (!res?.success || !res.data) {
            throw new Error(res?.message || "Échec de l'analyse de la pièce.");
          }
          return res.data;
        }),
        catchError((err) => {
          if (err instanceof TimeoutError) {
            return throwError(() => new Error(
              "L'analyse a dépassé le délai maximal. Le modèle IA est peut-être en cours "
              + 'de chargement — réessayez dans un instant.'));
          }
          // Seulement si la réponse ne porte pas d'erreur API structurée (ex. 503 TENANT_MIGRATION_FAILED,
          // dont le message propre doit rester visible).
          if (err instanceof HttpErrorResponse
            && [502, 503, 504].includes(err.status)
            && !this.errorHandler.getApiErrorCode(err)) {
            return throwError(() => new Error(AccountingDocumentImportService.GatewayErrorMessage));
          }
          const message = this.errorHandler.extractErrorMessage(err).trim();
          if (message && !(err instanceof HttpErrorResponse && err.status === 0)) {
            return throwError(() => new Error(message));
          }
          return throwError(() => err);
        })
      );
  }

  /** Capacités du serveur (parseur natif, repli IA, OCR). Non bloquant. */
  capabilities(): Observable<DocumentImportCapabilities> {
    return this.http.get<DocumentImportCapabilities>(`${this.baseUrl}/capabilities`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }
}
