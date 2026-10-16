/// <reference types="@angular/localize" />
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { formatLocalDate } from '@core/utils/date.util';

export interface DataExportFilters {
  search?: string | null;
  type?: string | number | null;
  isActive?: boolean | null;
  governorate?: string | null;
  categoryId?: string | null;
  excludeVariantTemplates?: boolean | null;
  isVariantTemplate?: boolean | null;
  hasParentProduct?: boolean | null;
  status?: string | number | null;
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  clientId?: string | null;
  supplierId?: string | null;
  warehouseId?: string | null;
  unpaidOnly?: boolean | null;
  realizedRevenueOnly?: boolean | null;
  lowStockOnly?: boolean | null;
  outOfStockOnly?: boolean | null;
  inStockOnly?: boolean | null;
  datasets?: readonly string[] | null;
}

export class DataExportError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'DataExportError';
  }
}

@Injectable({ providedIn: 'root' })
export class DataExportService {
  private readonly http = inject(HttpClient);

  downloadDataset(dataset: string, filters: DataExportFilters): Observable<void> {
    return this.download(`${environment.apiUrl}/data-exports/${dataset}`, filters);
  }

  downloadBundle(filters: DataExportFilters): Observable<void> {
    return this.download(`${environment.apiUrl}/data-exports/bundle`, filters);
  }

  private download(url: string, filters: DataExportFilters): Observable<void> {
    return this.http.get(url, {
      params: toParams(filters),
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      switchMap(response => ensureWorkbook(response)),
      tap(file => downloadBlob(file.blob, file.name)),
      map(() => undefined),
      catchError((err: unknown) => from(readExportError(err)).pipe(
        switchMap(error => throwError(() => error))
      ))
    );
  }
}

function toParams(filters: DataExportFilters): HttpParams {
  let params = new HttpParams();
  params = setText(params, 'search', filters.search);
  params = setText(params, 'type', filters.type);
  params = setText(params, 'governorate', filters.governorate);
  params = setText(params, 'categoryId', filters.categoryId);
  params = setText(params, 'status', filters.status);
  params = setText(params, 'clientId', filters.clientId);
  params = setText(params, 'supplierId', filters.supplierId);
  params = setText(params, 'warehouseId', filters.warehouseId);
  params = setDate(params, 'fromDate', filters.fromDate);
  params = setDate(params, 'toDate', filters.toDate);
  params = setBool(params, 'isActive', filters.isActive, true);
  params = setBool(params, 'isVariantTemplate', filters.isVariantTemplate, true);
  params = setBool(params, 'hasParentProduct', filters.hasParentProduct, true);
  params = setBool(params, 'excludeVariantTemplates', filters.excludeVariantTemplates, false);
  params = setBool(params, 'unpaidOnly', filters.unpaidOnly, false);
  params = setBool(params, 'realizedRevenueOnly', filters.realizedRevenueOnly, false);
  params = setBool(params, 'lowStockOnly', filters.lowStockOnly, false);
  params = setBool(params, 'outOfStockOnly', filters.outOfStockOnly, false);
  params = setBool(params, 'inStockOnly', filters.inStockOnly, false);
  if (filters.datasets && filters.datasets.length > 0) {
    params = params.set('datasets', filters.datasets.join(','));
  }
  return params;
}

function setText(params: HttpParams, key: string, value: string | number | null | undefined): HttpParams {
  if (value === null || value === undefined || value === '') {
    return params;
  }
  return params.set(key, String(value));
}

function setDate(params: HttpParams, key: string, value: Date | string | null | undefined): HttpParams {
  if (value === null || value === undefined || value === '') {
    return params;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return params;
    }
    return params.set(key, formatLocalDate(value));
  }
  return params.set(key, value);
}

function setBool(params: HttpParams, key: string, value: boolean | null | undefined, sendFalse: boolean): HttpParams {
  if (value === true || (sendFalse && value === false)) {
    return params.set(key, value ? 'true' : 'false');
  }
  return params;
}

function ensureWorkbook(response: HttpResponse<Blob>): Observable<{ blob: Blob; name: string }> {
  const body = response.body;
  const contentType = response.headers.get('content-type') || body?.type || '';
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    return from((body ?? new Blob()).text()).pipe(
      switchMap(text => throwError(() => errorFromText(text, response.status)))
    );
  }
  if (!body || body.size === 0) {
    return throwError(() => new DataExportError(fallbackMessage()));
  }
  return of({ blob: body, name: fileNameFrom(response) });
}

function fileNameFrom(response: HttpResponse<Blob>): string {
  const header = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return sanitizeFileName(decodeURIComponent(encoded[1]));
    } catch {
      return sanitizeFileName(encoded[1]);
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  if (plain?.[1]) {
    return sanitizeFileName(plain[1]);
  }
  return 'export.xlsx';
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned.toLowerCase().endsWith('.xlsx') ? cleaned : 'export.xlsx';
}

async function readExportError(err: unknown): Promise<DataExportError> {
  if (err instanceof DataExportError) {
    return err;
  }
  if (err instanceof HttpErrorResponse) {
    if (err.status === 429) {
      return new DataExportError(rateLimitMessage(), undefined, 429);
    }
    const body = err.error;
    if (body instanceof Blob) {
      return errorFromText(await body.text(), err.status);
    }
    if (typeof body === 'string') {
      return errorFromText(body, err.status);
    }
  }
  return new DataExportError(fallbackMessage());
}

function errorFromText(text: string, status?: number): DataExportError {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string; errors?: string[]; code?: string };
    const message = parsed.errors?.[0] ?? parsed.message ?? parsed.error ?? fallbackMessage();
    return new DataExportError(message, parsed.code, status);
  } catch {
    return new DataExportError(fallbackMessage(), undefined, status);
  }
}

function fallbackMessage(): string {
  return $localize`:@@dataExport.error.generic:L'export n'a pas pu être téléchargé.`;
}

function rateLimitMessage(): string {
  return $localize`:@@dataExport.error.rateLimit:Trop d'exports. Réessayez dans une minute.`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
