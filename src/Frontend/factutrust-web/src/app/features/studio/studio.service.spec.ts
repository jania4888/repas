import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { StudioService } from './studio.service';
import { CreateManyToManyRelationRequest } from './relations/studio-relations.models';

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
});
