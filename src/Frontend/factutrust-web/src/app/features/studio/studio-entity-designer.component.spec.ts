import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { signal } from '@angular/core';
import { environment } from '@environments/environment';
import { ConfirmationService } from '@core/services/confirmation.service';
import { StudioEntityDesignerComponent } from './studio-entity-designer.component';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';
import { CustomField, CustomFieldType } from './studio.models';
import { STUDIO_AI_LABELS } from './ai/studio-ai-labels';
import { STUDIO_AI_CAPABILITIES_FALLBACK, StudioAiCapabilitiesDto } from './ai/studio-ai.models';

const API = `${environment.apiUrl}/studio`;

const e1 = {
  id: 'e1', key: 'interventions', displayName: 'Interventions', displayNamePlural: 'Interventions',
  icon: null, description: null, isActive: true, fieldCount: 1, createdAt: '', updatedAt: '', kind: 'Standard'
};
const relations = [{
  kind: 'many_to_many', sourceEntityId: 'e1', sourceEntityKey: 'interventions', sourceLabel: 'Interventions',
  targetEntityId: 'e2', targetEntityKey: 'techniciens', targetLabel: 'Techniciens',
  fieldId: 'f1', fieldKey: 'intervention_id', isRequired: true, isUnique: false,
  junctionEntityId: 'j1', junctionEntityKey: 'intervention_technicien', junctionTargetFieldKey: 'technicien_id'
}];

function capabilitiesStub(overrides: Partial<StudioAiCapabilitiesDto>, state: 'ready' | 'unavailable' = 'ready') {
  return {
    ensureLoaded: () => {},
    state: signal(state).asReadonly(),
    capabilities: signal({ ...STUDIO_AI_CAPABILITIES_FALLBACK, ...overrides }).asReadonly()
  };
}

const f1: CustomField = {
  id: 'f1', key: 'montant', label: 'Montant', fieldType: CustomFieldType.Text, isRequired: false, isUnique: false,
  sortOrder: 0, rules: null, options: null, relation: null, isActive: true
};

let fixture: ComponentFixture<StudioEntityDesignerComponent>;
let component: StudioEntityDesignerComponent;
let httpMock: HttpTestingController;

function setup(manyToManyEnabled: boolean, workflowsEnabled = false, state: 'ready' | 'unavailable' = 'ready'): void {
  TestBed.configureTestingModule({
    imports: [StudioEntityDesignerComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideNoopAnimations(),
      MessageService,
      { provide: ConfirmationService, useValue: { confirm: () => {} } },
      { provide: StudioAiCapabilitiesService, useValue: capabilitiesStub({ manyToManyEnabled, workflowsEnabled }, state) },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } }
    ]
  });
  fixture = TestBed.createComponent(StudioEntityDesignerComponent);
  component = fixture.componentInstance;
  httpMock = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  httpMock.expectOne(`${API}/entities/e1`).flush({ success: true, data: e1, message: null, errors: [] });
  httpMock.expectOne(req => req.url === `${API}/entities/e1/fields`).flush({ success: true, data: [], message: null, errors: [] });
  httpMock.expectOne(req => req.url === `${API}/entities` && req.method === 'GET').flush({ success: true, data: [e1], message: null, errors: [] });
  fixture.detectChanges();
}

describe('StudioEntityDesignerComponent — relations N-N (2.5f)', () => {
  afterEach(() => httpMock.verify());

  it('sans manyToManyEnabled ⇒ ni bouton ni section Relations, aucun GET relations', () => {
    setup(false);
    expect(fixture.debugElement.query(By.css('[data-testid="m2m-open"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="relations-section"]'))).toBeNull();
    httpMock.expectNone(`${API}/entities/e1/relations`);
  });

  it('avec manyToManyEnabled ⇒ bouton après Pont ERP et GET entities/{id}/relations', () => {
    setup(true);
    httpMock.expectOne(`${API}/entities/e1/relations`).flush({ success: true, data: relations, message: null, errors: [] });
    fixture.detectChanges();
    const buttons = fixture.debugElement.queryAll(By.css('.studio-head-actions button'));
    const idx = buttons.findIndex(b => b.nativeElement.getAttribute('data-testid') === 'm2m-open');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(buttons[idx - 1].nativeElement.textContent).toContain('Pont ERP');
    const section = fixture.debugElement.query(By.css('[data-testid="relations-section"]'));
    expect(section.nativeElement.textContent).toContain('Plusieurs-à-plusieurs');
    expect(section.nativeElement.textContent).toContain('Techniciens');
    expect(section.nativeElement.textContent).toContain('intervention_technicien');
  });

  it('created ⇒ recharge relations + fields et toast', () => {
    setup(true);
    httpMock.expectOne(`${API}/entities/e1/relations`).flush({ success: true, data: relations, message: null, errors: [] });
    fixture.detectChanges();
    const toast = TestBed.inject(MessageService);
    spyOn(toast, 'add');

    component.onRelationCreated();
    httpMock.expectOne(`${API}/entities/e1/relations`).flush({ success: true, data: [...relations, ...relations], message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${API}/entities/e1/fields`).flush({ success: true, data: [], message: null, errors: [] });
    expect(toast.add).toHaveBeenCalled();
    expect(component.relations().length).toBe(2);
  });
});

describe('StudioEntityDesignerComponent — accès workflows (4.4i)', () => {
  afterEach(() => httpMock.verify());

  it('affiche le bouton Workflows quand la capacité workflowsEnabled est vraie', () => {
    setup(false, true);
    const btn = fixture.debugElement.query(By.css('[data-testid="wf-open"]'));
    expect(btn).not.toBeNull();
    expect(btn.nativeElement.textContent).toContain('Workflows');
    const link = btn.injector.get(RouterLink);
    // Le hub 4.4d pré-filtre sur l'identifiant de table (?entity=<id>, H-5 / D-44-85).
    expect(link.queryParams).toEqual({ entity: 'e1' });
    expect(link.urlTree?.toString()).toBe('/studio/workflows?entity=e1');
  });

  it('masque le bouton Workflows quand la capacité est fausse ou indisponible', () => {
    setup(false, true, 'unavailable');
    expect(fixture.debugElement.query(By.css('[data-testid="wf-open"]'))).toBeNull();
  });
});

describe('StudioEntityDesignerComponent — changement de type (3.4l)', () => {
  const typeCheckUrl = `${API}/entities/e1/fields/f1/type-check`;
  const ok = (data: unknown) => ({ success: true, data, message: null, errors: [] });

  function saveButton(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('[data-testid="field-save"]')).nativeElement as HTMLButtonElement;
  }

  function editAndChangeType(to: CustomFieldType): void {
    component.openEdit(f1);
    fixture.detectChanges();
    component.fType = to;
    component.onTypeChange(to);
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('modifier le type d\'un champ existant ⇒ GET type-check?to=Number après 300 ms', fakeAsync(() => {
    setup(false);
    editAndChangeType(CustomFieldType.Number);
    expect(component.typeChecking()).toBeTrue();
    tick(299);
    httpMock.expectNone(req => req.url === typeCheckUrl);
    tick(1);
    const req = httpMock.expectOne(req => req.url === typeCheckUrl && req.method === 'GET');
    expect(req.request.params.get('to')).toBe('Number');
    req.flush(ok({ from: 'Text', to: 'Number', policy: 'lossless', recordCount: 0, message: 'Conversion sans perte.', allowed: true }));
    expect(component.typeChecking()).toBeFalse();
    expect(component.typeCheck()?.allowed).toBeTrue();
  }));

  it('revenir au type d\'origine annule la vérification en cours', fakeAsync(() => {
    setup(false);
    editAndChangeType(CustomFieldType.Number);
    expect(component.typeChecking()).toBeTrue();
    tick(100);
    component.fType = CustomFieldType.Text;
    component.onTypeChange(CustomFieldType.Text);
    fixture.detectChanges();
    tick(300);
    httpMock.expectNone(req => req.url === typeCheckUrl);
    expect(component.typeChecking()).toBeFalse();
    expect(component.typeCheck()).toBeNull();
    expect(saveButton().disabled).toBeFalse();
  }));

  it('policy lossless ⇒ message info, Enregistrer actif', fakeAsync(() => {
    setup(false);
    editAndChangeType(CustomFieldType.Number);
    expect(saveButton().disabled).toBeTrue();
    tick(300);
    httpMock.expectOne(req => req.url === typeCheckUrl)
      .flush(ok({ from: 'Text', to: 'Number', policy: 'lossless', recordCount: 3, message: 'Conversion sans perte (3 lignes).', allowed: true }));
    fixture.detectChanges();
    const msg = fixture.debugElement.query(By.css('[data-testid="type-check-message"]'));
    expect(msg.nativeElement.textContent).toContain('Conversion sans perte (3 lignes).');
    expect(component.typeSeverity()).toBe('info');
    expect(saveButton().disabled).toBeFalse();
  }));

  it('policy requires_empty_table non autorisée ⇒ Enregistrer désactivé', fakeAsync(() => {
    setup(false);
    editAndChangeType(CustomFieldType.Number);
    tick(300);
    httpMock.expectOne(req => req.url === typeCheckUrl)
      .flush(ok({ from: 'Text', to: 'Number', policy: 'requires_empty_table', recordCount: 12, message: 'Videz la table (12 lignes).', allowed: false }));
    fixture.detectChanges();
    expect(component.typeSeverity()).toBe('warn');
    expect(component.typeBlocked()).toBeTrue();
    expect(saveButton().disabled).toBeTrue();
    expect(fixture.debugElement.query(By.css('[data-testid="type-check-message"]')).nativeElement.textContent)
      .toContain('Videz la table (12 lignes).');
  }));

  it('policy forbidden ⇒ Enregistrer désactivé', fakeAsync(() => {
    setup(false);
    editAndChangeType(CustomFieldType.Formula);
    tick(300);
    httpMock.expectOne(req => req.url === typeCheckUrl)
      .flush({ success: false, message: 'Conversion Text → Formula interdite.', errors: [] }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(component.typeCheck()?.policy).toBe('forbidden');
    expect(component.typeCheck()?.message).toBe('Conversion Text → Formula interdite.');
    expect(component.typeSeverity()).toBe('error');
    expect(saveButton().disabled).toBeTrue();

    // Le flux reste vivant après un 400 : revenir au type d'origine efface la vérification.
    component.fType = CustomFieldType.Text;
    component.onTypeChange(CustomFieldType.Text);
    fixture.detectChanges();
    expect(component.typeCheck()).toBeNull();
    expect(saveButton().disabled).toBeFalse();
  }));

  it('Enregistrer avec type modifié ⇒ PATCH …/type puis PUT du champ ; 400 ⇒ message serveur tel quel', fakeAsync(() => {
    setup(false);
    const toast = TestBed.inject(MessageService);
    spyOn(toast, 'add');
    editAndChangeType(CustomFieldType.Number);
    tick(300);
    httpMock.expectOne(req => req.url === typeCheckUrl)
      .flush(ok({ from: 'Text', to: 'Number', policy: 'lossless', recordCount: 0, message: 'OK', allowed: true }));
    fixture.detectChanges();

    component.save();
    const patch = httpMock.expectOne(req => req.url === `${API}/entities/e1/fields/f1/type` && req.method === 'PATCH');
    expect(patch.request.body.fieldType).toBe(CustomFieldType.Number);
    patch.flush(ok({ ...f1, fieldType: CustomFieldType.Number }));
    const put = httpMock.expectOne(req => req.url === `${API}/entities/e1/fields/f1` && req.method === 'PUT');
    expect(put.request.body.label).toBe('Montant');
    put.flush(ok({ ...f1, fieldType: CustomFieldType.Number }));
    httpMock.expectOne(req => req.url === `${API}/entities/e1/fields`).flush(ok([]));
    httpMock.expectOne(`${API}/entities/e1`).flush(ok(e1));
    expect(component.dialogVisible).toBeFalse();
    expect(toast.add).not.toHaveBeenCalled();

    // 400 sur le PATCH ⇒ toast avec le message serveur tel quel, pas de PUT.
    editAndChangeType(CustomFieldType.Number);
    tick(300);
    httpMock.expectOne(req => req.url === typeCheckUrl)
      .flush(ok({ from: 'Text', to: 'Number', policy: 'lossless', recordCount: 0, message: 'OK', allowed: true }));
    component.save();
    httpMock.expectOne(req => req.url === `${API}/entities/e1/fields/f1/type` && req.method === 'PATCH')
      .flush({ success: false, message: 'Valeur « abc » non convertible en nombre.', errors: [] }, { status: 400, statusText: 'Bad Request' });
    httpMock.expectNone(req => req.url === `${API}/entities/e1/fields/f1` && req.method === 'PUT');
    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'error', detail: 'Valeur « abc » non convertible en nombre.' }));
    expect(component.saving()).toBeFalse();
  }));

  it('création de champ : aucun type-check, POST inchangé', fakeAsync(() => {
    setup(false);
    component.openAdd();
    fixture.detectChanges();
    component.fLabel = 'Quantité';
    component.onLabelChange('Quantité');
    component.fType = CustomFieldType.Number;
    component.onTypeChange(CustomFieldType.Number);
    fixture.detectChanges();
    tick(300);
    httpMock.expectNone(req => req.url.includes('/type-check'));
    expect(component.typeChecking()).toBeFalse();
    expect(component.typeCheck()).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="type-check-message"]'))).toBeNull();
    expect(saveButton().disabled).toBeFalse();

    component.save();
    httpMock.expectNone(req => req.method === 'PATCH');
    const post = httpMock.expectOne(req => req.url === `${API}/entities/e1/fields` && req.method === 'POST');
    expect(post.request.body).toEqual(jasmine.objectContaining({ key: 'quantite', label: 'Quantité', fieldType: CustomFieldType.Number }));
    post.flush(ok({ ...f1, id: 'f2', key: 'quantite', fieldType: CustomFieldType.Number }));
    httpMock.expectOne(req => req.url === `${API}/entities/e1/fields`).flush(ok([]));
    httpMock.expectOne(`${API}/entities/e1`).flush(ok(e1));
    expect(component.dialogVisible).toBeFalse();
    expect(STUDIO_AI_LABELS.typeChange.checking).toBeTruthy();
  }));
});
