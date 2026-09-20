import { TestBed } from '@angular/core/testing';
import { StudioWorkflowStatusTagComponent } from './studio-workflow-status-tag.component';
import { WorkflowInstanceStatus, WorkflowSeverity } from './studio-workflows.models';

describe('StudioWorkflowStatusTagComponent', () => {
  const cases: [WorkflowInstanceStatus, string, WorkflowSeverity][] = [
    ['running', 'En cours', 'info'],
    ['waiting', 'En attente', 'warn'],
    ['waiting_approval', 'À valider', 'warn'],
    ['completed', 'Terminé', 'success'],
    ['failed', 'Échec', 'danger'],
    ['cancelled', 'Annulé', 'secondary']
  ];

  it('affiche le libellé FR et la sévérité de chaque statut', () => {
    TestBed.configureTestingModule({ imports: [StudioWorkflowStatusTagComponent] });
    const fixture = TestBed.createComponent(StudioWorkflowStatusTagComponent);

    for (const [status, label, severity] of cases) {
      fixture.componentRef.setInput('status', status);
      fixture.componentRef.setInput('compact', false);
      fixture.detectChanges();
      const tag = fixture.nativeElement.querySelector('p-tag') as HTMLElement;
      expect(tag.getAttribute('data-status')).toBe(status);
      expect(tag.textContent?.trim()).toBe(label);
      expect(tag.className).toContain(`p-tag-${severity}`);
    }

    // Mode compact : icône seule (texte vide), le libellé FR passe en title.
    fixture.componentRef.setInput('status', 'running');
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const tag = fixture.nativeElement.querySelector('p-tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('');
    expect(tag.getAttribute('title')).toBe('En cours');
  });
});
