import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { TreeNode } from 'primeng/api';
import { WorkflowStepSpec } from '../studio-workflows.models';
import { StudioWorkflowConditionTreeComponent } from './studio-workflow-condition-tree.component';

@Component({
  standalone: true,
  imports: [StudioWorkflowConditionTreeComponent],
  template: `<app-studio-workflow-condition-tree [steps]="steps" />`
})
class TestHostComponent {
  steps: WorkflowStepSpec[] = [];
}

/** Accès typé aux membres protected de l'arbre (sondage uniquement). */
interface TreeProbe {
  nodes(): TreeNode[];
}

describe('StudioWorkflowConditionTreeComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let probe: TreeProbe;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    probe = fixture.debugElement.query(By.directive(StudioWorkflowConditionTreeComponent)).componentInstance as unknown as TreeProbe;
    fixture.detectChanges();
  });

  it('construit deux branches pour une condition avec onFalse = goto', () => {
    host.steps = [
      { key: 'cond_1', type: 'condition', filters: [], match: 'all', onFalse: 'goto', gotoKey: 'approval_1' },
      { key: 'approval_1', type: 'approval' }
    ];
    fixture.detectChanges();

    const root = probe.nodes()[0];
    expect(root.label).toBe('Déclenchement');
    expect(root.expanded).toBeTrue();
    expect(root.children?.length).toBe(2);

    const cond = root.children![0];
    expect(cond.label).toBe('cond_1');                                          // label || key
    expect(cond.children?.length).toBe(2);                                      // Vrai / Faux
    expect(cond.children![0].label).toContain('Vrai');
    const faux = cond.children![1];
    expect(faux.label).toContain('→ approval_1');                               // feuille goto
    expect(faux.icon).toBe('fa-solid fa-arrow-turn-down');
    expect(faux.leaf).toBeTrue();

    const appr = root.children![1];
    expect(appr.children?.length).toBe(3);                                      // Approuvé / Refusé / Délai
    expect(appr.children![0].label).toContain('Approuvé');
    expect(appr.children![1].label).toContain('Arrêter');                       // onReject = stop (défaut catalogue)
    expect(appr.children![1].icon).toBe('fa-solid fa-stop');
    expect(appr.children![2].label).toContain('Refuser');                       // onTimeout = reject (défaut catalogue)

    expect(fixture.debugElement.query(By.css('[data-testid="wf-condition-tree"]'))).not.toBeNull();
  });

  it('rend une chaîne linéaire pour des étapes sans branchement', () => {
    host.steps = [
      { key: 'a', type: 'update_field', label: 'Init' },
      { key: 'b', type: 'notify' },
      { key: 'c', type: 'wait' }
    ];
    fixture.detectChanges();

    const root = probe.nodes()[0];
    expect(root.children?.length).toBe(3);
    expect(root.children!.map(n => n.label)).toEqual(['Init', 'b', 'c']);       // label || key
    expect(root.children!.every(n => !n.children?.length)).toBeTrue();          // aucune branche
    expect(root.children!.every(n => !!n.icon)).toBeTrue();                     // icône du type d'étape
    expect(root.children!.map(n => n.icon)).toEqual([
      'fa-solid fa-pen-to-square', 'fa-solid fa-bell', 'fa-solid fa-hourglass-half'
    ]);
  });
});
