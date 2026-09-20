import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse, PagedResult } from '@core/services/client.service';
import { clampMax } from './studio-workflow-http.util';
import {
  ApprovalCountDto,
  ApprovalDecisionRequest,
  RunnableWorkflowDto,
  SaveWorkflowRequest,
  WorkflowApprovalInboxItemDto,
  WorkflowCancelRequest,
  WorkflowDefinitionDto,
  WorkflowDefinitionListItemDto,
  WorkflowDeletionResultDto,
  WorkflowInstanceDetailDto,
  WorkflowInstanceDto,
  WorkflowStepCatalogDto,
  WorkflowTestResultDto,
  WorkflowToggleRequest,
  WorkflowValidationResultDto
} from './studio-workflows.models';

/**
 * Accès HTTP aux routes des workflows Studio (4.4a2 → 4.7) : 24 méthodes HTTP,
 * 13 de conception (`StudioWorkflowsController.cs`, policy `studio:design_entities` ;
 * dont `test` et `instances`, 4.7) et 11 runtime (`StudioWorkflowRuntimeController.cs`,
 * `custom_records:read` / `:write` ; dont `approvals/history`, 4.7h). Compte mis à jour au lot ★ (D-47-76).
 * Le catalogue d'étapes est mis en cache (`shareReplay`) jusqu'à `invalidateCatalog()`.
 * Les sondes et les écritures dont l'appelant gère lui-même le 400/404/409 passent
 * `createHttpContextSkipGlobalErrorUi()` (D-44-03) : pas de toast « Erreur » de
 * l'intercepteur en doublon. Le message serveur se lit via `workflowErrorMessage`
 * (enveloppe `error` singulier, D-44-02).
 */
@Injectable({ providedIn: 'root' })
export class StudioWorkflowsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/studio`;
  /** Sondes et écritures dont l'appelant gère 400/404/409 lui-même (D-44-03). */
  private readonly skipErrorUi = { context: createHttpContextSkipGlobalErrorUi() };
  private catalog$: Observable<ApiResponse<WorkflowStepCatalogDto>> | null = null;

  // --- Conception (policy studio:design_entities) ---

  getStepCatalog(): Observable<ApiResponse<WorkflowStepCatalogDto>> {
    return (this.catalog$ ??= this.http
      .get<ApiResponse<WorkflowStepCatalogDto>>(`${this.base}/workflows/step-catalog`)
      .pipe(shareReplay({ bufferSize: 1, refCount: false })));
  }

  invalidateCatalog(): void {
    this.catalog$ = null;
  }

  listWorkflows(entityId: string): Observable<ApiResponse<WorkflowDefinitionDto[]>> {
    return this.http.get<ApiResponse<WorkflowDefinitionDto[]>>(`${this.base}/entities/${entityId}/workflows`);
  }

  /**
   * 4.5c3 / D-44-20 — tous les workflows du tenant (concepteurs, `studio:design_entities`), paginés ;
   * `pageSize` borné 1..200 côté API. Erreur gérée localement par le hub (toast + liste vide) ⇒ `skipErrorUi`.
   */
  listAllWorkflows(search: string | null = null, page = 1, pageSize = 200): Observable<ApiResponse<PagedResult<WorkflowDefinitionListItemDto>>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    return this.http.get<ApiResponse<PagedResult<WorkflowDefinitionListItemDto>>>(`${this.base}/workflows`, { params, ...this.skipErrorUi });
  }

  /** 201 (`CreatedAtAction`) ; 400 validation / quota. */
  createWorkflow(entityId: string, request: SaveWorkflowRequest): Observable<ApiResponse<WorkflowDefinitionDto>> {
    return this.http.post<ApiResponse<WorkflowDefinitionDto>>(`${this.base}/entities/${entityId}/workflows`, request, this.skipErrorUi);
  }

  getWorkflow(id: string): Observable<ApiResponse<WorkflowDefinitionDto>> {
    return this.http.get<ApiResponse<WorkflowDefinitionDto>>(`${this.base}/workflows/${id}`);
  }

  /** 409 RowVersion périmée. */
  updateWorkflow(id: string, request: SaveWorkflowRequest): Observable<ApiResponse<WorkflowDefinitionDto>> {
    return this.http.put<ApiResponse<WorkflowDefinitionDto>>(`${this.base}/workflows/${id}`, request, this.skipErrorUi);
  }

  /** 200 `{ cancelledInstances }`. */
  deleteWorkflow(id: string): Observable<ApiResponse<WorkflowDeletionResultDto>> {
    return this.http.delete<ApiResponse<WorkflowDeletionResultDto>>(`${this.base}/workflows/${id}`, this.skipErrorUi);
  }

  toggleWorkflow(id: string, isActive: boolean): Observable<ApiResponse<WorkflowDefinitionDto>> {
    return this.http.post<ApiResponse<WorkflowDefinitionDto>>(`${this.base}/workflows/${id}/toggle`, { isActive } satisfies WorkflowToggleRequest, this.skipErrorUi);
  }

  /**
   * 4.7c2 — simulation pure du premier segment (route 4.7c1, R17) : aucune écriture serveur.
   * `skipErrorUi` : l'erreur est affichée inline dans le dialogue « Tester » du concepteur.
   */
  testWorkflow(id: string, recordId: string): Observable<ApiResponse<WorkflowTestResultDto>> {
    return this.http.post<ApiResponse<WorkflowTestResultDto>>(`${this.base}/workflows/${id}/test`, { recordId }, this.skipErrorUi);
  }

  /** 200 même quand le workflow est invalide (erreurs localisées dans `errors[]/warnings[]`) — PAS de contexte skip (D-44-02). */
  validateWorkflow(entityId: string, request: SaveWorkflowRequest): Observable<ApiResponse<WorkflowValidationResultDto>> {
    return this.http.post<ApiResponse<WorkflowValidationResultDto>>(`${this.base}/entities/${entityId}/workflows/validate`, request);
  }

  /**
   * 4.7a2 / D-47-F01 — instances d'un workflow paginées (route 4.7a1 : `?page=&pageSize=`,
   * enveloppe `PagedResult`, `pageSize` borné 1..200 côté API). GET de conception sans
   * `skipErrorUi` : l'intercepteur global affiche le toast, le panneau son état d'erreur.
   */
  listInstances(id: string, page = 1, pageSize = 20): Observable<ApiResponse<PagedResult<WorkflowInstanceDto>>> {
    const params = new HttpParams()
      .set('page', Math.max(1, Math.trunc(page) || 1))
      .set('pageSize', clampMax(pageSize, 200));
    return this.http.get<ApiResponse<PagedResult<WorkflowInstanceDto>>>(`${this.base}/workflows/${id}/instances`, { params });
  }

  getInstance(instanceId: string): Observable<ApiResponse<WorkflowInstanceDetailDto>> {
    return this.http.get<ApiResponse<WorkflowInstanceDetailDto>>(`${this.base}/workflows/instances/${instanceId}`);
  }

  /** 201 ; 400 quota de copies ; 409 clé dupliquée. */
  duplicateWorkflow(id: string): Observable<ApiResponse<WorkflowDefinitionDto>> {
    return this.http.post<ApiResponse<WorkflowDefinitionDto>>(`${this.base}/workflows/${id}/duplicate`, {}, this.skipErrorUi);
  }

  // --- Runtime (custom_records:read / custom_records:write) ---

  listMyApprovals(max = 50): Observable<ApiResponse<WorkflowApprovalInboxItemDto[]>> {
    return this.http.get<ApiResponse<WorkflowApprovalInboxItemDto[]>>(`${this.base}/workflows/approvals/mine`, { params: new HttpParams().set('max', clampMax(max)), ...this.skipErrorUi });
  }

  /** 4.7 « v1.1 » (D-47-60) : mes décisions passées (approuvées/refusées), même forme que l'inbox. */
  listMyApprovalHistory(max = 50): Observable<ApiResponse<WorkflowApprovalInboxItemDto[]>> {
    return this.http.get<ApiResponse<WorkflowApprovalInboxItemDto[]>>(`${this.base}/workflows/approvals/mine/history`, { params: new HttpParams().set('max', clampMax(max)), ...this.skipErrorUi });
  }

  /** Sonde fail-closed du badge d'approbations. */
  countMyApprovals(): Observable<ApiResponse<ApprovalCountDto>> {
    return this.http.get<ApiResponse<ApprovalCountDto>>(`${this.base}/workflows/approvals/mine/count`, this.skipErrorUi);
  }

  approve(approvalId: string, comment?: string | null): Observable<ApiResponse<WorkflowInstanceDto>> {
    return this.http.post<ApiResponse<WorkflowInstanceDto>>(`${this.base}/workflows/approvals/${approvalId}/approve`, { comment: comment ?? null } satisfies ApprovalDecisionRequest, this.skipErrorUi);
  }

  reject(approvalId: string, comment: string): Observable<ApiResponse<WorkflowInstanceDto>> {
    return this.http.post<ApiResponse<WorkflowInstanceDto>>(`${this.base}/workflows/approvals/${approvalId}/reject`, { comment } satisfies ApprovalDecisionRequest, this.skipErrorUi);
  }

  /** Sonde de l'onglet « Workflows » de la fiche enregistrement (4.4h2). */
  listRecordInstances(entityKey: string, recordId: string, max = 20): Observable<ApiResponse<WorkflowInstanceDto[]>> {
    return this.http.get<ApiResponse<WorkflowInstanceDto[]>>(`${this.base}/records/${encodeURIComponent(entityKey)}/${recordId}/workflow-instances`, { params: new HttpParams().set('max', clampMax(max)), ...this.skipErrorUi });
  }

  /**
   * Détail d'une instance en portée fiche (4.5b / 4.5d2) : policy `custom_records:read` ;
   * le backend répond 404 si l'instance n'appartient pas au couple (table, enregistrement).
   * Sonde gérée localement par le drawer (message inline) ⇒ `skipErrorUi`.
   */
  getRecordInstance(entityKey: string, recordId: string, instanceId: string): Observable<ApiResponse<WorkflowInstanceDetailDto>> {
    return this.http.get<ApiResponse<WorkflowInstanceDetailDto>>(`${this.base}/records/${encodeURIComponent(entityKey)}/${recordId}/workflow-instances/${instanceId}`, this.skipErrorUi);
  }

  listRunnableWorkflows(entityKey: string): Observable<ApiResponse<RunnableWorkflowDto[]>> {
    return this.http.get<ApiResponse<RunnableWorkflowDto[]>>(`${this.base}/records/${encodeURIComponent(entityKey)}/workflows`);
  }

  /** Adresse le workflow PAR CLÉ ; 201 ; 400 quota d'instances (200 max/enregistrement). */
  runWorkflow(entityKey: string, recordId: string, workflowKey: string): Observable<ApiResponse<WorkflowInstanceDto>> {
    return this.http.post<ApiResponse<WorkflowInstanceDto>>(`${this.base}/records/${encodeURIComponent(entityKey)}/${recordId}/workflows/${encodeURIComponent(workflowKey)}/run`, {}, this.skipErrorUi);
  }

  /** 409 si l'instance est déjà terminée. */
  cancelInstance(instanceId: string, reason?: string | null): Observable<ApiResponse<WorkflowInstanceDto>> {
    return this.http.post<ApiResponse<WorkflowInstanceDto>>(`${this.base}/workflows/instances/${instanceId}/cancel`, { reason: reason?.trim() || null } satisfies WorkflowCancelRequest, this.skipErrorUi);
  }

  /** 409 « rappel < 24 h ». */
  remindApprovers(instanceId: string): Observable<ApiResponse<WorkflowInstanceDto>> {
    return this.http.post<ApiResponse<WorkflowInstanceDto>>(`${this.base}/workflows/instances/${instanceId}/remind`, {}, this.skipErrorUi);
  }
}
