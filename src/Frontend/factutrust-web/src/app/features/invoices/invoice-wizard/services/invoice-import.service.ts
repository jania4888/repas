import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, timeout, TimeoutError, catchError, throwError } from 'rxjs';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { environment } from '@environments/environment';
import { ApiResponse } from '@core/services/auth.service';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { InvoiceImportCapabilities, InvoiceImportResult, InvoiceImportWarmUpResponse } from '../models/invoice-import.models';

/**
 * Service d'import de facture depuis un fichier (PDF / image / Word / Excel).
 * Appelle l'endpoint IA dédié, isolé du chat de l'assistant.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceImportService {
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly baseUrl = `${environment.apiUrl}/ai`;

  /** Aligné sur Ollama:ImportLlmTimeoutSeconds (+ marge 10 s). */
  private static readonly ImportTimeoutMs = 190_000;

  /**
   * Envoie le fichier au backend pour extraction IA et renvoie les données
   * structurées de la facture. Lève une erreur en cas d'échec ou de délai dépassé.
   */
  importInvoice(file: File): Observable<InvoiceImportResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return this.http
      .post<ApiResponse<InvoiceImportResult>>(`${this.baseUrl}/invoice-import`, formData, {
        context: createHttpContextSkipGlobalErrorUi()
      })
      .pipe(
        timeout(InvoiceImportService.ImportTimeoutMs),
        map((res) => {
          if (!res?.success || !res.data) {
            throw new Error(res?.message || "Échec de l'import de la facture.");
          }
          return res.data;
        }),
        catchError((err) => {
          if (err instanceof TimeoutError) {
            return throwError(() => new Error(
              "L'analyse IA a dépassé le délai maximal. Le modèle est peut-être en cours "
              + 'de chargement — réessayez dans un instant.'));
          }
          const message = this.errorHandler.extractErrorMessage(err).trim();
          if (message && !(err instanceof HttpErrorResponse && err.status === 0)) {
            return throwError(() => new Error(message));
          }
          return throwError(() => err);
        })
      );
  }

  /**
   * Capacités d'import. Sert à savoir si un service d'extraction documentaire externe est actif :
   * dans ce cas il est le SEUL lecteur, et l'écran doit le dire plutôt que d'annoncer une analyse
   * IA locale qui n'aura pas lieu.
   */
  capabilities(): Observable<InvoiceImportCapabilities> {
    return this.http.get<InvoiceImportCapabilities>(`${this.baseUrl}/invoice-import/capabilities`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  /**
   * Préchauffe le modèle IA d'import. Appelé à l'ouverture de la modale.
   */
  warmUpModel(): Observable<InvoiceImportWarmUpResponse> {
    return this.http
      .post<InvoiceImportWarmUpResponse>(`${this.baseUrl}/invoice-import/warm-up`, {}, {
        context: createHttpContextSkipGlobalErrorUi()
      });
  }
}
