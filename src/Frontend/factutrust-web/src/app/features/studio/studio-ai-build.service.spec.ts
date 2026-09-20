import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { StudioAiBuildService, StudioAiPlanDto } from './studio-ai-build.service';
import { ImportCustomSystemRequest, StudioAiPlanPreviewDto, StudioSystemExportDto } from './ai/studio-ai.models';
import { studioAiPlanPreviewFixture, studioSystemExportFixture } from './ai/preview/testing/studio-ai-spec.fixture';

describe('StudioAiBuildService', () => {
  let service: StudioAiBuildService;
  let http: HttpTestingController;

  const plan: StudioAiPlanDto = {
    id: 'p-1',
    kind: 'CreateSystem',
    status: 'Pending',
    summaryJson: '{"title":"Congés","steps":[],"entities":[],"warnings":[]}',
    createdAt: '2026-07-28T10:00:00Z',
    expiresAt: '2026-07-28T11:00:00Z'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(StudioAiBuildService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads a plan by id', () => {
    let received: StudioAiPlanDto | undefined;
    service.getPlan('p-1').subscribe(r => (received = r.data ?? undefined));

    const req = http.expectOne(`${environment.apiUrl}/studio/ai/plans/p-1`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: plan, message: null, errors: [] });

    expect(received?.status).toBe('Pending');
  });

  it('cancels a plan without executing it', () => {
    let cancelled: StudioAiPlanDto | undefined;
    service.cancel('p-1').subscribe(r => (cancelled = r.data ?? undefined));

    const req = http.expectOne(`${environment.apiUrl}/studio/ai/plans/p-1/cancel`);
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, data: { ...plan, status: 'Cancelled' }, message: null, errors: [] });

    expect(cancelled?.status).toBe('Cancelled');
  });

  it('confirms over a streaming response, emitting progress then result', async () => {
    // La confirmation utilise fetch (streaming SSE), hors pipeline HttpClient : on simule le corps.
    const body = [
      'data: {"type":"studio_progress","content":"{\\"phase\\":\\"creating_system\\",\\"label\\":\\"Création\\",\\"status\\":\\"running\\"}"}\n\n',
      'data: {"type":"studio_result","content":"{\\"id\\":\\"p-1\\"}"}\n\n',
      'data: {"type":"done"}\n\n'
    ].join('');

    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    );

    const types: string[] = [];
    await new Promise<void>((resolve, reject) => {
      service.confirm('p-1').subscribe({
        next: ev => types.push(ev.type),
        error: reject,
        complete: resolve
      });
    });

    expect(types).toEqual(['studio_progress', 'studio_result', 'done']);
  });

  it('surfaces a French message when the plan is already handled', async () => {
    spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response('', { status: 409, statusText: 'Conflict' }))
    );

    const message = await new Promise<string>(resolve => {
      service.confirm('p-1').subscribe({ error: (e: Error) => resolve(e.message) });
    });

    expect(message).toContain('déjà été traité');
  });
});

/**
 * Endpoints du workbench P0 (aperçu, édition, modèles). Ils suppriment tous le toast global
 * (`SKIP_ERROR_TOAST`) : l'atelier affiche les erreurs en place.
 */
describe('StudioAiBuildService (workbench P0)', () => {
  let service: StudioAiBuildService;
  let http: HttpTestingController;

  const plansUrl = `${environment.apiUrl}/studio/ai/plans`;
  const templatesUrl = `${environment.apiUrl}/studio/templates`;
  const systemsUrl = `${environment.apiUrl}/studio/systems`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(StudioAiBuildService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the capabilities and skips the global error toast', () => {
    service.getCapabilities().subscribe();

    const req = http.expectOne(`${environment.apiUrl}/ai/studio/capabilities`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('lists plans with default paging', () => {
    service.listPlans().subscribe();

    const req = http.expectOne(r => r.url === plansUrl);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.has('status')).toBeFalse();
    expect(req.request.params.has('kind')).toBeFalse();
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('forwards status / kind filters and clamps pageSize to 50', () => {
    service.listPlans({ status: 'Pending', kind: 'CreateSystem', page: 3, pageSize: 500 }).subscribe();

    const req = http.expectOne(r => r.url === plansUrl);
    expect(req.request.params.get('status')).toBe('Pending');
    expect(req.request.params.get('kind')).toBe('CreateSystem');
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('reads a plan spec', () => {
    service.getPlanSpec('p-9').subscribe();

    const req = http.expectOne(`${plansUrl}/p-9/spec`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('updates a plan spec with its rowVersion', () => {
    service.updatePlanSpec('p-9', '{"entities":[]}', 'rv-1').subscribe();

    const req = http.expectOne(`${plansUrl}/p-9/spec`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ specJson: '{"entities":[]}', rowVersion: 'rv-1' });
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('validates a spec without creating anything', () => {
    service.validate('CreateSystem', '{"entities":[]}').subscribe();

    const req = http.expectOne(`${plansUrl}/validate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'CreateSystem', specJson: '{"entities":[]}' });
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: { valid: true, warnings: [] }, message: null, errors: [] });
  });

  it('creates a plan from a template (null override when empty)', () => {
    service.createFromTemplate('gestion-conges').subscribe();

    const req = http.expectOne(`${plansUrl}/from-template`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ templateKey: 'gestion-conges', displayNameOverride: null });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('creates a plan from a template with a display name override', () => {
    service.createFromTemplate('gestion-conges', 'Congés 2026').subscribe();

    const req = http.expectOne(`${plansUrl}/from-template`);
    expect(req.request.body).toEqual({ templateKey: 'gestion-conges', displayNameOverride: 'Congés 2026' });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('creates a plan from a raw spec', () => {
    service.createFromSpec('CreateApp', '{"entity":{}}').subscribe();

    const req = http.expectOne(`${plansUrl}/from-spec`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'CreateApp', specJson: '{"entity":{}}' });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('cancels all pending plans', () => {
    let cancelled: number | undefined;
    service.cancelPending().subscribe(r => (cancelled = r.data ?? undefined));

    const req = http.expectOne(`${plansUrl}/cancel-pending`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ success: true, data: 2, message: null, errors: [] });

    expect(cancelled).toBe(2);
  });

  it('lists the built-in templates', () => {
    service.listTemplates().subscribe();

    const req = http.expectOne(templatesUrl);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('reads one template and encodes its key', () => {
    service.getTemplate('gestion conges/2').subscribe();

    const req = http.expectOne(`${templatesUrl}/gestion%20conges%2F2`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  // ---- Aperçu enrichi (PR 3.4a) ----

  it('getPlanPreview appelle GET plans/{id}/preview', () => {
    let received: StudioAiPlanPreviewDto | undefined;
    service.getPlanPreview('p-9').subscribe(r => (received = r.data ?? undefined));

    const req = http.expectOne(`${plansUrl}/p-9/preview`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: studioAiPlanPreviewFixture(), message: null, errors: [] });

    expect(received?.entities.length).toBe(2);
    expect(received?.relations[0].junctionName).toBe('employes_demandes');
  });

  it('replayPlan appelle POST plans/{id}/replay', () => {
    service.replayPlan('p-9').subscribe();

    const req = http.expectOne(`${plansUrl}/p-9/replay`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('exportSystem encode la clé et passe includeSeed', () => {
    let received: StudioSystemExportDto | undefined;
    service.exportSystem('gestion des/conges', true).subscribe(r => (received = r.data ?? undefined));

    const req = http.expectOne(r => r.url === `${systemsUrl}/gestion%20des%2Fconges/export`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('includeSeed')).toBe('true');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: studioSystemExportFixture(), message: null, errors: [] });
    expect(received?.viewCount).toBe(2);

    service.exportSystem('conges').subscribe();
    const noSeed = http.expectOne(r => r.url === `${systemsUrl}/conges/export`);
    expect(noSeed.request.params.get('includeSeed')).toBe('false');
    noSeed.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('duplicateSystem et importSystem postent sur systems', () => {
    service.duplicateSystem('conges', 'Congés 2027').subscribe();
    const dup = http.expectOne(`${systemsUrl}/conges/duplicate`);
    expect(dup.request.method).toBe('POST');
    expect(dup.request.body).toEqual({ displayName: 'Congés 2027' });
    dup.flush({ success: true, data: null, message: null, errors: [] });

    service.duplicateSystem('conges').subscribe();
    const dupDefault = http.expectOne(`${systemsUrl}/conges/duplicate`);
    expect(dupDefault.request.body).toEqual({ displayName: null });
    dupDefault.flush({ success: true, data: null, message: null, errors: [] });

    const importReq: ImportCustomSystemRequest = { spec: studioSystemExportFixture().spec, displayNameOverride: 'Copie', includeSeed: false };
    service.importSystem(importReq).subscribe();
    const imp = http.expectOne(`${systemsUrl}/import`);
    expect(imp.request.method).toBe('POST');
    expect(imp.request.body).toEqual(importReq);
    expect(imp.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    imp.flush({ success: true, data: null, message: null, errors: [] });
  });
});
