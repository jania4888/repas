import { StudioPlanSummary } from '../../studio-ai-build.service';

/** La casse de `kind` est tolérée (`'Workflow'` / `'workflow'` — contrat figé A-43/A-44b). */
export function isWorkflowPlanKind(kind: string | null | undefined): boolean {
  return (kind ?? '').toLowerCase() === 'workflow';
}

/** Carte de l'onglet « Workflow » de l'aperçu (4.4k1) : frise d'étapes construite depuis le résumé. */
export interface StudioAiWorkflowCard {
  id: string;
  name: string;
  trigger: string | null;
  isActive: boolean | null;
  entityName: string | null;
  steps: { key: string; label: string; type: string | null }[];
}

/**
 * Cartes de l'onglet Workflow : `summary.workflows[]` (contrat), sinon une carte de repli bâtie
 * sur `summary.steps[]` (D-44-67 : une seule carte, titre du plan — le contrat garantit
 * `workflows[]` toujours présent pour un plan Workflow, le repli n'est qu'un mode dégradé).
 */
export function workflowCardsFromSummary(summary: StudioPlanSummary | null | undefined): StudioAiWorkflowCard[] {
  if (!summary) return [];
  const fallbackEntity = summary.entities?.[0]?.displayName ?? null; // D-43-05 : table cible (`existingKey`)
  const list = Array.isArray(summary.workflows) ? summary.workflows : [];
  if (list.length) {
    return list.map((w, i) => ({
      id: w.key || `wf-${i}`,
      name: w.name || w.key,
      trigger: w.trigger ?? null,
      isActive: w.isActive ?? null,
      // D-44-69 (Q-1) : `entityDisplayName ?? entities[0].displayName`, masqué si vide.
      entityName: w.entityDisplayName?.trim() || fallbackEntity || null,
      steps: (w.steps ?? []).map((s, j) => ({ key: s.key || `s-${j}`, label: s.label || s.key, type: s.type ?? null }))
    }));
  }
  if (!isWorkflowPlanKind(summary.kind) || !summary.steps?.length) return [];
  return [{
    id: 'summary',
    name: summary.title || 'Workflow',
    trigger: null,
    isActive: null,
    entityName: fallbackEntity,
    steps: summary.steps.map(s => ({ key: s.key, label: s.label, type: null }))
  }];
}
