import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse } from '@core/services/client.service';
import { CustomRecord } from '../studio.models';
import { CustomRecordViewDto, RecordViewRunRequest, RecordViewRunResultDto, SaveCustomRecordViewRequest } from './studio-record-views.models';

/**
 * CRUD des vues enregistrées d'une table Studio + exécution serveur + PATCH partiel d'un
 * enregistrement (`StudioRecordViewsController.cs`, `StudioRecordsController.Patch`). Miroir des 8
 * méthodes du plan ; `DELETE`/`POST …/default` renvoient 204 sans corps (V1/E1) : `Observable<void>`.
 * Toute écriture passe par `createHttpContextSkipGlobalErrorUi()` (V6/E6) : l'appelant gère lui-même
 * les toasts de 409/400/404 (clé prise, quota, vue périmée, jonction inactive…).
 */
@Injectable({ providedIn: 'root' })
export class StudioRecordViewsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/studio/records`;
  private readonly skipErrorUi = { context: createHttpContextSkipGlobalErrorUi() };

  private viewsBase(entityKey: string): string {
    return `${this.base}/${entityKey}/views`;
  }

  listRecordViews(entityKey: string): Observable<ApiResponse<CustomRecordViewDto[]>> {
    return this.http.get<ApiResponse<CustomRecordViewDto[]>>(this.viewsBase(entityKey));
  }

  getRecordView(entityKey: string, viewId: string): Observable<ApiResponse<CustomRecordViewDto>> {
    return this.http.get<ApiResponse<CustomRecordViewDto>>(`${this.viewsBase(entityKey)}/${viewId}`);
  }

  createRecordView(entityKey: string, request: SaveCustomRecordViewRequest): Observable<ApiResponse<CustomRecordViewDto>> {
    return this.http.post<ApiResponse<CustomRecordViewDto>>(this.viewsBase(entityKey), request, this.skipErrorUi);
  }

  updateRecordView(entityKey: string, viewId: string, request: SaveCustomRecordViewRequest): Observable<ApiResponse<CustomRecordViewDto>> {
    return this.http.put<ApiResponse<CustomRecordViewDto>>(`${this.viewsBase(entityKey)}/${viewId}`, request, this.skipErrorUi);
  }

  deleteRecordView(entityKey: string, viewId: string): Observable<void> {
    return this.http.delete<void>(`${this.viewsBase(entityKey)}/${viewId}`, this.skipErrorUi);
  }

  setDefaultRecordView(entityKey: string, viewId: string): Observable<void> {
    return this.http.post<void>(`${this.viewsBase(entityKey)}/${viewId}/default`, {}, this.skipErrorUi);
  }

  runRecordView(entityKey: string, viewId: string, request: RecordViewRunRequest): Observable<ApiResponse<RecordViewRunResultDto>> {
    return this.http.post<ApiResponse<RecordViewRunResultDto>>(
      `${this.viewsBase(entityKey)}/${viewId}/run`, request, this.skipErrorUi);
  }

  /** PATCH partiel (R5) : fusion des seules clés fournies ; `rowVersion` obligatoire (409 si périmé). */
  patchRecord(entityKey: string, recordId: string, data: Record<string, unknown>, rowVersion: string): Observable<ApiResponse<CustomRecord>> {
    return this.http.patch<ApiResponse<CustomRecord>>(
      `${this.base}/${entityKey}/${recordId}`, { data, rowVersion }, this.skipErrorUi);
  }
}
