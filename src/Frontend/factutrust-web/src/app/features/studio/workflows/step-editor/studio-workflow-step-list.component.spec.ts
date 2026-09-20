import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Confirmation, ConfirmationService } from '@core/services/confirmation.service';
import {
  StepCatalogEntryDto,
  WORKFLOW_LIMITS,
  WorkflowStepSpec,
  WorkflowValidationIssueDto
} from '../studio-workflows.models';
import { StudioWorkflowStepListComponent } from './studio-workflow-step-list.component';

/** Catalogue minimal : les 7 types serveur (D9), sans propriétés (inutiles pour la liste). */
const CATALOG: StepCatalogEntryDto[] = [
  { type: 'condition', label: 'Condition', description: '', properties: [] },
  { type: 'update_field', label: 'Mettre à jour un champ', description: '', properties: [] },
  { type: 'erp_action', label: 'Action ERP (pont)', description: '', properties: [] },
  { type: 'notify', label: 'Notifier', description: '', properties: [] },
  { type: 'approval', label: 'Approbation', description: '', properties: [] },
  { type: 'wait', label: 'Attendre', description: '', properties: [] },
  { type: 'create_record', label: 'Créer un enregistrement', description: '', properties: [] }
];

@Component({
  standalone: true,
  imports: [StudioWorkflowStepListComponent],
  template: `<app-studio-workflow-step-list [(steps)]="steps" [(selectedIndex)]="selectedIndex"
    [catalog]="catalog" [issues]="issues" [disabled]="disabled" />`
})
class TestHostComponent {
  steps: WorkflowStepSpec[] = [
    { key: 'a', type: 'update_field', label: 'Init' },
    { key: 'b', type: 'notify' },
    { key: 'c', type: 'wait' }
  ];
  selectedIndex: number | null = null;
  catalog = CATALOG;
  issues: WorkflowValidationIssueDto[] = [];
  disabled = false;
}

/** Accès typé aux membres protected de la liste (sondage uniquement). */
interface ListProbe {
  canAdd(): boolean;
}

describe('StudioWorkflowStepListComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let list: StudioWorkflowStepListComponent;
  let confirmSpy: jasmine.Spy;

  beforeEach(async () => {
    confirmSpy = jasmine.createSpy('confirm');
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ConfirmationService, useValue: { confirm: confirmSpy } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    list = fixture.debugElement.query(By.directive(StudioWorkflowStepListComponent)).componentInstance;
    fixture.detectChanges();
  });

  it('ajoute une étape typée avec une clé unique et la sélectionne', () => {
    host.steps = [];
    fixture.detectChanges();

    list.add('approval');
    list.add('approval');
    fixture.detectChanges();

    expect(host.steps.map(s => s.key)).toEqual(['approval_1', 'approval_2']);   // D-44-18 : <type>_<n>
    expect(host.steps[0]['dueInHours']).toBe(72);                               // évite l'avertissement Lint
    expect(host.steps[0]['assignee']).toEqual({ kind: 'role', value: 'Administrator' });
    expect(host.selectedIndex).toBe(1);                                         // dernière ajoutée sélectionnée
    expect(fixture.debugElement.query(By.css('[data-testid="wf-step-add"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-step-approval_1"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="wf-step-approval_2"]'))).not.toBeNull();
  });

  it('monte/descend une étape et suit la sélection', () => {
    list.move(1, -1);                                                           // b monte en tête
    fixture.detectChanges();
    expect(host.steps.map(s => s.key)).toEqual(['b', 'a', 'c']);
    expect(host.selectedIndex).toBe(0);                                         // la sélection suit l'étape

    list.move(0, -1);                                                           // borne haute : sans effet
    expect(host.steps.map(s => s.key)).toEqual(['b', 'a', 'c']);

    list.move(0, 1);                                                            // b redescend
    fixture.detectChanges();
    expect(host.steps.map(s => s.key)).toEqual(['a', 'b', 'c']);
    expect(host.selectedIndex).toBe(1);

    list.move(2, 1);                                                            // borne basse : sans effet
    expect(host.steps.map(s => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('duplique sans reporter gotoKey', () => {
    host.steps = [
      { key: 'cond_montant', type: 'condition', filters: [], match: 'all', onFalse: 'goto', gotoKey: 'c' },
      { key: 'c', type: 'notify' }
    ];
    fixture.detectChanges();

    list.duplicate(0);
    fixture.detectChanges();

    expect(host.steps.length).toBe(3);
    const copy = host.steps[1];                                                 // insérée juste après la source
    expect(copy.key).toBe('condition_2');                                       // prochaine clé libre pour ce type
    expect(copy.key).not.toBe('cond_montant');
    expect(copy['onFalse']).toBe('goto');
    expect(copy['gotoKey']).toBeUndefined();                                    // branchement non recopié
    expect(host.selectedIndex).toBe(1);
  });

  it('demande confirmation avant de supprimer une étape référencée par un gotoKey et nettoie la référence', () => {
    confirmSpy.and.callFake((c: Confirmation) => c.accept?.());
    host.steps = [
      { key: 'a', type: 'condition', onFalse: 'goto', gotoKey: 'b' },
      { key: 'b', type: 'notify' },
      { key: 'd', type: 'wait' }
    ];
    fixture.detectChanges();

    list.remove(1);                                                             // « b » est la cible du gotoKey de « a »
    fixture.detectChanges();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const arg = confirmSpy.calls.mostRecent().args[0] as Confirmation;
    expect(arg.header).toBe('Supprimer l\'étape ?');
    expect(arg.message).toContain('« b »');
    expect(arg.message).toContain('a');                                         // étape(s) référente(s) citée(s)
    expect(host.steps.map(s => s.key)).toEqual(['a', 'd']);
    expect(host.steps[0]['gotoKey']).toBeUndefined();                           // référence nettoyée
    expect(host.selectedIndex).toBe(1);                                         // min(1, length - 1)

    confirmSpy.calls.reset();
    list.remove(0);                                                             // « a » n'est plus référencée : suppression directe
    expect(confirmSpy).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(host.steps.map(s => s.key)).toEqual(['d']);
    expect(host.selectedIndex).toBe(0);
  });

  it('bloque l\'ajout à 30 étapes et affiche le compteur', () => {
    host.steps = Array.from({ length: WORKFLOW_LIMITS.maxSteps }, (_, i): WorkflowStepSpec => ({ key: `s_${i}`, type: 'notify' }));
    fixture.detectChanges();

    const probe = list as unknown as ListProbe;
    expect(probe.canAdd()).toBeFalse();
    list.add('notify');                                                         // refusé : canAdd() = false
    fixture.detectChanges();
    expect(host.steps.length).toBe(WORKFLOW_LIMITS.maxSteps);

    const addBtn = fixture.debugElement.query(By.css('[data-testid="wf-step-add"]')).nativeElement as HTMLButtonElement;
    expect(addBtn.disabled).toBeTrue();
    expect(fixture.debugElement.nativeElement.textContent).toContain(`${WORKFLOW_LIMITS.maxSteps}/${WORKFLOW_LIMITS.maxSteps}`);
  });
});
