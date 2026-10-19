import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Observable, Subscriber, catchError, of, timeout, TimeoutError } from 'rxjs';
import { environment } from '@environments/environment';
import { ApiResponse } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import {
  PurchaseReceiptImportCapabilities,
  PurchaseReceiptImportEvent,
  PurchaseReceiptImportProposal
} from '../models/purchase-receipt-import.models';

/**
 * Service d'import d'un bon de réception depuis un document (PDF / image).
 * Appelle l'endpoint dédié `api/purchasereceipts/import-document`, isolé du
 * chat de l'assistant IA.
 */
@Injectable({ providedIn: 'root' })
export class PurchaseReceiptImportService {
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly baseUrl = `${environment.apiUrl}/purchasereceipts/import-document`;

  /** Aligné sur le délai maximal d'extraction côté backend (+ marge). */
  private static readonly ImportTimeoutMs = 190_000;

  /**
   * Envoie le fichier au backend pour extraction et renvoie une proposition
   * de bon de réception à faire valider par l'utilisateur. Émet la
   * progression de l'envoi puis le passage en analyse avant le résultat.
   */
  importDocument(file: File): Observable<PurchaseReceiptImportEvent> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return new Observable<PurchaseReceiptImportEvent>((subscriber: Subscriber<PurchaseReceiptImportEvent>) => {
      const sub = this.http
        .post<ApiResponse<PurchaseReceiptImportProposal>>(this.baseUrl, formData, {
          context: createHttpContextSkipGlobalErrorUi(),
          reportProgress: true,
          observe: 'events'
        })
        .pipe(
          timeout(PurchaseReceiptImportService.ImportTimeoutMs),
          catchError((err) => {
            subscriber.error(this.toError(err));
            return of(null);
          })
        )
        .subscribe((event) => {
          if (!event) return;

          if (event.type === HttpEventType.UploadProgress) {
            const percent = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
            subscriber.next({ kind: 'upload', percent });
            if (percent >= 100) {
              subscriber.next({ kind: 'analysing' });
            }
            return;
          }

          if (event.type === HttpEventType.Response) {
            const res = event.body;
            if (!res?.success || !res.data) {
              subscriber.error(new Error(res?.message || "Échec de l'import du document."));
              return;
            }
            subscriber.next({ kind: 'done', proposal: res.data });
            subscriber.complete();
          }
        });

      return () => sub.unsubscribe();
    });
  }

  /**
   * Capacités d'import de document. Pilote l'affichage du libellé générique du
   * moteur d'extraction et de la mention de traitement externe. `null` si
   * l'appel échoue (modale toujours utilisable, juste sans ces indications).
   */
  capabilities(): Observable<PurchaseReceiptImportCapabilities | null> {
    return this.http
      .get<PurchaseReceiptImportCapabilities>(`${this.baseUrl}/capabilities`, {
        context: createHttpContextSkipGlobalErrorUi()
      })
      .pipe(catchError(() => of(null)));
  }

  private toError(err: unknown): Error {
    if (err instanceof TimeoutError) {
      return new Error(
        $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.l.analyse.a.depasse.le.delai.maximal.reessaye.a3a9d9ea:L'analyse a dépassé le délai maximal. Réessayez dans un instant.`
      );
    }

    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new Error(
          $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.impossible.de.joindre.le.serveur.verifiez.qu.6f6c0f6a:Impossible de joindre le serveur. Vérifiez que l'API est démarrée.`
        );
      }
      if (err.status === 413) {
        return new Error(
          $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.fichier.trop.volumineux.maximum.10.mo.3d6c2a11:Fichier trop volumineux (maximum 10 Mo).`
        );
      }
      if (err.status === 403) {
        return new Error(
          $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.vous.n.avez.pas.les.droits.necessaires.pour.imp.9c7d1a0e:Vous n'avez pas les droits nécessaires pour importer un document.`
        );
      }
      if (err.status === 429) {
        return new Error(
          $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.trop.de.demandes.d.import.reessayez.dans.un.in.0e1b7c5d:Trop de demandes d'import. Réessayez dans un instant.`
        );
      }
      if (err.status === 502) {
        return new Error(
          $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.le.service.d.extraction.documentaire.est.indisp.1a2b3c4d:Le service d'extraction documentaire est indisponible. Réessayez plus tard ou saisissez le bon de réception manuellement.`
        );
      }
      const message = this.errorHandler.extractErrorMessage(err).trim();
      if (message && !message.includes('Http failure')) {
        return new Error(message);
      }
    }

    if (err instanceof Error && err.message && !err.message.includes('Http failure')) {
      return err;
    }

    return new Error(
      $localize`:@@features.purchase-receipts.services.purchase-receipt-import.service.ts.impossible.d.analyser.ce.document.verifiez.le.fi.2b3c4d5e:Impossible d'analyser ce document. Vérifiez le fichier ou saisissez le bon de réception manuellement.`
    );
  }
}
