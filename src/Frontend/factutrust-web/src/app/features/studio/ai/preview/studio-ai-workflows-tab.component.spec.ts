import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StudioPlanSummary } from '../../studio-ai-build.service';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiWorkflowsTabComponent } from './studio-ai-workflows-tab.component';
import { studioAiSpecFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiWorkflowsTabComponent', () => {
  let fixture: ComponentFixture<StudioAiWorkflowsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioAiWorkflowsTabComponent] }).compileComponents();
    fixture = TestBed.createComponent(StudioAiWorkflowsTabComponent);
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Workflows affiche l’état vide quand la spec n’en contient pas', () => {
    fixture.componentRef.setInput('spec', studioAiSpecFixture());
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const empty = host.querySelector('[data-component-id="sai-workflows-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('.fa-route')).not.toBeNull();
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.emptyTitle);
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.emptyHint);
    expect(host.querySelector('.sai-list')).toBeNull();

    // Rendu générique dès qu'un workflow est présent (forme non contractuelle, lue de façon défensive).
    const spec = studioAiSpecFixture();
    spec.entities[1]['workflow'] = { name: 'Validation', steps: ['Soumis', 'Validé', 'Refusé'] };
    fixture.componentRef.setInput('spec', spec);
    fixture.detectChanges();
    expect(host.querySelector('[data-component-id="sai-workflows-empty"]')).toBeNull();
    expect(text()).toContain('Validation');
    expect(text()).toContain('Demande de congé');
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.steps.replace('{count}', '3'));
  });

  it('rend les cartes-chronologies depuis summary.workflows quand la spec est absente', () => {
    fixture.componentRef.setInput('summary', {
      kind: 'Workflow',
      title: 'Validation congés',
      steps: [],
      entities: [{ displayName: 'Congé', fieldCount: 2, relationCount: 0 }],
      warnings: [],
      workflows: [
        {
          key: 'validation-conges', name: 'Validation des congés', trigger: 'on_create', isActive: false,
          stepCount: 2, entityDisplayName: 'Congé',
          steps: [
            { key: 'appro', type: 'approval', label: 'Approbation du manager' },
            { key: 'notif', type: 'notify', label: 'Notifier le salarié' }
          ]
        }
      ]
    } as StudioPlanSummary);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const container = host.querySelector('[data-component-id="sai-workflow-cards"]');
    expect(container).not.toBeNull();
    expect(host.querySelector('[data-component-id="sai-workflows-empty"]')).toBeNull();
    expect(host.querySelector('.sai-list')).withContext('les cartes priment sur la liste issue de la spec').toBeNull();

    const card = host.querySelector('[data-testid="sai-wf-validation-conges"]');
    expect(card).not.toBeNull();
    expect(text()).toContain('Validation des congés');
    expect(text()).toContain('Congé');
    expect(text()).toContain(`${STUDIO_AI_LABELS.workflows.trigger} : ${STUDIO_AI_LABELS.workflows.triggers.on_create}`);
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.steps.replace('{count}', '2'));
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.inactive);
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.inactiveNote);

    const steps = Array.from(card!.querySelectorAll('.sai-wf-step'));
    expect(steps.length).toBe(2);
    expect(steps[0].textContent).toContain('Approbation du manager');
    expect(steps[0].querySelector('.fa-user-check')).withContext('icône du type approval (STEP_TYPE_ICONS)').not.toBeNull();
    expect(steps[0].querySelector('.sai-wf-step__index')?.textContent?.trim()).toBe('1');
    expect(steps[1].querySelector('.fa-bell')).not.toBeNull();
  });

  it('affiche « Planifié » (sans « bientôt ») pour un workflow au déclencheur scheduled — D-47-76', () => {
    fixture.componentRef.setInput('summary', {
      kind: 'Workflow', title: 'Relance', steps: [], entities: [], warnings: [],
      workflows: [{
        key: 'relance', name: 'Relance hebdomadaire', trigger: 'scheduled', isActive: false,
        stepCount: 1, entityDisplayName: 'Facture',
        steps: [{ key: 'notif', type: 'notify', label: 'Notifier le gestionnaire' }]
      }]
    } as StudioPlanSummary);
    fixture.detectChanges();

    expect(STUDIO_AI_LABELS.workflows.triggers.scheduled).toBe('Planifié');
    expect(text()).toContain(`${STUDIO_AI_LABELS.workflows.trigger} : Planifié`);
    expect(text()).not.toContain('bientôt');
  });

  it('affiche l’état vide pour un résumé sans workflow ni étape', () => {
    fixture.componentRef.setInput('summary', {
      kind: 'Workflow', title: 'Validation congés', steps: [], entities: [], warnings: [], workflows: []
    } as StudioPlanSummary);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-component-id="sai-workflow-cards"]')).toBeNull();
    expect(host.querySelector('.sai-list')).toBeNull();
    const empty = host.querySelector('[data-component-id="sai-workflows-empty"]');
    expect(empty).not.toBeNull();
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.emptyTitle);
    expect(text()).toContain(STUDIO_AI_LABELS.workflows.emptyHint);
  });
});
