import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { StudioService } from './studio.service';
import { CreateManyToManyRelationRequest } from './relations/studio-relations.models';
import { ChangeCustomFieldTypeRequest, CustomFieldType } from './studio.models';

describe('StudioService — vues/relations (PR 2.5a)', () => {
  let service: StudioService;
  let http: HttpTestingController;

  const base = `${environment.apiUrl}/studio`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(StudioService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listRecords sans filtre ne pose pas filterField/filterValue', () => {
    service.listRecords('interventions', null, 1, 25).subscribe();
    const req = http.expectOne(r => r.url === `${base}/records/interventions`);
    expect(req.request.params.has('filterField')).toBeFalse();
    req.flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
  });

  it('listRecords avec filtre ajoute filterField/filterValue', () => {
    service.listRecords('employes_projets', null, 1, 200, { field: 'employeId', value: 'r1' }).subscribe();
    const req = http.expectOne(r => r.url === `${base}/records/employes_projets`);
    expect(req.request.params.get('filterField')).toBe('employeId');
    expect(req.request.params.get('filterValue')).toBe('r1');
    req.flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
  });

  it('listEntityRelations — GET entities/{id}/relations', () => {
    service.listEntityRelations('e1').subscribe();
    const req = http.expectOne(`${base}/entities/e1/relations`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [], message: null, errors: [] });
  });

  it('createManyToMany — POST entities/{id}/relations/many-to-many avec le bon corps', () => {
    const request: CreateManyToManyRelationRequest = { targetEntityId: 'e2', label: 'Projets' };
    service.createManyToMany('e1', request).subscribe();
    const req = http.expectOne(`${base}/entities/e1/relations/many-to-many`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('createManyToMany — junctionAttributeLabel suit le corps tel quel (v1.1, D-47-40)', () => {
    const request: CreateManyToManyRelationRequest = { targetEntityId: 'e2', junctionAttributeLabel: 'Quantité' };
    service.createManyToMany('e1', request).subscribe();
    const req = http.expectOne(`${base}/entities/e1/relations/many-to-many`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });

  it('checkFieldTypeChange envoie le nom d’enum dans to', () => {
    service.checkFieldTypeChange('e1', 'f1', CustomFieldType[CustomFieldType.Number]).subscribe();
    const req = http.expectOne(r => r.url === `${base}/entities/e1/fields/f1/type-check`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('to')).toBe('Number');
    expect(req.request.params.get('to')).not.toBe(String(CustomFieldType.Number));
    req.flush({ success: true, data: { from: 'Text', to: 'Number', policy: 'lossless', recordCount: 0, message: '', allowed: true }, message: null, errors: [] });
  });

  it('listRecordHistory — GET records/{entityKey}/{id}/history avec page et pageSize (4.7h3, D-47-64)', () => {
    service.listRecordHistory('interventions', 'r1', 2).subscribe();
    const req = http.expectOne(r => r.url === `${base}/records/interventions/r1/history`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({
      success: true,
      data: { items: [], page: 2, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: true },
      message: null,
      errors: []
    });
  });

  it('listRecordHistory — pas de toast global : le contexte porte SKIP_ERROR_TOAST (erreurs affichées en ligne)', () => {
    service.listRecordHistory('interventions', 'r1').subscribe({ error: () => undefined });
    const req = http.expectOne(r => r.url === `${base}/records/interventions/r1/history`);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: false, data: null, message: 'Introuvable', errors: [] }, { status: 404, statusText: 'Not Found' });
  });

  it('changeFieldType émet un PATCH …/type', () => {
    const request: ChangeCustomFieldTypeRequest = { fieldType: CustomFieldType.Select, options: [{ value: 'a', label: 'A' }] };
    service.changeFieldType('e1', 'f1', request).subscribe();
    const req = http.expectOne(`${base}/entities/e1/fields/f1/type`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(request);
    req.flush({ success: true, data: null, message: null, errors: [] });
  });
});
