import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { StudioRecordViewsService } from './studio-record-views.service';
import { RecordViewDefinition, RecordViewRunRequest, SaveCustomRecordViewRequest } from './studio-record-views.models';

describe('StudioRecordViewsService', () => {
  let service: StudioRecordViewsService;
  let http: HttpTestingController;

  const base = `${environment.apiUrl}/studio/records/interventions`;

  const definition: RecordViewDefinition = {
    columns: [{ fieldKey: 'statut', hidden: false }],
    filters: [],
    sort: [],
    kanban: null,
    calendar: null,
    searchEnabled: true,
    pageSize: 25
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(StudioRecordViewsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('liste les vues (GET /views)', () => {
    service.listRecordViews('interventions').subscribe();
    const req = http.expectOne(`${base}/views`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('récupère une vue (GET /views/{id})', () => {
    service.getRecordView('interventions', 'v1').subscribe();
    const req = http.expectOne(`${base}/views/v1`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('crée une vue (POST /views)', () => {
    const request: SaveCustomRecordViewRequest = { key: 'kanban', displayName: 'Kanban', mode: 'Kanban', definition };
    service.createRecordView('interventions', request).subscribe();
    const req = http.expectOne(`${base}/views`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('met à jour une vue avec rowVersion (PUT /views/{id})', () => {
    const request: SaveCustomRecordViewRequest = {
      key: 'kanban', displayName: 'Kanban', mode: 'Kanban', definition, rowVersion: 'AAA'
    };
    service.updateRecordView('interventions', 'v1', request).subscribe();
    const req = http.expectOne(`${base}/views/v1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.rowVersion).toBe('AAA');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('supprime une vue (DELETE /views/{id}) — 204 sans corps', () => {
    service.deleteRecordView('interventions', 'v1').subscribe();
    const req = http.expectOne(`${base}/views/v1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('met une vue par défaut (POST /views/{id}/default) — 204 sans corps', () => {
    service.setDefaultRecordView('interventions', 'v1').subscribe();
    const req = http.expectOne(`${base}/views/v1/default`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('exécute une vue liste (POST /views/{id}/run)', () => {
    const request: RecordViewRunRequest = { page: 1, pageSize: 25, search: 'a' };
    service.runRecordView('interventions', 'v1', request).subscribe();
    const req = http.expectOne(`${base}/views/v1/run`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('exécute une vue calendrier avec rangeStart/rangeEnd dans le corps', () => {
    const request: RecordViewRunRequest = { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' };
    service.runRecordView('interventions', 'v1', request).subscribe();
    const req = http.expectOne(`${base}/views/v1/run`);
    expect(req.request.body.rangeStart).toBe('2026-09-01');
    expect(req.request.body.rangeEnd).toBe('2026-09-30');
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('applique un correctif partiel (PATCH /{id}) avec { data, rowVersion }', () => {
    service.patchRecord('interventions', 'r1', { statut: 'Terminée' }, 'AAA').subscribe();
    const req = http.expectOne(`${base}/r1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ data: { statut: 'Terminée' }, rowVersion: 'AAA' });
    req.flush({ success: true, data: null, message: null, errors: [] });
  });
});
