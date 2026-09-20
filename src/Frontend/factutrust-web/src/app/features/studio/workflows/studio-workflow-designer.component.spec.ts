import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { CustomField } from '@shared/studio-runtime/studio-runtime.models';
import { StudioWorkflowDesignerComponent } from './studio-workflow-designer.component';
import { STUDIO_WORKFLOW_LABELS } from './studio-workflow-labels';
import { StudioWorkflowTestDialogComponent } from './studio-workflow-test-dialog.component';
import { StepCatalogEntryDto, WorkflowDefinitionDto } from './studio-workflows.models';
import { CustomEntity } from '../studio.models';

const API = `${environment.apiUrl}/studio`;

const entities = [
  { id: 'e1', key: 'clients', displayName: 'Clients', kind: 'Standard' }
] as CustomEntity[];

const fields = [
  { id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isActive: true },
  { id: 'f2', key: 'montant', label: 'Montant', fieldType: 2, isRequired: false, isActive: true }
] as CustomField[];

/** Catalogue minimal : `condition` avec sa propriété `filters` (affiche le filter-builder), `notify` nue. */
const catalog: StepCatalogEntryDto[] = [
  { type: 'condition', label: 'Condition', description: '', properties: [{ name: 'filters', kind: 'filters', required: false, help: '' }] },
  { type: 'notify', label: 'Notifier', description: '', properties: [] }
];

const workflow: WorkflowDefinitionDto = {
  id: 'w1', entityDefinitionId: 'e1', key: 'validation_devis', name: 'Validation devis', description: null,
  trigger: 'on_create', triggerConfig: null,
  steps: { version: 1, steps: [{ key: 'condition_1', type: 'condition', label: 'Montant élevé', filters: [], match: 'all', onFalse: 'stop' }] },
  stepCount: 1, version: 1, isActive: false, openInstances: 0,
  createdAt: '2026-09-01', updatedAt: '2026-09-10', rowVersion: 'rv1'
};

describe('StudioWorkflowDesignerComponent', () => {
  let fixture: ComponentFixture<StudioWorkflowDesignerComponent>;
  let component: StudioWorkflowDesignerComponent;
  let httpMock: HttpTestingController;
  let confirmSpy: jasmine.Spy;

  /** Motif `studio-record-view-designer.component.spec.ts` l.45–75 ; BreakpointObserver stubbé (écran large). */
  function setup(): void {
    confirmSpy = jasmine.createSpy('confirm');
    TestBed.configureTestingModule({
      imports: [StudioWorkflowDesignerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ConfirmationService, useValue: { confirm: confirmSpy } },
        { provide: AuthService, useValue: { hasPermission: () => true } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: 'w1' }), queryParamMap: convertToParamMap({}) },
            // 4.4e2 : le concepteur lit `?instance=` en continu (toSignal) pour le drawer de 4.4f.
            queryParamMap: of(convertToParamMap({}))
          }
        },
        // 4.6T2 : le concepteur lit ViewportService (BreakpointObserver) — écran large stubbé.
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }), isMatched: () => false } }
      ]
    });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(TestBed.inject(MessageService), 'add'); // 4.6d1 : vérifie les toasts sans les rendre
    fixture = TestBed.createComponent(StudioWorkflowDesignerComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/workflows/step-catalog`).flush({ success: true, data: { entries: catalog }, message: null, error: null });
    httpMock.expectOne(`${API}/entities?includeInactive=false`).flush({ success: true, data: entities, message: null, error: null });
    httpMock.expectOne(`${API}/automations/actions`).flush({ success: true, data: [], message: null, error: null });
    httpMock.expectOne(`${API}/workflows/w1`).flush({ success: true, data: workflow, message: null, error: null });
    httpMock.expectOne(`${API}/records/clients/schema`).flush({
      success: true,
      data: { entity: entities[0], fields, form: { sections: [] }, relations: [], views: [] },
      message: null, error: null
    });
    fixture.detectChanges();
    // 4.4e2 / 4.7a2 : le panneau « Historique » de la colonne 3 charge la page 1 (20 par page, route paginée 4.7a1).
    httpMock.expectOne(r => r.url === `${API}/workflows/w1/instances` && r.params.get('page') === '1' && r.params.get('pageSize') === '20')
      .flush({ success: true, data: { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false }, message: null, error: null });
    fixture.detectChanges();
  }

  beforeEach(() => setup());

  afterEach(() => httpMock.verify());

  it('charge catalogue, tables, actions et schéma puis affiche la première étape', () => {
    expect(component.loading()).toBeFalse();
    expect(component.entity()?.key).toBe('clients');
    expect(component.selectedIndex()).toBe(0);
    // Ligne de la liste d'étapes (testid figé de 4.4c2) + éditeur monté.
    expect(fixture.debugElement.query(By.css('[data-testid="wf-step-condition_1"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="step-editor"]'))).not.toBeNull();
    // Actions d'en-tête figées (Playwright 4.4l1).
    expect(fixture.debugElement.query(By.css('[data-testid="wf-validate"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-save"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-toggle"]'))).not.toBeNull();
  });

  it('héberge le p-toast des messages de la page (D-44-95) et affiche le succès après enregistrement', () => {
    expect(fixture.debugElement.query(By.css('p-toast'))).not.toBeNull();

    component.save();
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/entities/e1/workflows/validate`)
      .flush({ success: true, data: { isValid: true, errors: [], warnings: [], stepCount: 1 }, message: null, error: null });
    httpMock.expectOne(r => r.method === 'PUT' && r.url === `${API}/workflows/w1`)
      .flush({ success: true, data: { ...workflow, version: 2, rowVersion: 'rv2' }, message: null, error: null });

    const toast = TestBed.inject(MessageService);
    expect((toast.add as jasmine.Spy).calls.allArgs().some(args => args[0].severity === 'success')).toBeTrue();
  });

  it('enchaîne validate puis update avec rowVersion et remonte les erreurs par étape sans enregistrer si invalide', () => {
    expect(component.canSave()).toBeTrue();

    // 1er essai : le serveur déclare le workflow invalide ⇒ aucune écriture.
    component.save();
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/entities/e1/workflows/validate`)
      .flush({ success: true, data: { isValid: false, errors: [{ path: 'steps[0].filters', message: 'x' }], warnings: [], stepCount: 1 }, message: null, error: null });
    httpMock.expectNone(`${API}/workflows/w1`);
    expect(component.saving()).toBeFalse();
    expect(component.issues()).toEqual([{ path: 'steps[0].filters', message: 'x' }]);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-validation"]'))).not.toBeNull();

    // 2d essai : valide ⇒ PUT avec le rowVersion courant.
    component.save();
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/entities/e1/workflows/validate`)
      .flush({ success: true, data: { isValid: true, errors: [], warnings: [], stepCount: 1 }, message: null, error: null });
    const put = httpMock.expectOne(r => r.method === 'PUT' && r.url === `${API}/workflows/w1`);
    expect(put.request.body.rowVersion).toBe('rv1');
    expect(put.request.body.key).toBe('validation_devis');
    put.flush({ success: true, data: { ...workflow, version: 2, rowVersion: 'rv2' }, message: null, error: null });
    expect(component.saving()).toBeFalse();
    expect(component.version()).toBe(2);
    expect(component.dirty()).toBeFalse();
  });

  // ---- 4.7b4 : déclencheur « Planifié » ----

  it('rend la carte « Planifié » sélectionnable et exige un cron non vide pour enregistrer (1:1 du veto D5)', () => {
    const card = fixture.debugElement.query(By.css('[data-testid="wf-trigger-scheduled"]'));
    expect(card).not.toBeNull();
    expect(card.classes['wf-trigger--disabled'] ?? false).toBeFalsy();
    expect(card.query(By.css('p-tag'))).toBeNull();            // plus de pastille « Bientôt »

    card.triggerEventHandler('click', null);
    fixture.detectChanges();

    expect(component.trigger()).toBe('scheduled');
    expect(fixture.debugElement.query(By.css('[data-testid="wf-scheduled-config"]'))).not.toBeNull();
    expect(component.canSave()).toBeFalse();                   // cron vide
    component.onCronInput('0 6 * * *');
    expect(component.canSave()).toBeTrue();                    // 1:1 de l'ancien veto
  });

  it('un preset remplit l\'expression cron ; « Personnalisé » conserve la saisie libre', () => {
    component.selectTrigger({ value: 'scheduled' });
    component.onCronPreset('0 6 * * 1');
    expect(component.triggerConfig()?.cron).toBe('0 6 * * 1');
    expect(component.cronPresetSelection()).toBe('0 6 * * 1');

    component.onCronInput('15 3 * * *');                       // saisie libre ⇒ preset « Personnalisé »
    expect(component.triggerConfig()?.cron).toBe('15 3 * * *');
    expect(component.cronPresetSelection()).toBe('__custom__');
    component.onCronPreset('__custom__');                      // choisir « Personnalisé » ne touche pas le cron
    expect(component.triggerConfig()?.cron).toBe('15 3 * * *');
  });

  it('porte les filtres planifiés via l\'adaptateur (between replié en value/value2)', () => {
    component.selectTrigger({ value: 'scheduled' });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-scheduled-config"] app-studio-filter-builder'))).not.toBeNull();

    component.onScheduledFilters([{ fieldKey: 'montant', op: 'between', value: [10, 20] }]);
    expect(component.triggerConfig()?.filters).toEqual([{ field: 'montant', op: 'between', value: 10, value2: 20 }]);
    component.onScheduledFilters([]);
    expect(component.triggerConfig()?.filters).toEqual([]);
  });

  it('réinitialise la configuration quand le déclencheur change (aucune clé field_changed sur scheduled)', () => {
    component.selectTrigger({ value: 'field_changed' });
    component.patchTriggerConfig({ field: 'montant', from: 'a', to: 'b' });
    component.selectTrigger({ value: 'scheduled' });
    expect(component.triggerConfig()).toEqual({});             // ni field, ni from, ni to
    component.patchTriggerConfig({ cron: '0 6 * * *' });
    component.selectTrigger({ value: 'scheduled' });           // re-clic : conserve la saisie
    expect(component.triggerConfig()).toEqual({ cron: '0 6 * * *' });
    component.selectTrigger({ value: 'on_update' });
    expect(component.triggerConfig()).toBeNull();
  });

  it('enregistre un déclencheur planifié avec triggerConfig { cron, filters }', () => {
    component.selectTrigger({ value: 'scheduled' });
    component.onCronInput('0 6 * * *');
    component.onScheduledFilters([{ fieldKey: 'nom', op: 'is_not_empty' }]);

    component.save();
    const validate = httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/entities/e1/workflows/validate`);
    expect(validate.request.body.trigger).toBe('scheduled');
    expect(validate.request.body.triggerConfig).toEqual({ cron: '0 6 * * *', filters: [{ field: 'nom', op: 'is_not_empty' }] });
    validate.flush({ success: true, data: { isValid: true, errors: [], warnings: [], stepCount: 1 }, message: null, error: null });
    const put = httpMock.expectOne(r => r.method === 'PUT' && r.url === `${API}/workflows/w1`);
    expect(put.request.body.triggerConfig?.cron).toBe('0 6 * * *');
    put.flush({
      success: true,
      data: { ...workflow, trigger: 'scheduled', triggerConfig: { cron: '0 6 * * *', filters: [{ field: 'nom', op: 'is_not_empty' }] }, version: 2, rowVersion: 'rv2' },
      message: null, error: null
    });
    expect(component.trigger()).toBe('scheduled');
    expect(component.dirty()).toBeFalse();
  });

  it('affiche le 400 serveur « triggerConfig.cron » en bannière', () => {
    component.selectTrigger({ value: 'scheduled' });
    component.onCronInput('61 * * * *');                       // passe le garde-fou local, refusé par le serveur (b1)

    component.save();
    httpMock.expectOne(r => r.method === 'POST' && r.url === `${API}/entities/e1/workflows/validate`)
      .flush({ success: true, data: { isValid: true, errors: [], warnings: [], stepCount: 1 }, message: null, error: null });
    httpMock.expectOne(r => r.method === 'PUT' && r.url === `${API}/workflows/w1`)
      .flush({ success: false, data: null, message: null, error: 'triggerConfig.cron : expression cron invalide' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    const banner = fixture.debugElement.query(By.css('[data-testid="wf-banner"]'));
    expect(banner).not.toBeNull();
    expect(banner.nativeElement.textContent).toContain('triggerConfig.cron');
    expect(component.saving()).toBeFalse();
  });

  // ---- 4.7c2 — dialogue « Tester sur un enregistrement » (simulation pure, route 4.7c1) ----

  describe('dialogue « Tester » (4.7c2)', () => {
    it('désactive le bouton tant que le brouillon est sale, avec l\u2019infobulle dédiée', () => {
      fixture.detectChanges();
      const button = () => fixture.debugElement.query(By.css('[data-testid="wf-test"]')).nativeElement as HTMLButtonElement;
      expect(component.dirty()).toBeFalse();
      expect(button().disabled).toBeFalse();

      component.name.set('Nom modifié');
      fixture.detectChanges();
      expect(component.dirty()).toBeTrue();
      expect(button().disabled).toBeTrue();
      expect(button().getAttribute('title')).toBe(STUDIO_WORKFLOW_LABELS.test.saveFirst);
    });

    // 4.7★3 (D-47-80) : le dialogue vit dans `StudioWorkflowTestDialogComponent` (cas de recherche, de trace,
    // d'échappement et d'erreur déplacés dans sa propre spec) ; le concepteur lui passe le workflow, la table
    // et le schéma, et l'ouvre depuis le bouton « Tester ».
    it('ouvre le dialogue enfant depuis « Tester » avec le workflow, la table et le schéma chargés', () => {
      const dialog = fixture.debugElement.query(By.directive(StudioWorkflowTestDialogComponent))
        .componentInstance as StudioWorkflowTestDialogComponent;
      expect(dialog.workflowId()).toBe('w1');
      expect(dialog.entityKey()).toBe('clients');
      expect(dialog.fields().map(f => f.key)).toEqual(['nom', 'montant']);
      expect(dialog.visible()).toBeFalse();

      (fixture.debugElement.query(By.css('[data-testid="wf-test"]')).nativeElement as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(dialog.visible()).toBeTrue();
      // Ouverture ⇒ recherche des 10 premiers enregistrements de la table du workflow (même requête que 4.7c2).
      httpMock.expectOne(r => r.method === 'GET' && r.url === `${API}/records/clients`
        && r.params.get('page') === '1' && r.params.get('pageSize') === '10')
        .flush({ success: true, data: { items: [], page: 1, pageSize: 10, totalCount: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false }, message: null, error: null });
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="wf-test-empty"]'))).not.toBeNull();
    });
  });
});
