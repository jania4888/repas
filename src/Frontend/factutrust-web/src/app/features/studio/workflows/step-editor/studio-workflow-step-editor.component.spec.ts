import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { CustomEntity } from '../../studio.models';
import {
  StepCatalogEntryDto, WorkflowStepSpec, WorkflowValidationIssueDto
} from '../studio-workflows.models';
import { StudioWorkflowStepEditorComponent } from './studio-workflow-step-editor.component';

function field(key: string, fieldType: CustomFieldType = CustomFieldType.Text, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key, fieldType, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

function entity(id: string, key: string, extra: Partial<CustomEntity> = {}): CustomEntity {
  return {
    id, key, displayName: key, displayNamePlural: key, icon: null, description: null,
    isActive: true, fieldCount: 0, createdAt: '', updatedAt: '', kind: 'Standard', ...extra
  };
}

/** Catalogue minimal : condition (filters + enums + gotoKey), approval (recipient), create_record (entity + fieldMap). */
const CATALOG: StepCatalogEntryDto[] = [
  {
    type: 'condition', label: 'Condition', description: 'Branche selon des filtres.', properties: [
      { name: 'filters', kind: 'filters', required: true, help: '' },
      { name: 'match', kind: 'enum', required: false, help: '', allowedValues: ['all', 'any'] },
      { name: 'onFalse', kind: 'enum', required: false, help: '', allowedValues: ['stop', 'skip', 'goto'] },
      { name: 'gotoKey', kind: 'string', required: false, help: '' }
    ]
  },
  {
    type: 'approval', label: 'Approbation', description: '', properties: [
      { name: 'assignee', kind: 'recipient', required: true, help: '' },
      { name: 'title', kind: 'template', required: true, help: '' }
    ]
  },
  {
    type: 'create_record', label: 'Créer un enregistrement', description: '', properties: [
      { name: 'entity', kind: 'entity', required: true, help: '' },
      { name: 'set', kind: 'fieldMap', required: false, help: '' },
      { name: 'saveResultAs', kind: 'string', required: false, help: '' }
    ]
  }
];

@Component({
  standalone: true,
  imports: [StudioWorkflowStepEditorComponent],
  template: `<app-studio-workflow-step-editor [(step)]="step" [index]="index" [steps]="steps" [catalog]="catalog"
    [fields]="fields" [entities]="entities" [issues]="issues" />`
})
class TestHostComponent {
  step: WorkflowStepSpec = { key: 'cur', type: 'condition', filters: [], match: 'all', onFalse: 'stop' };
  index = 1;
  steps: WorkflowStepSpec[] = [
    { key: 'a', type: 'update_field', label: 'Init' },
    { key: 'cur', type: 'condition', filters: [] },
    { key: 'c', type: 'notify' },
    { key: 'd', type: 'wait' }
  ];
  catalog = CATALOG;
  fields: CustomField[] = [field('montant', CustomFieldType.Number, { label: 'Montant' }), field('statut')];
  entities: CustomEntity[] = [];
  issues: WorkflowValidationIssueDto[] = [];
}

/** Accès typé aux membres protected de l'éditeur (sondage uniquement). */
interface EditorProbe {
  laterSteps(): { label: string; value: string }[];
  targetFields(): CustomField[];
  onEntityChange(key: string | null): void;
}

describe('StudioWorkflowStepEditorComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let probe: EditorProbe;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAdmin: signal(false) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    const editor = fixture.debugElement.query(By.directive(StudioWorkflowStepEditorComponent)).componentInstance;
    probe = editor as unknown as EditorProbe;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('gotoKey ne propose que les étapes postérieures', () => {
    // onFalse = 'stop' (défaut) ⇒ sélecteur gotoKey masqué.
    expect(fixture.debugElement.query(By.css('[data-testid="wf-goto"]'))).toBeNull();

    host.step = { ...host.step, onFalse: 'goto' };
    fixture.detectChanges();

    expect(probe.laterSteps().map(o => o.value)).toEqual(['c', 'd']);            // D-44-04 : postérieures seulement
    expect(probe.laterSteps()[0].label).toBe('c');
    expect(fixture.debugElement.query(By.css('[data-testid="wf-goto"]'))).not.toBeNull();
  });

  it('affiche le message de validation sous la propriété fautive', () => {
    host.issues = [{ path: 'steps[1].filters[0].value', message: 'Valeur requise.' }];
    fixture.detectChanges();

    const filtersProp = fixture.debugElement.query(By.css('[data-testid="wf-prop-filters"]'));
    expect(filtersProp.nativeElement.querySelector('.wf-issue')?.textContent).toContain('Valeur requise.');
    // Pas de message sous une autre propriété ni sous la clé.
    expect(fixture.debugElement.query(By.css('[data-testid="wf-prop-match"]'))?.nativeElement.querySelector('.wf-issue')).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-prop-key"]'))?.nativeElement.querySelector('.wf-issue')).toBeNull();
  });

  it('create_record charge les champs de la table cible par id et normalise fieldType', () => {
    host.entities = [entity('e1', 'devis'), entity('e2', 'clients'), entity('e3', 'liaison', { kind: 'Junction' })];
    host.step = { key: 'cre_1', type: 'create_record', entity: null, set: { montant: '{{montant}}' } };
    host.index = 0;
    host.steps = [host.step];
    fixture.detectChanges();

    probe.onEntityChange('clients');

    const req = httpMock.expectOne(r => r.url === `${environment.apiUrl}/studio/entities/e2/fields`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('includeInactive')).toBe('false');
    // L'API sérialise fieldType en chaîne PascalCase (D-44-14).
    req.flush({
      success: true,
      data: [{ id: 'f1', key: 'total', label: 'Total', fieldType: 'Number', isRequired: false, isUnique: false, sortOrder: 0, rules: null, options: null, relation: null, isActive: true }]
    });
    fixture.detectChanges();

    expect(probe.targetFields().length).toBe(1);
    expect(probe.targetFields()[0].fieldType).toBe(CustomFieldType.Number);      // normalisé numérique
    expect(host.step['entity']).toBe('clients');                                 // D-44-15 : clé de table
    expect(host.step['set']).toBeUndefined();                                    // affectations réinitialisées au changement de table
  });
});
