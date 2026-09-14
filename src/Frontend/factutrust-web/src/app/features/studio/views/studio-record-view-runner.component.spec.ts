import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { MessageService } from 'primeng/api';
import { StudioRecordViewRunnerComponent } from './studio-record-view-runner.component';
import { CustomRecordViewDto, RecordViewDefinition, RecordViewRunResultDto } from './studio-record-views.models';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';

const definition: RecordViewDefinition = {
  columns: [{ fieldKey: 'nom', hidden: false }],
  filters: [],
  sort: [],
  searchEnabled: true,
  pageSize: 25
};

const view: CustomRecordViewDto = {
  id: 'v1',
  key: 'v1',
  displayName: 'Actifs',
  mode: 'List',
  definition,
  isDefault: false,
  isActive: true,
  rowVersion: 'AAA',
  updatedAt: '2026-01-01T00:00:00Z'
};

const fields: CustomField[] = [
  { id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isActive: true } as CustomField
];

describe('StudioRecordViewRunnerComponent', () => {
  let fixture: ComponentFixture<StudioRecordViewRunnerComponent>;
  let component: StudioRecordViewRunnerComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioRecordViewRunnerComponent],
      providers: [MessageService, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(StudioRecordViewRunnerComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function setInputs(v: CustomRecordViewDto | null = view): void {
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('allFields', fields);
    fixture.componentRef.setInput('view', v);
    fixture.detectChanges();
  }

  it('exécute la vue au montage (POST /run) et affiche les lignes reçues', () => {
    setInputs();
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);
    expect(req.request.method).toBe('POST');
    const result: RecordViewRunResultDto = {
      mode: 'List', items: [{ id: 'r1', data: { nom: 'X' }, createdAt: '', updatedAt: '' }],
      total: 1, page: 1, pageSize: 25, truncated: false
    };
    req.flush({ success: true, data: result, message: null, errors: [] });
    fixture.detectChanges();

    expect(component['result']()?.total).toBe(1);
    expect(fixture.debugElement.query(By.css('app-dynamic-table'))).not.toBeNull();
  });

  it('affiche le bandeau de troncature quand truncated=true', () => {
    setInputs();
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);
    const result: RecordViewRunResultDto = { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: true };
    req.flush({ success: true, data: result, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.runner-banner'))).not.toBeNull();
  });

  it('affiche un état d’erreur si la requête échoue', () => {
    setInputs();
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);
    req.flush({ message: 'erreur' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-empty-state'))).not.toBeNull();
  });

  it('affiche un panneau « Bientôt » pour les modes Kanban et Calendrier, sans appel réseau', () => {
    setInputs({ ...view, mode: 'Kanban' });
    httpMock.expectNone(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);

    expect(fixture.debugElement.query(By.css('.runner-soon'))?.nativeElement.textContent).toContain('Kanban');
  });

  it('applique les colonnes de la vue (ordre et masquage), pas tous les champs', () => {
    const allFields: CustomField[] = [
      { id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isActive: true } as CustomField,
      { id: 'f2', key: 'ville', label: 'Ville', fieldType: 0, isRequired: false, isActive: true } as CustomField,
      { id: 'f3', key: 'cp', label: 'Code postal', fieldType: 0, isRequired: false, isActive: true } as CustomField
    ];
    const v: CustomRecordViewDto = {
      ...view,
      definition: {
        ...definition,
        columns: [
          { fieldKey: 'cp', hidden: false },
          { fieldKey: 'nom', hidden: false },
          { fieldKey: 'ville', hidden: true }
        ]
      }
    };
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('allFields', allFields);
    fixture.componentRef.setInput('view', v);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    const headers = fixture.debugElement.queryAll(By.css('th')).map(th => th.nativeElement.textContent.trim());
    expect(headers).toEqual(['Code postal', 'Nom', 'Actions']);
  });

  it('tronque le rendu via previewLimit et affiche le bandeau', () => {
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('allFields', fields);
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('previewLimit', 1);
    fixture.detectChanges();
    const result: RecordViewRunResultDto = {
      mode: 'List',
      items: [
        { id: 'r1', data: { nom: 'A' }, createdAt: '', updatedAt: '' },
        { id: 'r2', data: { nom: 'B' }, createdAt: '', updatedAt: '' }
      ],
      total: 2, page: 1, pageSize: 25, truncated: false
    };
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: result, message: null, errors: [] });
    fixture.detectChanges();

    expect(component['rows']().length).toBe(1);
    expect(component['truncated']()).toBeTrue();
    expect(fixture.debugElement.query(By.css('.runner-banner'))).not.toBeNull();
  });

  it('annule une requête /run en vol quand une nouvelle sélection survient (réponse en retard ignorée)', () => {
    setInputs();
    const first = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);

    // Changement de vue avant la réponse : le switchMap annule la première requête.
    fixture.componentRef.setInput('view', { ...view, id: 'v2', key: 'v2', displayName: 'Autre' });
    fixture.detectChanges();
    expect(first.cancelled).toBeTrue();
    const second = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v2/run`);

    // La seconde répond : seule elle doit apparaître.
    second.flush({ success: true, data: { mode: 'List', items: [], total: 7, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();
    expect(component['result']()?.total).toBe(7);
  });

  it('reload() relance depuis la page 1 en transmettant le search courant', () => {
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('allFields', fields);
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('search', '  pompe  ');
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });

    component.reload();
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);
    expect(req.request.body.page).toBe(1);
    expect(req.request.body.search).toBe('pompe');
    req.flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
  });

  it('émet le total serveur vers le parent', () => {
    const totals: number[] = [];
    component.total.subscribe(t => totals.push(t));
    setInputs();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 42, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });

    expect(totals).toEqual([42]);
  });
});
