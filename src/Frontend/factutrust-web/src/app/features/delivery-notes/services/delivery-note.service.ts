import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { Observable, throwError, of, from } from 'rxjs';
import { shareReplay, catchError, switchMap } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ApiResponse } from '../../../core/services/auth.service';
import {
    DeliveryNoteListDto,
    DeliveryNoteDetailDto,
    CreateDeliveryNoteDto,
    RecordDeliveryDto,
    DeliveryNoteStatus,
    CancelDeliveryNoteRequest,
    GenerateInvoiceFromDeliveryNoteDto
} from '../models/delivery-note.model';

export interface PagedResult<T> {
    items: T[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
}

export interface DeliveryNoteSearchParams {
    search?: string;
    status?: DeliveryNoteStatus;
    fromDate?: string;
    toDate?: string;
    clientId?: string;
    page?: number;
    pageSize?: number;
    /** When true, global 403 modal / toast is suppressed (e.g. dashboard aggregate). */
    skipGlobalErrorUi?: boolean;
}

/** Totaux agrégés (backend) de la liste des bons de livraison, sur l'ensemble filtré complet. */
export interface DeliveryNoteListSummary {
    count: number;
    totalTtc: number;
    totalHt: number;
    totalVat: number;
    deliveredCount: number;
    invoicedCount: number;
    currency: string;
}

@Injectable({
    providedIn: 'root'
})
export class DeliveryNoteService {
    private readonly API_URL = `${environment.apiUrl}/deliverynotes`;

    constructor(private http: HttpClient) { }

    private getDeliveryNotesCache = new Map<string, Observable<ApiResponse<PagedResult<DeliveryNoteListDto>>>>();

    /** Liste paginée ; pas de retry automatique sur 429. */
    getDeliveryNotes(params: DeliveryNoteSearchParams = {}): Observable<ApiResponse<PagedResult<DeliveryNoteListDto>>> {
        const skipGlobalErrorUi = params.skipGlobalErrorUi === true;
        let httpParams = new HttpParams();

        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.status !== undefined) httpParams = httpParams.set('status', params.status.toString());
        if (params.fromDate) httpParams = httpParams.set('fromDate', params.fromDate);
        if (params.toDate) httpParams = httpParams.set('toDate', params.toDate);
        if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);
        if (params.page) httpParams = httpParams.set('page', params.page.toString());
        if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());

        const cacheKey = `${httpParams.toString()}|skipUi:${skipGlobalErrorUi ? '1' : '0'}`;

        if (this.getDeliveryNotesCache.has(cacheKey)) {
            return this.getDeliveryNotesCache.get(cacheKey)!;
        }

        const requestOptions: {
            params: HttpParams;
            context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi>;
        } = { params: httpParams };
        if (skipGlobalErrorUi) {
            requestOptions.context = createHttpContextSkipGlobalErrorUi();
        }

        const request$ = this.http.get<ApiResponse<PagedResult<DeliveryNoteListDto>>>(this.API_URL, requestOptions)
            .pipe(
                shareReplay(1),
                catchError((error) => {
                    this.getDeliveryNotesCache.delete(cacheKey);
                    return throwError(() => error);
                })
            );

        this.getDeliveryNotesCache.set(cacheKey, request$);

        request$.subscribe({
            next: () => {
                setTimeout(() => {
                    this.getDeliveryNotesCache.delete(cacheKey);
                }, 100);
            },
            error: () => { }
        });

        return request$;
    }

    /** Totaux agrégés respectant les mêmes filtres que {@link getDeliveryNotes} (calcul backend). */
    getDeliveryNotesSummary(params: DeliveryNoteSearchParams = {}): Observable<ApiResponse<DeliveryNoteListSummary>> {
        let httpParams = new HttpParams();
        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.status !== undefined) httpParams = httpParams.set('status', params.status.toString());
        if (params.fromDate) httpParams = httpParams.set('fromDate', params.fromDate);
        if (params.toDate) httpParams = httpParams.set('toDate', params.toDate);
        if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);

        const requestOptions: {
            params: HttpParams;
            context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi>;
        } = { params: httpParams };
        if (params.skipGlobalErrorUi === true) {
            requestOptions.context = createHttpContextSkipGlobalErrorUi();
        }

        return this.http.get<ApiResponse<DeliveryNoteListSummary>>(`${this.API_URL}/summary`, requestOptions);
    }

    /**
     * Récupère le détail d'un bon de livraison par son ID.
     */
    getDeliveryNote(id: string): Observable<ApiResponse<DeliveryNoteDetailDto>> {
        return this.http.get<ApiResponse<DeliveryNoteDetailDto>>(`${this.API_URL}/${id}`);
    }

    /**
     * Crée un nouveau bon de livraison.
     */
    createDeliveryNote(dto: CreateDeliveryNoteDto): Observable<ApiResponse<string>> {
        return this.http.post<ApiResponse<string>>(this.API_URL, dto);
    }

    /**
     * Confirme un bon de livraison.
     */
    confirmDeliveryNote(id: string): Observable<ApiResponse<object>> {
        return this.http.post<ApiResponse<object>>(`${this.API_URL}/${id}/confirm`, {}, {
            context: createHttpContextSkipGlobalErrorUi()
        });
    }

    /**
     * Démarre la livraison (transition Confirmé → En cours).
     */
    startDelivery(id: string): Observable<ApiResponse<object>> {
        return this.http.post<ApiResponse<object>>(`${this.API_URL}/${id}/start-delivery`, {});
    }

    /**
     * Enregistre la livraison d'un bon.
     */
    recordDelivery(id: string, dto: RecordDeliveryDto): Observable<ApiResponse<object>> {
        return this.http.post<ApiResponse<object>>(`${this.API_URL}/${id}/deliver`, dto);
    }

    /**
     * Annule un bon de livraison.
     */
    cancelDeliveryNote(id: string, request: CancelDeliveryNoteRequest): Observable<ApiResponse<object>> {
        return this.http.post<ApiResponse<object>>(`${this.API_URL}/${id}/cancel`, request);
    }

    /**
     * Récupère les bons de livraison non facturés pour un client.
     */
    getUninvoicedByClient(clientId: string): Observable<ApiResponse<DeliveryNoteListDto[]>> {
        return this.http.get<ApiResponse<DeliveryNoteListDto[]>>(`${this.API_URL}/uninvoiced/${clientId}`);
    }

    /**
     * Génère une facture à partir d'un bon de livraison.
     */
    generateInvoice(id: string, dto?: GenerateInvoiceFromDeliveryNoteDto): Observable<ApiResponse<string>> {
        return this.http.post<ApiResponse<string>>(`${this.API_URL}/${id}/generate-invoice`, dto ?? {});
    }

    /**
     * Télécharge le rapport PDF des bons de livraison pour une période et un client optionnel.
     */
    downloadReportPdf(fromDate?: string, toDate?: string, clientId?: string): Observable<Blob> {
        let httpParams = new HttpParams();
        if (fromDate) httpParams = httpParams.set('fromDate', fromDate);
        if (toDate) httpParams = httpParams.set('toDate', toDate);
        if (clientId) httpParams = httpParams.set('clientId', clientId);

        return this.http.get(`${this.API_URL}/report/pdf`, {
            params: httpParams,
            responseType: 'blob',
            observe: 'response'
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
                                    $localize`:@@delivery-notes.delivery-note.ts.impossible.de.generer.le.rapport.pdf.e2243d7a:Impossible de générer le rapport PDF`;
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
                                    $localize`:@@delivery-notes.delivery-note.ts.erreur.status.impossible.de.generer.le.r.b2e87c10:Erreur ${error.status}:status:: Impossible de générer le rapport PDF`;
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
                    $localize`:@@delivery-notes.delivery-note.ts.erreur.p.impossible.de.generer.le.rappor.edfa5a5c:Erreur ${httpError.status || 'inconnue'}:p:: Impossible de générer le rapport PDF`;
                return throwError(() => new Error(errorMessage));
            })
        );
    }
}
