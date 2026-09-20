import type { WorkflowStepSpec, WorkflowStepType } from '../studio-workflows.models';

/**
 * Défauts d'une nouvelle étape (4.4c2) — alignés sur le catalogue serveur
 * (`StudioWorkflowStepTypes.cs` l.40–45, 72–74, 113–121, 138–139) et sur les avertissements
 * `Lint` (`StudioWorkflowStepsSpec.cs` l.326–343 : une approbation sans `dueInHours` déclenche
 * un avertissement ⇒ écrit explicitement à 72 h ; `notify.to` = `startedBy`,
 * `approval.assignee` = rôle `Administrator` — D-44-18). Fichier pur, sans dépendance
 * Angular : partagé entre la liste d'étapes, l'arbre de conditions et les tests.
 */
export const STEP_DEFAULTS: Readonly<Record<WorkflowStepType, Record<string, unknown>>> = {
  condition: { filters: [], match: 'all', onFalse: 'stop' },
  update_field: { set: {} },
  erp_action: { action: null, mapping: [], onFailure: 'fail' },
  notify: { to: { kind: 'startedBy' }, title: '' },
  approval: { assignee: { kind: 'role', value: 'Administrator' }, title: '', dueInHours: 72, onTimeout: 'reject', onReject: 'stop' },
  wait: { hours: 24, maxHours: 720 },
  create_record: { entity: null, set: {} }
};

/** Clé unique `<type>_<n>` (n = 1er entier libre) conforme à STEP_KEY_REGEX (StudioKey.cs l.32) — D-44-18. */
export function nextStepKey(type: WorkflowStepType, existing: readonly WorkflowStepSpec[]): string {
  let n = existing.filter(s => s.type === type).length + 1;
  while (existing.some(s => s.key === `${type}_${n}`)) n++;
  return `${type}_${n}`;
}

/** Nouvelle étape typée : clé unique + copie profonde des défauts du catalogue (jamais de référence partagée). */
export function newStep(type: WorkflowStepType, existing: readonly WorkflowStepSpec[]): WorkflowStepSpec {
  return { key: nextStepKey(type, existing), type, ...structuredClone(STEP_DEFAULTS[type]) };
}

/** Étapes dont le `gotoKey` cible `key` — garde de suppression de la liste d'étapes. */
export function referencingSteps(steps: readonly WorkflowStepSpec[], key: string): WorkflowStepSpec[] {
  return steps.filter(s => s['gotoKey'] === key);
}
