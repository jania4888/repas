import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse, PagedResult } from '@core/services/client.service';
import { parseFieldType } from '@shared/studio-runtime/studio-runtime.models';
import {
  CreateCustomEntityRequest,
  CreateCustomFieldRequest,
  CustomEntity,
  CustomEntitySchema,
  CustomField,
  CustomForm,
  CustomRecord,
  CustomReport,
  CustomView,
  ManyToManyRelationDto,
  ReportFieldMeta,
  ReportPreset,
  ReportResult,
  ReportSource,
  RunReportPreviewRequest,
  SaveCustomReportRequest,
  SaveCustomViewRequest,
  SaveFormLayoutRequest,
  SqlColumn,
  SqlQueryResult,
  SqlTable,
  CustomSystem,
  CustomSystemDetail,
  StudioNavNode,
  UpdateCustomEntityRequest,
  UpdateCustomFieldRequest,
  Automation,
  AutomationAction,
  AutomationRun,
  SaveAutomationRequest
} from './studio.models';
import { CreateManyToManyRelationRequest, EntityRelationDto } from './relations/studio-relations.models';

@Injectable({ providedIn: 'root' })
export class StudioService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/studio`;

  // ---- Entities ----
  listEntities(includeInactive = false): Observable<ApiResponse<CustomEntity[]>> {
    const params = new HttpParams().set('includeInactive', includeInactive);
    return this.http.get<ApiResponse<CustomEntity[]>>(`${this.base}/entities`, { params });
  }

  getEntity(id: string): Observable<ApiResponse<CustomEntity>> {
    return this.http.get<ApiResponse<CustomEntity>>(`${this.base}/entities/${id}`);
  }

  createEntity(req: CreateCustomEntityRequest): Observable<ApiResponse<CustomEntity>> {
    return this.http.post<ApiResponse<CustomEntity>>(`${this.base}/entities`, req);
  }

  updateEntity(id: string, req: UpdateCustomEntityRequest): Observable<ApiResponse<CustomEntity>> {
    return this.http.put<ApiResponse<CustomEntity>>(`${this.base}/entities/${id}`, req);
  }

  deleteEntity(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/entities/${id}`);
  }

  // ---- Fields ----
  listFields(entityId: string, includeInactive = false): Observable<ApiResponse<CustomField[]>> {
    const params = new HttpParams().set('includeInactive', includeInactive);
    return this.http.get<ApiResponse<CustomField[]>>(`${this.base}/entities/${entityId}/fields`, { params });
  }

  createField(entityId: string, req: CreateCustomFieldRequest): Observable<ApiResponse<CustomField>> {
    return this.http.post<ApiResponse<CustomField>>(`${this.base}/entities/${entityId}/fields`, req);
  }

  updateField(entityId: string, fieldId: string, req: UpdateCustomFieldRequest): Observable<ApiResponse<CustomField>> {
    return this.http.put<ApiResponse<CustomField>>(`${this.base}/entities/${entityId}/fields/${fieldId}`, req);
  }

  deleteField(entityId: string, fieldId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/entities/${entityId}/fields/${fieldId}`);
  }

  reorderFields(entityId: string, orderedFieldIds: string[]): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/entities/${entityId}/fields/reorder`, { orderedFieldIds });
  }

  // ---- Relations (PR 2.1/2.2 — plusieurs-à-plusieurs) ----

  /**
   * `GET entities/{id}/relations` — policy `StudioDesignEntities` (l'écran concepteur de table
   * l'exige déjà) ; 404 tant que `Ollama:EnableStudioManyToMany` est coupé (E5 : la fiche
   * d'enregistrement lit `schema.relations` à la place, jamais cet endpoint, pour éviter un 403).
   */
  listEntityRelations(entityId: string): Observable<ApiResponse<EntityRelationDto[]>> {
    return this.http.get<ApiResponse<EntityRelationDto[]>>(
      `${this.base}/entities/${entityId}/relations`, { context: createHttpContextSkipGlobalErrorUi() });
  }

  /** `POST entities/{id}/relations/many-to-many` : 409 si la clé de jonction est déjà prise. */
  createManyToMany(entityId: string, request: CreateManyToManyRelationRequest): Observable<ApiResponse<ManyToManyRelationDto>> {
    return this.http.post<ApiResponse<ManyToManyRelationDto>>(
      `${this.base}/entities/${entityId}/relations/many-to-many`, request, { context: createHttpContextSkipGlobalErrorUi() });
  }

  // ---- Form (default layout per entity) ----
  getForm(entityId: string): Observable<ApiResponse<CustomForm>> {
    return this.http.get<ApiResponse<CustomForm>>(`${this.base}/entities/${entityId}/form`);
  }

  saveForm(entityId: string, req: SaveFormLayoutRequest): Observable<ApiResponse<CustomForm>> {
    return this.http.put<ApiResponse<CustomForm>>(`${this.base}/entities/${entityId}/form`, req);
  }

  // ---- Records (runtime, by entity key) ----
  getSchema(entityKey: string): Observable<ApiResponse<CustomEntitySchema>> {
    // The API serializes CustomFieldType as a PascalCase string (global JsonStringEnumConverter), but the
    // runtime renderers (dynamic-form / dynamic-table) switch on the NUMERIC enum. Normalise fieldType here
    // so each field renders the right control (calendar/dropdown/relation/number…) instead of a text input.
    return this.http.get<ApiResponse<CustomEntitySchema>>(`${this.base}/records/${entityKey}/schema`).pipe(
      map(res => (res.success && res.data)
        ? { ...res, data: { ...res.data, fields: res.data.fields.map(f => ({ ...f, fieldType: parseFieldType(f.fieldType) })) } }
        : res)
    );
  }

  /**
   * `filter` (PR 2.1) ajoute un filtre exact sur un champ actif via `filterField`/`filterValue`
   * (ex. lignes de jonction du dossier courant pour l'onglet « Liés ») ; cumulatif avec `search`.
   */
  listRecords(
    entityKey: string, search: string | null, page: number, pageSize: number,
    filter?: { field: string; value: string } | null
  ): Observable<ApiResponse<PagedResult<CustomRecord>>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) {
      params = params.set('search', search);
    }
    if (filter) {
      params = params.set('filterField', filter.field).set('filterValue', filter.value);
    }
    return this.http.get<ApiResponse<PagedResult<CustomRecord>>>(`${this.base}/records/${entityKey}`, { params });
  }

  getRecord(entityKey: string, id: string): Observable<ApiResponse<CustomRecord>> {
    return this.http.get<ApiResponse<CustomRecord>>(`${this.base}/records/${entityKey}/${id}`);
  }

  createRecord(entityKey: string, data: Record<string, unknown>): Observable<ApiResponse<CustomRecord>> {
    return this.http.post<ApiResponse<CustomRecord>>(`${this.base}/records/${entityKey}`, { data });
  }

  updateRecord(entityKey: string, id: string, data: Record<string, unknown>, rowVersion?: string | null): Observable<ApiResponse<CustomRecord>> {
    return this.http.put<ApiResponse<CustomRecord>>(`${this.base}/records/${entityKey}/${id}`, { data, rowVersion });
  }

  deleteRecord(entityKey: string, id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/records/${entityKey}/${id}`);
  }

  // ---- Reports ----
  listReports(dataSourceRef?: string): Observable<ApiResponse<CustomReport[]>> {
    let params = new HttpParams();
    if (dataSourceRef) {
      params = params.set('dataSourceRef', dataSourceRef);
    }
    return this.http.get<ApiResponse<CustomReport[]>>(`${this.base}/reports`, { params });
  }

  getReportSources(): Observable<ApiResponse<ReportSource[]>> {
    return this.http.get<ApiResponse<ReportSource[]>>(`${this.base}/reports/sources`);
  }

  /** Champs d'une source. Les sources `sql` sont introspectées à la demande, pas au chargement. */
  getReportSourceFields(kind: string, dataSourceRef: string): Observable<ApiResponse<ReportFieldMeta[]>> {
    return this.http.get<ApiResponse<ReportFieldMeta[]>>(
      `${this.base}/reports/sources/${encodeURIComponent(kind)}/${encodeURIComponent(dataSourceRef)}/fields`);
  }

  getReportPresets(): Observable<ApiResponse<ReportPreset[]>> {
    return this.http.get<ApiResponse<ReportPreset[]>>(`${this.base}/reports/presets`);
  }

  getReport(id: string): Observable<ApiResponse<CustomReport>> {
    return this.http.get<ApiResponse<CustomReport>>(`${this.base}/reports/${id}`);
  }

  createReport(req: SaveCustomReportRequest): Observable<ApiResponse<CustomReport>> {
    return this.http.post<ApiResponse<CustomReport>>(`${this.base}/reports`, req);
  }

  updateReport(id: string, req: SaveCustomReportRequest): Observable<ApiResponse<CustomReport>> {
    return this.http.put<ApiResponse<CustomReport>>(`${this.base}/reports/${id}`, req);
  }

  deleteReport(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/reports/${id}`);
  }

  previewReport(req: RunReportPreviewRequest): Observable<ApiResponse<ReportResult>> {
    return this.http.post<ApiResponse<ReportResult>>(`${this.base}/reports/preview`, req);
  }

  runReport(id: string): Observable<ApiResponse<ReportResult>> {
    return this.http.get<ApiResponse<ReportResult>>(`${this.base}/reports/${id}/run`);
  }

  /** Édition PDF d'un état enregistré (même exécution que `runReport`, rendue par QuestPDF). */
  exportReportPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/reports/${id}/pdf`, { responseType: 'blob' });
  }

  // ---- SQL schema introspection (read-only) ----
  listSchemaTables(): Observable<ApiResponse<SqlTable[]>> {
    return this.http.get<ApiResponse<SqlTable[]>>(`${this.base}/schema/tables`);
  }

  listSchemaColumns(table: string): Observable<ApiResponse<SqlColumn[]>> {
    return this.http.get<ApiResponse<SqlColumn[]>>(`${this.base}/schema/tables/${encodeURIComponent(table)}/columns`);
  }

  previewSchema(req: { table: string; columns: string[]; search?: string | null; page: number; pageSize: number }): Observable<ApiResponse<SqlQueryResult>> {
    return this.http.post<ApiResponse<SqlQueryResult>>(`${this.base}/schema/preview`, req);
  }

  // ---- Read-only views ----
  listViews(): Observable<ApiResponse<CustomView[]>> {
    return this.http.get<ApiResponse<CustomView[]>>(`${this.base}/views`);
  }

  getView(id: string): Observable<ApiResponse<CustomView>> {
    return this.http.get<ApiResponse<CustomView>>(`${this.base}/views/${id}`);
  }

  createView(req: SaveCustomViewRequest): Observable<ApiResponse<CustomView>> {
    return this.http.post<ApiResponse<CustomView>>(`${this.base}/views`, req);
  }

  updateView(id: string, req: SaveCustomViewRequest): Observable<ApiResponse<CustomView>> {
    return this.http.put<ApiResponse<CustomView>>(`${this.base}/views/${id}`, req);
  }

  deleteView(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/views/${id}`);
  }

  runView(id: string, search: string | null, page: number, pageSize: number): Observable<ApiResponse<SqlQueryResult>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) {
      params = params.set('search', search);
    }
    return this.http.get<ApiResponse<SqlQueryResult>>(`${this.base}/views/${id}/run`, { params });
  }

  // ---- Nav ----
  getNav(options?: { skipGlobalErrorUi?: boolean }): Observable<ApiResponse<StudioNavNode[]>> {
    const httpOpts = options?.skipGlobalErrorUi
      ? { context: createHttpContextSkipGlobalErrorUi() }
      : {};
    return this.http.get<ApiResponse<StudioNavNode[]>>(`${this.base}/nav`, httpOpts);
  }

  // ---- Systems ----
  /** Liste des systèmes du tenant (« Mes projets »). */
  listSystems(includeInactive = false): Observable<ApiResponse<CustomSystem[]>> {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http.get<ApiResponse<CustomSystem[]>>(`${this.base}/systems`, { params });
  }

  getSystem(key: string): Observable<ApiResponse<CustomSystemDetail>> {
    return this.http.get<ApiResponse<CustomSystemDetail>>(`${this.base}/systems/${encodeURIComponent(key)}`);
  }

  // ---- ERP bridge automations ----
  listAutomationActions(): Observable<ApiResponse<AutomationAction[]>> {
    return this.http.get<ApiResponse<AutomationAction[]>>(`${this.base}/automations/actions`);
  }

  listAutomations(entityId: string): Observable<ApiResponse<Automation[]>> {
    return this.http.get<ApiResponse<Automation[]>>(`${this.base}/entities/${entityId}/automations`);
  }

  createAutomation(entityId: string, req: SaveAutomationRequest): Observable<ApiResponse<Automation>> {
    return this.http.post<ApiResponse<Automation>>(`${this.base}/entities/${entityId}/automations`, req);
  }

  updateAutomation(entityId: string, id: string, req: SaveAutomationRequest): Observable<ApiResponse<Automation>> {
    return this.http.put<ApiResponse<Automation>>(`${this.base}/entities/${entityId}/automations/${id}`, req);
  }

  deleteAutomation(id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/automations/${id}`);
  }

  runAutomation(entityKey: string, recordId: string, automationId: string): Observable<ApiResponse<AutomationRun>> {
    return this.http.post<ApiResponse<AutomationRun>>(
      `${this.base}/records/${encodeURIComponent(entityKey)}/${recordId}/automations/${automationId}/run`, {});
  }

  listRecordAutomationRuns(entityKey: string, recordId: string): Observable<ApiResponse<AutomationRun[]>> {
    return this.http.get<ApiResponse<AutomationRun[]>>(
      `${this.base}/records/${encodeURIComponent(entityKey)}/${recordId}/automation-runs`);
  }
}
