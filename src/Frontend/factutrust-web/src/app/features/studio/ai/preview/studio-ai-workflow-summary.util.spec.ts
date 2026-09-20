import { StudioPlanSummary } from '../../studio-ai-build.service';
import { isWorkflowPlanKind, workflowCardsFromSummary } from './studio-ai-workflow-summary.util';

function summary(over: Partial<StudioPlanSummary> = {}): StudioPlanSummary {
  return {
    kind: 'Workflow',
    title: 'Validation congés',
    steps: [],
    entities: [],
    warnings: [],
    ...over
  } as StudioPlanSummary;
}

describe('studio-ai-workflow-summary.util', () => {
  it('construit une carte par workflow du résumé avec ses étapes et son déclencheur', () => {
    const cards = workflowCardsFromSummary(summary({
      entities: [{ displayName: 'Devis', fieldCount: 4, relationCount: 0, existingKey: 'devis' }],
      workflows: [
        {
          key: 'validation-devis', name: 'Validation devis', trigger: 'on_update', isActive: false,
          stepCount: 9, // ignoré : seul `steps.length` compte pour la frise
          entityDisplayName: 'Devis',
          steps: [
            { key: 'cond', type: 'condition', label: 'Montant > 10 k€' },
            { key: 'appro', type: 'approval', label: 'Approbation direction' },
            { key: 'notif', type: 'notify', label: 'Notifier le commercial' }
          ]
        },
        {
          key: 'relance', name: 'Relance facture', trigger: 'manual', isActive: true, stepCount: 1,
          steps: [{ key: 'mail', type: 'notify', label: 'Envoyer la relance' }]
        }
      ]
    }));

    expect(cards.length).toBe(2);
    expect(cards[0].id).toBe('validation-devis');
    expect(cards[0].name).toBe('Validation devis');
    expect(cards[0].trigger).toBe('on_update');
    expect(cards[0].isActive).toBeFalse();
    expect(cards[0].entityName).toBe('Devis');
    expect(cards[0].steps.length).withContext('stepCount ignoré au profit de steps.length').toBe(3);
    expect(cards[0].steps[1]).toEqual({ key: 'appro', label: 'Approbation direction', type: 'approval' });
    expect(cards[1].isActive).toBeTrue();
    expect(cards[1].entityName).withContext('repli sur entities[0].displayName (D-44-69)').toBe('Devis');
  });

  it('se replie sur summary.steps pour un plan workflow sans workflows[] et renvoie vide sinon', () => {
    // Casse tolérée : 'workflow' minuscule accepté (contrat figé).
    expect(isWorkflowPlanKind('workflow')).toBeTrue();
    expect(isWorkflowPlanKind('Workflow')).toBeTrue();
    expect(isWorkflowPlanKind('CreateSystem')).toBeFalse();
    expect(isWorkflowPlanKind(null)).toBeFalse();

    const fallback = workflowCardsFromSummary(summary({
      kind: 'workflow',
      title: 'Circuit congés',
      entities: [{ displayName: 'Congé', fieldCount: 2, relationCount: 0 }],
      steps: [{ key: 's1', label: 'Soumettre', detail: '' }, { key: 's2', label: 'Valider', detail: '' }]
    }));
    expect(fallback.length).withContext('une seule carte de repli (D-44-67)').toBe(1);
    expect(fallback[0].id).toBe('summary');
    expect(fallback[0].name).toBe('Circuit congés');
    expect(fallback[0].trigger).toBeNull();
    expect(fallback[0].entityName).toBe('Congé');
    expect(fallback[0].steps).toEqual([
      { key: 's1', label: 'Soumettre', type: null },
      { key: 's2', label: 'Valider', type: null }
    ]);

    expect(workflowCardsFromSummary(summary({ kind: 'CreateSystem', steps: [{ key: 's1', label: 'x', detail: '' }] })))
      .withContext('pas de repli hors plan workflow').toEqual([]);
    expect(workflowCardsFromSummary(summary({ workflows: [] })))
      .withContext('ni workflows ni étapes ⇒ vide').toEqual([]);
    expect(workflowCardsFromSummary(null)).toEqual([]);
  });
});
