import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { ApiResponse } from '@core/services/client.service';
import { StudioWorkflowsService } from './studio-workflows.service';
import {
  ApprovalCountDto,
  SaveWorkflowRequest,
  WorkflowDeletionResultDto,
  WorkflowStepCatalogDto
} from './studio-workflows.models';

describe('StudioWorkflowsService', () => {
  let service: StudioWorkflowsService;
  let http: HttpTestingController;

  const base = `${environment.apiUrl}/studio`;

  const saveRequest: SaveWorkflowRequest = {
    key: 'relance_devis',
    name: 'Relance devis',
    trigger: 'on_create',
    steps: { version: 1, steps: [] },
    isActive: true
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(StudioWorkflowsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // --- Conception ---

  it('getStepCatalog interroge GET workflows/step-catalog', () => {
    service.getStepCatalog().subscribe();
    const req = http.expectOne(`${base}/workflows/step-catalog`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: { entries: [] }, message: null, errors: [] });
  });

  it('listWorkflows interroge GET entities/{id}/workflows', () => {
    service.listWorkflows('e1').subscribe();
    const req = http.expectOne(`${base}/entities/e1/workflows`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('listAllWorkflows liste tous les workflows du tenant via GET workflows?page=&pageSize= (et search= si fourni)', () => {
    service.listAllWorkflows().subscribe();
    const req = http.expectOne(r => r.method === 'GET' && r.url === `${base}/workflows`);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('200');
    expect(req.request.params.has('search')).toBeFalse();
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush({ success: true, data: { items: [], page: 1, pageSize: 200, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }, message: null, errors: [] });

    service.listAllWorkflows('devis', 2, 50).subscribe();
    const searched = http.expectOne(r => r.method === 'GET' && r.url === `${base}/workflows`);
    expect(searched.request.params.get('search')).toBe('devis');
    expect(searched.request.params.get('page')).toBe('2');
    expect(searched.request.params.get('pageSize')).toBe('50');
    searched.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('createWorkflow poste la requête sur entities/{id}/workflows', () => {
    service.createWorkflow('e1', saveRequest).subscribe();
    const req = http.expectOne(`${base}/entities/e1/workflows`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(saveRequest);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('getWorkflow interroge GET workflows/{id}', () => {
    service.getWorkflow('w1').subscribe();
    const req = http.expectOne(`${base}/workflows/w1`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('updateWorkflow envoie un PUT avec rowVersion', () => {
    const request: SaveWorkflowRequest = { ...saveRequest, rowVersion: 'AAA' };
    service.updateWorkflow('w1', request).subscribe();
    const req = http.expectOne(`${base}/workflows/w1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.rowVersion).toBe('AAA');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('deleteWorkflow envoie un DELETE et lit cancelledInstances', () => {
    let result: ApiResponse<WorkflowDeletionResultDto> | undefined;
    service.deleteWorkflow('w1').subscribe(res => (result = res));
    const req = http.expectOne(`${base}/workflows/w1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true, data: { cancelledInstances: 3 }, message: null, errors: [] });
    expect(result?.data.cancelledInstances).toBe(3);
  });

  it('toggleWorkflow poste { isActive }', () => {
    service.toggleWorkflow('w1', true).subscribe();
    const req = http.expectOne(`${base}/workflows/w1/toggle`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ isActive: true });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('testWorkflow poste { recordId } sur workflows/{id}/test (simulation pure, 4.7c2)', () => {
    service.testWorkflow('w1', 'r-9').subscribe();
    const req = http.expectOne(`${base}/workflows/w1/test`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ recordId: 'r-9' });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('validateWorkflow poste sur entities/{id}/workflows/validate', () => {
    service.validateWorkflow('e1', saveRequest).subscribe();
    const req = http.expectOne(`${base}/entities/e1/workflows/validate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(saveRequest);
    req.flush({ success: true, data: { isValid: true, errors: [], warnings: [], stepCount: 0 }, message: null, errors: [] });
  });

  // 4.7a2 / D-47-F01 — route paginée (4.7a1) : ?page=&pageSize= ⇒ enveloppe PagedResult.
  it('listInstances interroge GET workflows/{id}/instances?page=&pageSize=', () => {
    service.listInstances('w1').subscribe();
    const req = http.expectOne(`${base}/workflows/w1/instances?page=1&pageSize=20`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({
      success: true,
      data: { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false },
      message: null, errors: []
    });
  });

  it('getInstance interroge GET workflows/instances/{id}', () => {
    service.getInstance('i1').subscribe();
    const req = http.expectOne(`${base}/workflows/instances/i1`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('duplicateWorkflow poste sur workflows/{id}/duplicate', () => {
    service.duplicateWorkflow('w1').subscribe();
    const req = http.expectOne(`${base}/workflows/w1/duplicate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  // --- Runtime ---

  it('listMyApprovals interroge GET workflows/approvals/mine?max=', () => {
    service.listMyApprovals().subscribe();
    const req = http.expectOne(`${base}/workflows/approvals/mine?max=50`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('max')).toBe('50');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('countMyApprovals interroge GET workflows/approvals/mine/count', () => {
    let result: ApiResponse<ApprovalCountDto> | undefined;
    service.countMyApprovals().subscribe(res => (result = res));
    const req = http.expectOne(`${base}/workflows/approvals/mine/count`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: { count: 7 }, message: null, errors: [] });
    expect(result?.data.count).toBe(7);
  });

  it('approve poste { comment } optionnel', () => {
    service.approve('a1').subscribe();
    const req = http.expectOne(`${base}/workflows/approvals/a1/approve`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ comment: null });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('reject envoie { comment }', () => {
    service.reject('a1', 'Trop cher').subscribe();
    const req = http.expectOne(`${base}/workflows/approvals/a1/reject`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ comment: 'Trop cher' });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('listRecordInstances interroge GET records/{key}/{id}/workflow-instances', () => {
    service.listRecordInstances('interventions', 'r1').subscribe();
    const req = http.expectOne(`${base}/records/interventions/r1/workflow-instances?max=20`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('max')).toBe('20');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('getRecordInstance interroge GET records/{key}/{id}/workflow-instances/{instanceId} avec SKIP_ERROR_TOAST', () => {
    service.getRecordInstance('interventions', 'r1', 'i1').subscribe();
    const req = http.expectOne(`${base}/records/interventions/r1/workflow-instances/i1`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('listRunnableWorkflows interroge GET records/{key}/workflows', () => {
    service.listRunnableWorkflows('interventions').subscribe();
    const req = http.expectOne(`${base}/records/interventions/workflows`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('runWorkflow poste sur records/{key}/{id}/workflows/{workflowKey}/run en encodant la clé', () => {
    service.runWorkflow('interventions', 'r1', 'valider devis').subscribe();
    const req = http.expectOne(`${base}/records/interventions/r1/workflows/valider%20devis/run`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('cancelInstance poste { reason }', () => {
    service.cancelInstance('i1').subscribe();
    const req = http.expectOne(`${base}/workflows/instances/i1/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: null });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('remindApprovers poste sur workflows/instances/{id}/remind', () => {
    service.remindApprovers('i1').subscribe();
    const req = http.expectOne(`${base}/workflows/instances/i1/remind`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  // --- Cache, bornes et contexte ---

  it('getStepCatalog met la réponse en cache jusqu\'à invalidateCatalog()', () => {
    const catalog: WorkflowStepCatalogDto = { entries: [] };
    service.getStepCatalog().subscribe();
    service.getStepCatalog().subscribe();
    const req = http.expectOne(`${base}/workflows/step-catalog`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: catalog, message: null, errors: [] });

    service.invalidateCatalog();
    service.getStepCatalog().subscribe();
    const req2 = http.expectOne(`${base}/workflows/step-catalog`);
    expect(req2.request.method).toBe('GET');
    req2.flush({ success: true, data: catalog, message: null, errors: [] });
  });

  it('listInstances borne la page à 1 au moins et pageSize entre 1 et 200', () => {
    service.listInstances('w1', 0, 0).subscribe();
    const low = http.expectOne(r => r.url === `${base}/workflows/w1/instances`);
    expect(low.request.params.get('page')).toBe('1');
    expect(low.request.params.get('pageSize')).toBe('1');
    low.flush({ success: true, data: null, message: null, errors: [] });

    service.listInstances('w1', 3, 999).subscribe();
    const high = http.expectOne(r => r.url === `${base}/workflows/w1/instances`);
    expect(high.request.params.get('page')).toBe('3');
    expect(high.request.params.get('pageSize')).toBe('200');
    high.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('les sondes et les écritures gérées localement portent le contexte SKIP_ERROR_TOAST', () => {
    service.countMyApprovals().subscribe();
    const probe = http.expectOne(`${base}/workflows/approvals/mine/count`);
    expect(probe.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    probe.flush({ success: true, data: { count: 0 }, message: null, errors: [] });

    service.listRecordInstances('interventions', 'r1').subscribe();
    const recordProbe = http.expectOne(`${base}/records/interventions/r1/workflow-instances?max=20`);
    expect(recordProbe.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    recordProbe.flush({ success: true, data: [], message: null, errors: [] });

    service.createWorkflow('e1', saveRequest).subscribe();
    const write = http.expectOne(`${base}/entities/e1/workflows`);
    expect(write.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    write.flush({ success: true, data: null, message: null, errors: [] });

    service.cancelInstance('i1').subscribe();
    const cancel = http.expectOne(`${base}/workflows/instances/i1/cancel`);
    expect(cancel.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    cancel.flush({ success: true, data: null, message: null, errors: [] });

    service.getWorkflow('w1').subscribe();
    const plain = http.expectOne(`${base}/workflows/w1`);
    expect(plain.request.context.get(SKIP_ERROR_TOAST)).toBe(false);
    plain.flush({ success: true, data: null, message: null, errors: [] });
  });
});
