import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { Observable, throwError, of, from } from 'rxjs';
import { shareReplay, catchError, switchMap, tap } from 'rxjs/operators';
import { CashDeskService } from './cash-desk.service';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

export type InvoiceTypeCode = 'INVOICE' | 'CREDIT_NOTE';

export interface InvoiceListItem {
  id: string;
  number: string;
  /** Discriminates regular invoice (FAC) from credit note (AVO). */
  type: InvoiceTypeCode;
  isCreditNote: boolean;
  issueDate: string;
  dueDate: string | null;
  status: string;
  statusCssClass: string;
  clientName: string;
  /** Signed total: positive on FAC, negative on AVO. */
  totalAmount: number;
  currency: string;
  isOverdue: boolean;
  paidAt?: string | null;
  totalPaid: number;
  /** Magnitude (>= 0). For AVO this is the amount still to refund. */
  remainingAmount: number;
}

export interface InvoiceLine {
  id: string;
  lineNumber: number;
  productId: string;
  productCode: string;
  productName: string;
  productDescription: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRatePercent: number;
  discountPercent: number | null;
  discountAmount: number;
  allocatedGlobalDiscount?: number;
  subTotal: number;
  isFodecApplicable?: boolean;
  fodecAmount?: number;
  vatAmount: number;
  total: number;
}

export interface VatBreakdown {
  rate: number;
  rateDisplay: string;
  baseAmount: number;
  vatAmount: number;
}

export interface ClientSummary {
  id: string;
  name: string;
  nif: string | null;
  email: string;
  address: string;
}

export interface PaymentDto {
  id: string;
  amount: number;
  currency: string;
  paymentDate: string;
  method: number;
  methodDisplay: string;
  reference: string | null;
  notes: string | null;
  isRefunded: boolean;
  createdAt: string;
  clientWithholdingAmount?: number | null;
  totalAppliedTowardInvoice?: number;
  /** Effet de commerce : échéance, statut (0 en portefeuille, 1 encaissé, 2 impayé). */
  effetDueDate?: string | null;
  effetStatus?: number | null;
  effetStatusDisplay?: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: string;
  /** Discriminates regular invoice (FAC) from credit note (AVO). */
  type: InvoiceTypeCode;
  isCreditNote: boolean;
  issueDate: string;
  dueDate: string | null;
  status: string;
  statusDisplay: string;
  clientId: string;
  client: ClientSummary;
  reference: string | null;
  notes: string | null;
  paymentTerms: string | null;
  lines: InvoiceLine[];
  warehouseId?: string | null;
  /** Signed total HT: positive on FAC, negative on AVO. */
  subTotal: number;
  globalDiscountPercent?: number | null;
  globalDiscountAmount?: number;
  /** Signed total VAT: positive on FAC, negative on AVO. */
  totalVat: number;
  /** Signed total FODEC: positive on FAC, negative on AVO. */
  fodecAmount?: number;
  /** Document-level fiscal stamp (signed). */
  fiscalStampAmount?: number;
  /** Signed total TTC: positive on FAC, negative on AVO. */
  totalAmount: number;
  currency: string;
  vatBreakdown: VatBreakdown[];
  signatureHash: string | null;
  signedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  payments?: PaymentDto[];
  totalPaid?: number;
  /** Magnitude (>= 0). For AVO this is the amount still to refund. */
  remainingAmount?: number;
  totalClientWithholding?: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface CreateInvoiceLine {
  productId: string;
  quantity: number;
  customUnitPrice?: number;
  discountPercent?: number;
}

export interface CreateInvoiceRequest {
  clientId: string;
  issueDate: string;
  dueDate?: string;
  reference?: string;
  notes?: string;
  paymentTerms?: string;
  warehouseId?: string | null;
  lines: CreateInvoiceLine[];
}

export interface InvoiceSearchParams {
  search?: string;
  status?: number;
  fromDate?: string;
  toDate?: string;
  clientId?: string;
  page?: number;
  pageSize?: number;
  unpaidOnly?: boolean;
  /** Discriminates FAC vs AVO. Omitted = all document types (dashboard, reports, search). */
  type?: InvoiceTypeCode;
  /** When true, global 403 modal / toast is suppressed (e.g. dashboard aggregate). */
  skipGlobalErrorUi?: boolean;
}

/**
 * Totaux agrégés de la liste des factures, calculés côté backend sur l'ensemble filtré
 * complet (pas seulement la page courante). Alimente la zone de totaux au-dessus du tableau.
 */
export interface InvoiceListSummary {
  count: number;
  /** Somme des totaux TTC signés (les avoirs réduisent le total). */
  totalTtc: number;
  /** Somme des totaux HT signés. */
  totalHt: number;
  /** Somme des TVA signées. */
  totalVat: number;
  /** Somme des paiements non remboursés (net + retenue subie). */
  totalPaid: number;
  /** Somme par facture de max(0, |TTC| − payé) — identique à la colonne « Reste à payer ». */
  totalRemaining: number;
  /** Nombre de factures filtrées en retard. */
  overdueCount: number;
  currency: string;
}

export interface RecordPaymentRequest {
  paymentDate: string;
  amount?: number;
  method?: number;
  reference?: string;
  notes?: string;
  clientWithholdingAmount?: number;
  /** Échéance de la traite (yyyy-MM-dd). Requis lorsque method = 5 (Traite). */
  effetDueDate?: string;
  cashRegisterSessionId?: string;
}

/** Requête de règlement d'un effet client à échéance. */
export interface SettleEffetRequest {
  settlementDate: string;
  /** Issue : 1 = encaissé, 2 = impayé. */
  outcome: number;
}

@Injectable({
  providedIn: 'root'
})
export class InvoiceService {
  private readonly API_URL = `${environment.apiUrl}/invoices`;
  private readonly http = inject(HttpClient);
  private readonly cashDesk = inject(CashDeskService);

  // Protection contre les requêtes simultanées multiples avec les mêmes paramètres
  private getInvoicesCache = new Map<string, Observable<ApiResponse<PagedResult<InvoiceListItem>>>>();

  /**
   * Liste paginée ; pas de retry automatique sur 429 (évite d’amplifier le rate limiting).
   * Requêtes identiques partagées via cache court.
   */
  getInvoices(params: InvoiceSearchParams = {}): Observable<ApiResponse<PagedResult<InvoiceListItem>>> {
    const skipGlobalErrorUi = params.skipGlobalErrorUi === true;
    let httpParams = new HttpParams();

    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.status !== undefined) httpParams = httpParams.set('status', params.status.toString());
    if (params.fromDate) httpParams = httpParams.set('fromDate', params.fromDate);
    if (params.toDate) httpParams = httpParams.set('toDate', params.toDate);
    if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    if (params.unpaidOnly === true) httpParams = httpParams.set('unpaidOnly', 'true');
    if (params.type) httpParams = httpParams.set('type', params.type);

    // Créer une clé unique pour cette requête basée sur les paramètres (+ sémantique UI erreur)
    const cacheKey = `${httpParams.toString()}|skipUi:${skipGlobalErrorUi ? '1' : '0'}`;

    // Si une requête avec les mêmes paramètres est déjà en cours, la réutiliser
    if (this.getInvoicesCache.has(cacheKey)) {
      return this.getInvoicesCache.get(cacheKey)!;
    }

    const requestOptions: {
      params: HttpParams;
      context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi>;
    } = { params: httpParams };
    if (skipGlobalErrorUi) {
      requestOptions.context = createHttpContextSkipGlobalErrorUi();
    }

    // Créer une nouvelle requête avec partage pour éviter les duplications
    const request$ = this.http.get<ApiResponse<PagedResult<InvoiceListItem>>>(this.API_URL, requestOptions)
      .pipe(
        shareReplay(1),
        catchError((error) => {
          // Retirer de la cache en cas d'erreur
          this.getInvoicesCache.delete(cacheKey);
          return throwError(() => error);
        })
      );

    // Ajouter à la cache
    this.getInvoicesCache.set(cacheKey, request$);

    // Nettoyer la cache après la requête (succès ou erreur)
    request$.subscribe({
      next: () => {
        // Retirer de la cache après un court délai pour permettre les autres subscribers
        setTimeout(() => {
          this.getInvoicesCache.delete(cacheKey);
        }, 100);
      },
      error: () => {
        // Déjà retiré dans catchError
      }
    });

    return request$;
  }

  /**
   * Totaux agrégés respectant les mêmes filtres que {@link getInvoices} (calcul backend sur
   * l'ensemble filtré complet). N'envoie pas page/pageSize : le résumé ignore la pagination.
   */
  getInvoicesSummary(params: InvoiceSearchParams = {}): Observable<ApiResponse<InvoiceListSummary>> {
    const skipGlobalErrorUi = params.skipGlobalErrorUi === true;
    let httpParams = new HttpParams();

    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.status !== undefined) httpParams = httpParams.set('status', params.status.toString());
    if (params.fromDate) httpParams = httpParams.set('fromDate', params.fromDate);
    if (params.toDate) httpParams = httpParams.set('toDate', params.toDate);
    if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);
    if (params.unpaidOnly === true) httpParams = httpParams.set('unpaidOnly', 'true');
    if (params.type) httpParams = httpParams.set('type', params.type);

    const requestOptions: {
      params: HttpParams;
      context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi>;
    } = { params: httpParams };
    if (skipGlobalErrorUi) {
      requestOptions.context = createHttpContextSkipGlobalErrorUi();
    }

    return this.http.get<ApiResponse<InvoiceListSummary>>(`${this.API_URL}/summary`, requestOptions);
  }

  getInvoice(id: string): Observable<ApiResponse<InvoiceDetail>> {
    return this.http.get<ApiResponse<InvoiceDetail>>(`${this.API_URL}/${id}`);
  }

  getInvoicePayments(id: string): Observable<ApiResponse<PaymentDto[]>> {
    return this.http.get<ApiResponse<PaymentDto[]>>(`${this.API_URL}/${id}/payments`);
  }

  createInvoice(invoice: CreateInvoiceRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(this.API_URL, invoice);
  }

  validateInvoice(
    id: string,
    body?: { lineAllocations?: import('./stock.service').DocumentLineAllocations[] }
  ): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/${id}/validate`, body ?? {});
  }

  signInvoice(id: string): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.API_URL}/${id}/sign`, {});
  }

  sendByEmail(id: string): Observable<ApiResponse<object>> {
    return this.http.post<ApiResponse<object>>(`${this.API_URL}/${id}/send-email`, {});
  }

  recordPayment(id: string, request: RecordPaymentRequest): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/${id}/record-payment`, request).pipe(
      tap(res => {
        if (res.success && request.paymentDate?.trim()) {
          this.cashDesk.invalidateCachesAfterCashLedgerMutation(request.paymentDate.trim());
        }
      })
    );
  }

  /**
   * Enregistre plusieurs règlements sur une facture en une seule transaction serveur.
   * Utilisé par l'encaissement fractionné du point de vente : un règlement par mode,
   * chacun donnant lieu à sa propre ligne Payment (et donc à sa propre écriture).
   */
  recordPayments(id: string, requests: RecordPaymentRequest[]): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.API_URL}/${id}/record-payments`, requests).pipe(
      tap(res => {
        const firstDate = requests.find(r => r.paymentDate?.trim())?.paymentDate?.trim();
        if (res.success && firstDate) {
          this.cashDesk.invalidateCachesAfterCashLedgerMutation(firstDate);
        }
      })
    );
  }

  /** Encaisse (ou marque impayé) un effet de commerce client à échéance. */
  settleEffet(invoiceId: string, paymentId: string, request: SettleEffetRequest): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${this.API_URL}/${invoiceId}/payments/${paymentId}/settle-effet`, request).pipe(
      tap(res => {
        if (res.success && request.settlementDate?.trim()) {
          this.cashDesk.invalidateCachesAfterCashLedgerMutation(request.settlementDate.trim());
        }
      })
    );
  }

  downloadReportPdf(fromDate?: string, toDate?: string, clientId?: string, type?: InvoiceTypeCode): Observable<Blob> {
    let httpParams = new HttpParams();
    if (fromDate) httpParams = httpParams.set('fromDate', fromDate);
    if (toDate) httpParams = httpParams.set('toDate', toDate);
    if (clientId) httpParams = httpParams.set('clientId', clientId);
    if (type) httpParams = httpParams.set('type', type);

    return this.http.get(`${this.API_URL}/report/pdf`, {
      params: httpParams,
      responseType: 'blob',
      observe: 'response',
      context: createHttpContextSkipGlobalErrorUi()
    }).pipe(
      switchMap(response => {
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          return from(
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                try {
                  resolve(reader.result as string);
                } catch (error) {
                  reject(error);
                }
              };
              reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
              if (response.body) {
                reader.readAsText(response.body);
              } else {
                reject(new Error('Réponse vide'));
              }
            })
          ).pipe(
            switchMap((jsonText: string) => {
              try {
                const errorResponse = JSON.parse(jsonText);
                const errorMessage = errorResponse?.errors?.[0] ||
                  errorResponse?.message ||
                  errorResponse?.error?.description ||
                  errorResponse?.error?.message ||
                  $localize`:@@core.invoice.ts.impossible.de.generer.le.rapport.pdf.e2243d7a:Impossible de générer le rapport PDF`;
                return throwError(() => new Error(errorMessage));
              } catch {
                return throwError(() => new Error('Impossible de générer le rapport PDF'));
              }
            })
          );
        }

        if (!response.body || response.body.size === 0) {
          return throwError(() => new Error('Le fichier PDF est vide'));
        }

        return of(response.body);
      }),
      catchError((error: HttpErrorResponse | Error) => {
        if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
          return from(
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                try {
                  resolve(reader.result as string);
                } catch (err) {
                  reject(err);
                }
              };
              reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
              reader.readAsText(error.error);
            })
          ).pipe(
            switchMap((jsonText: string) => {
              try {
                const errorResponse = JSON.parse(jsonText);
                const errorMessage = errorResponse?.errors?.[0] ||
                  errorResponse?.message ||
                  errorResponse?.error?.description ||
                  errorResponse?.error?.message ||
                  $localize`:@@core.invoice.ts.erreur.status.impossible.de.generer.le.r.b2e87c10:Erreur ${error.status}:status:: Impossible de générer le rapport PDF`;
                return throwError(() => new Error(errorMessage));
              } catch {
                return throwError(() => new Error(`Erreur ${error.status || 'inconnue'}: Impossible de générer le rapport PDF`));
              }
            })
          );
        }

        if (error instanceof Error) {
          return throwError(() => error);
        }

        const httpError = error as HttpErrorResponse;
        const errorMessage = httpError.error?.message ||
          httpError.error?.errors?.[0] ||
          httpError.error?.error?.description ||
          $localize`:@@core.invoice.ts.erreur.p.impossible.de.generer.le.rappor.edfa5a5c:Erreur ${httpError.status || 'inconnue'}:p:: Impossible de générer le rapport PDF`;
        return throwError(() => new Error(errorMessage));
      })
    );
  }

  downloadPdf(id: string, templateKey?: string): Observable<Blob> {
    const url = templateKey
      ? `${this.API_URL}/${id}/pdf?templateKey=${encodeURIComponent(templateKey)}`
      : `${this.API_URL}/${id}/pdf`;
    return this.http.get(url, {
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      switchMap(response => {
        // Vérifier si la réponse est réellement un PDF
        const contentType = response.headers.get('content-type') || '';

        // Si le Content-Type indique JSON, c'est une erreur
        if (contentType.includes('application/json')) {
          // Lire le blob comme texte pour obtenir le message d'erreur
          return from(
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                try {
                  resolve(reader.result as string);
                } catch (error) {
                  reject(error);
                }
              };
              reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
              if (response.body) {
                reader.readAsText(response.body);
              } else {
                reject(new Error('Réponse vide'));
              }
            })
          ).pipe(
            switchMap((jsonText: string) => {
              try {
                const errorResponse = JSON.parse(jsonText);
                const errorMessage = errorResponse?.message ||
                  errorResponse?.error?.description ||
                  errorResponse?.error?.message ||
                  $localize`:@@core.invoice.ts.impossible.de.telecharger.le.pdf.24ca4288:Impossible de télécharger le PDF`;
                return throwError(() => new Error(errorMessage));
              } catch {
                return throwError(() => new Error('Impossible de télécharger le PDF'));
              }
            })
          );
        }

        // Si le Content-Type est PDF ou octet-stream, retourner le blob
        if (!response.body || response.body.size === 0) {
          return throwError(() => new Error('Le fichier PDF est vide'));
        }

        return of(response.body);
      }),
      catchError((error: HttpErrorResponse | Error) => {
        // Si c'est une erreur HTTP avec un blob (réponse JSON parsée comme blob)
        if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
          return from(
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                try {
                  resolve(reader.result as string);
                } catch (err) {
                  reject(err);
                }
              };
              reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
              reader.readAsText(error.error);
            })
          ).pipe(
            switchMap((jsonText: string) => {
              try {
                const errorResponse = JSON.parse(jsonText);
                const errorMessage = errorResponse?.message ||
                  errorResponse?.error?.description ||
                  errorResponse?.error?.message ||
                  $localize`:@@core.invoice.ts.erreur.status.impossible.de.telecharger.6eec4c6b:Erreur ${error.status}:status:: Impossible de télécharger le PDF`;
                return throwError(() => new Error(errorMessage));
              } catch {
                return throwError(() => new Error(`Erreur ${error.status || 'inconnue'}: Impossible de télécharger le PDF`));
              }
            })
          );
        }

        // Si c'est déjà une Error (de notre code), la retourner telle quelle
        if (error instanceof Error) {
          return throwError(() => error);
        }

        // Pour les autres erreurs HTTP, retourner un message d'erreur approprié
        const httpError = error as HttpErrorResponse;
        const errorMessage = httpError.error?.message ||
          httpError.error?.error?.description ||
          $localize`:@@core.invoice.ts.erreur.p.impossible.de.telecharger.le.pd.4effb8bc:Erreur ${httpError.status || 'inconnue'}:p:: Impossible de télécharger le PDF`;
        return throwError(() => new Error(errorMessage));
      })
    );
  }
}
