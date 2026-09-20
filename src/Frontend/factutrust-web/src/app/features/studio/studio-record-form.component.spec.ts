import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { StudioRecordFormComponent } from './studio-record-form.component';
import { DynamicFormComponent } from '@shared/studio-runtime/dynamic-form.component';
import { EntityRelationDto } from './relations/studio-relations.models';
import { WorkflowInstanceDto } from './workflows/studio-workflows.models';

const API = `${environment.apiUrl}/studio/records/interventions`;

/** Instance de workflow minimale pour la sonde `listRecordInstances` (4.4h2). */
function wfInstance(id: string, status: WorkflowInstanceDto['status']): WorkflowInstanceDto {
  return {
    id, workflowDefinitionId: 'd1', entityDefinitionId: 'e1', workflowKey: 'relance', workflowName: 'Relance',
    definitionVersion: 1, recordId: 'r1', trigger: 'manual', status, currentStepIndex: 0,
    currentStepKey: null, dueAt: null, startedBy: null, startedAt: '2026-09-16T09:00:00Z',
    completedAt: null, depth: 0, originInstanceId: null, error: null
  };
}

const m2m: EntityRelationDto = {
  kind: 'many_to_many',
  sourceEntityId: 'e1', sourceEntityKey: 'interventions', sourceLabel: 'Interventions',
  targetEntityId: 'e2', targetEntityKey: 'techniciens', targetLabel: 'Techniciens',
  fieldId: 'f1', fieldKey: 'intervention_id', isRequired: true, isUnique: false,
  junctionEntityId: 'j1', junctionEntityKey: 'intervention_technicien', junctionTargetFieldKey: 'technicien_id'
};
const m2o: EntityRelationDto = { ...m2m, kind: 'many_to_one', junctionEntityKey: null, junctionTargetFieldKey: null };

const JUNCTION = `${environment.apiUrl}/studio/records/intervention_technicien`;
const TARGETS = `${environment.apiUrl}/studio/records/techniciens`;
const emptyJunctionPage = { success: true, data: { items: [], page: 1, pageSize: 50, totalCount: 0, totalPages: 0 }, message: null, errors: [] };
const emptyTargetsPage = { success: true, data: { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 }, message: null, errors: [] };
const junctionSchemaNoAttr = { success: true, data: { entity: { id: 'j1', key: 'intervention_technicien' }, fields: [
  { id: 'f1', key: 'intervention_id', label: 'Intervention', fieldType: 'RelationCustom', isActive: true, sortOrder: 0 },
  { id: 'f2', key: 'technicien_id', label: 'Technicien', fieldType: 'RelationCustom', isActive: true, sortOrder: 1 }
], form: null }, message: null, errors: [] };

const schema = (relations: EntityRelationDto[] | null) => ({
  entity: { id: 'e1', key: 'interventions', displayName: 'Interventions' },
  fields: [{ id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isActive: true }],
  form: { sections: [] },
  relations,
  views: []
});

describe('StudioRecordFormComponent — onglets Fiche / Liés (2.5e)', () => {
  let fixture: ComponentFixture<StudioRecordFormComponent>;
  let component: StudioRecordFormComponent;
  let httpMock: HttpTestingController;

  function setup(recordId: string | null, relations: EntityRelationDto[] | null, canWrite = true, instances: WorkflowInstanceDto[] | 'off' = [],
    viewOnly = false): void {
    TestBed.configureTestingModule({
      imports: [StudioRecordFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: AuthService, useValue: { hasPermission: () => canWrite } },
        { provide: ActivatedRoute, useValue: { snapshot: {
          paramMap: convertToParamMap(recordId ? { key: 'interventions', id: recordId } : { key: 'interventions' }),
          // D-47-94 : `/view` (lecteur pur) active le mode lecture seule du composant.
          routeConfig: { path: recordId ? (viewOnly ? 'd/:key/:id/view' : 'd/:key/:id/edit') : 'd/:key/new' }
        } } }
      ]
    });
    fixture = TestBed.createComponent(StudioRecordFormComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/schema`).flush({ success: true, data: schema(relations), message: null, errors: [] });
    if (recordId) {
      httpMock.expectOne(`${API}/${recordId}`).flush({ success: true, data: { id: recordId, data: { nom: 'X' }, createdAt: '', updatedAt: '' }, message: null, errors: [] });
      // 4.4h2 : la sonde « workflow-instances » part en parallèle de getRecord (D-44-59) — toujours drainée,
      // sinon `httpMock.verify()` échoue. 'off' = module coupé / droit absent ⇒ 404 (onglet absent).
      const probe = httpMock.expectOne(r => r.url.includes('/workflow-instances'));
      expect(probe.request.method).toBe('GET');
      expect(probe.request.params.get('max')).toBe('20');
      if (instances === 'off') {
        probe.flush({}, { status: 404, statusText: 'Not Found' });
      } else {
        probe.flush({ success: true, data: instances, message: null, error: null });
      }
    }
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  /** Vide les requêtes d'une carte de puces (4.7r4) ou de l'onglet Liés montés dans le test. */
  function drainLinkSurfaces(): void {
    httpMock.match(r => r.urlWithParams.startsWith(`${JUNCTION}?page=1`)).forEach(req => {
      if (!req.cancelled) req.flush(emptyJunctionPage);
    });
    httpMock.match(r => r.url === `${JUNCTION}/schema`).forEach(req => {
      if (!req.cancelled) req.flush(junctionSchemaNoAttr);
    });
    httpMock.match(r => r.urlWithParams.startsWith(`${TARGETS}?page=1`)).forEach(req => {
      if (!req.cancelled) req.flush(emptyTargetsPage);
    });
  }

  it('sans relation N-N ni workflows ⇒ onglets Fiche + Historique seulement, formulaire actif (4.7h5, D-B2)', () => {
    setup('r1', [], true, 'off');   // sonde drainée en 404 : contrat inchangé (4.4h2)
    expect(component.showTabs()).toBeTrue();
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'history']);
    expect(component.tabs()[1].label).toBe('Historique');
    expect(component.tabs()[1].badge).toBeUndefined();                 // sans badge (D-B3)
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-studio-record-tabs'))).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="studio-tab-history"]')).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-form'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-record-history-tab'))).toBeNull();
  });

  it('sans relations dans le schéma (null) ⇒ onglets Fiche + Historique', () => {
    setup('r1', null, true, 'off');
    expect(component.showTabs()).toBeTrue();
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'history']);
  });

  it('en création (recordId null) ⇒ pas d\'onglets même avec N-N', () => {
    setup(null, [m2m], true, 'off');
    expect(component.recordId).toBeNull();
    expect(component.showTabs()).toBeFalse();
    expect(fixture.debugElement.query(By.css('app-studio-record-tabs'))).toBeNull();
  });

  it('en édition avec N-N ⇒ onglets Fiche puis Liés — <cible> puis Historique, formulaire actif par défaut', () => {
    setup('r1', [m2o, m2m], true, 'off');
    expect(component.showTabs()).toBeTrue();
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'linked:intervention_technicien', 'history']);
    expect(component.tabs()[1].label).toBe('Liés — Techniciens');
    expect(component.activeTab()).toBe('form');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-studio-record-tabs'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-form'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-linked-records-tab'))).toBeNull();

    // 4.7r4 : l'onglet Fiche porte une carte de puces par relation N-N — ses requêtes montent dès
    // le montage (jonction + schéma de jonction + cibles).
    expect(fixture.debugElement.queryAll(By.css('app-studio-link-chips-editor')).length).toBe(1);
    drainLinkSurfaces();

    component.activeTab.set('linked:intervention_technicien');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-dynamic-form'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-linked-records-tab'))).not.toBeNull();
    expect(component.activeRelation()?.targetEntityKey).toBe('techniciens');
    // L'onglet Liés monte ses requêtes : on les vide (jonction + schéma de jonction + cibles ×2).
    drainLinkSurfaces();
  });

  it('édition : une carte de puces par relation N-N sous le formulaire (4.7r4)', () => {
    setup('r1', [m2m], true, 'off');
    fixture.detectChanges();
    const cards = fixture.debugElement.queryAll(By.css('app-studio-link-chips-editor'));
    expect(cards.length).toBe(1);
    expect(cards[0].nativeElement.getAttribute('data-testid') ?? cards[0].query(By.css('[data-testid^="chips-"]'))).toBeTruthy();
    drainLinkSurfaces();
  });

  it('création : aucune carte de puces (recordId requis — même garde que les onglets)', () => {
    setup(null, [m2m], true, 'off');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-studio-link-chips-editor'))).toBeNull();
    // Aucune requête de puces n'a été émise (verify() le garantit en afterEach).
  });

  it("ajoute l'onglet Workflows avec le nombre d'instances ouvertes quand la sonde répond", () => {
    setup('r1', [], true, [wfInstance('i1', 'waiting_approval'), wfInstance('i2', 'completed')]);

    expect(component.showWorkflowsTab()).toBeTrue();
    expect(component.showTabs()).toBeTrue();                       // onglet présent même sans relation N-N
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'workflows', 'history']);   // Historique toujours en dernier (D-B3)
    expect(component.tabs()[1].label).toBe('Workflows');
    expect(component.tabs()[1].badge).toBe(1);                     // instances OUVERTES seulement (D-44-58)
    fixture.detectChanges();
    const tab = fixture.nativeElement.querySelector('[data-testid="studio-tab-workflows"]') as HTMLElement;
    expect(tab).not.toBeNull();
    expect(tab.querySelector('.studio-tab__badge')?.textContent?.trim()).toBe('1');

    component.activeTab.set('workflows');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-studio-record-workflows-tab'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-form'))).toBeNull();
  });

  it("n'affiche pas l'onglet Workflows quand la sonde répond 404 ou 403", () => {
    setup('r1', [m2m], true, 'off');                               // 404 au chargement
    drainLinkSurfaces();                                           // carte de puces montée (4.7r4)
    expect(component.workflowInstances()).toBeNull();
    expect(component.showWorkflowsTab()).toBeFalse();
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'linked:intervention_technicien', 'history']);
    expect(fixture.nativeElement.querySelector('[data-testid="studio-tab-workflows"]')).toBeNull();

    component.loadWorkflowInstances();                             // variante 403 (policy refusée)
    httpMock.expectOne(r => r.url.includes('/workflow-instances'))
      .flush({}, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(component.workflowInstances()).toBeNull();
    expect(component.showWorkflowsTab()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[data-testid="studio-tab-workflows"]')).toBeNull();
  });

  it("n'interroge pas la sonde en création (recordId absent)", () => {
    setup(null, [m2m], true, 'off');
    httpMock.expectNone(r => r.url.includes('/workflow-instances'));
    expect(component.showWorkflowsTab()).toBeFalse();
    expect(component.showTabs()).toBeFalse();
  });

  it("l'onglet Historique ne déclenche aucune requête /history avant son activation, puis 1 GET page=1&pageSize=20 (4.7h5, D-B4)", () => {
    setup('r1', [], true, 'off');
    fixture.detectChanges();
    httpMock.expectNone(r => r.url.endsWith('/history'));
    expect(fixture.debugElement.query(By.css('app-studio-record-history-tab'))).toBeNull();

    (fixture.nativeElement.querySelector('[data-testid="studio-tab-history"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(component.activeTab()).toBe('history');
    expect(fixture.debugElement.query(By.css('app-studio-record-history-tab'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-form'))).toBeNull();
    const history = httpMock.expectOne(r => r.url === `${API}/r1/history`);
    expect(history.request.method).toBe('GET');
    expect(history.request.params.get('page')).toBe('1');
    expect(history.request.params.get('pageSize')).toBe('20');
    history.flush({ success: true, data: { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }, message: null, error: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="srh-empty"]')).not.toBeNull();
  });

  it('lecture seule (/view, lecteur sans recordsWrite) : readOnly vrai, champs désactivés, sans actions (D-47-94)', () => {
    setup('r1', null, false, [], true);
    expect(component.readOnly()).toBe(true);
    expect(component.canWrite()).toBe(false);
    fixture.detectChanges(); // propage [readOnly] au sous-composant (saisi après ngOnInit)
    fixture.detectChanges();
    const df = fixture.debugElement.query(By.directive(DynamicFormComponent));
    expect(df).withContext('DynamicForm monté').not.toBeNull();
    expect(df.componentInstance.readOnly).toBe(true);
    // Le mode lecture seule est entré à ngOnInit → le champ est désactivé dès buildForm.
    const control = df.componentInstance.form.get('nom');
    expect(control?.disabled).withContext('champ « nom » désactivé en lecture seule').toBe(true);
    const actions = fixture.nativeElement.querySelector('.ft-form-actions');
    expect(actions).withContext('barre Enregistrer/Annuler absente en lecture seule').toBeNull();
  });

  it('édition (/edit) : readOnly faux, barre d’actions présente (régression D-47-94)', () => {
    setup('r1', null, true);
    expect(component.readOnly()).toBe(false);
    const df = fixture.debugElement.query(By.directive(DynamicFormComponent));
    expect(df.componentInstance.readOnly).toBe(false);
    fixture.detectChanges();
    const actions = fixture.nativeElement.querySelector('.ft-form-actions');
    expect(actions).withContext('barre Enregistrer/Annuler présente en édition').not.toBeNull();
  });

  it('lecture seule : submit() est sans effet (défense en profondeur, D-47-94)', () => {
    setup('r1', null, false, [], true);
    component.submit({ nom: 'Y' });
    httpMock.expectNone(r => r.method === 'PUT' || r.method === 'POST');
    expect(component.saving()).toBe(false);
  });

  it('lecture seule : tous les onglets restent présents (Fiche + Historique), workflows si sonde OK (D-47-94)', () => {
    setup('r1', null, false, [wfInstance('w1', 'running')], true);
    expect(component.tabs().map(t => t.key)).toEqual(['form', 'workflows', 'history']);
  });

  it('création : ni onglet Historique ni requête /history', () => {
    setup(null, [], true, 'off');
    fixture.detectChanges();
    expect(component.showTabs()).toBeFalse();
    expect(component.tabs().map(t => t.key)).toEqual(['form']);
    expect(fixture.debugElement.query(By.css('app-studio-record-tabs'))).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="studio-tab-history"]')).toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-record-history-tab'))).toBeNull();
    httpMock.expectNone(r => r.url.endsWith('/history'));
  });

});
