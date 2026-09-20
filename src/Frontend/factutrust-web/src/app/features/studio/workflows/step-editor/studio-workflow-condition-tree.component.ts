import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TreeNode } from 'primeng/api';
import { TreeModule } from 'primeng/tree';
import { STUDIO_WORKFLOW_LABELS, STEP_TYPE_ICONS } from '../studio-workflow-labels';
import { WorkflowStepSpec } from '../studio-workflows.models';
import { STEP_DEFAULTS } from './studio-workflow-step-defaults';

/** Libellés FR locaux de l'arbre : absents de `STUDIO_WORKFLOW_LABELS` (4.4a1, non modifié dans cette tranche). */
const TREE_LABELS = {
  trigger: 'Déclenchement',
  onTrue: 'Vrai',
  onFalse: 'Faux',
  approved: 'Approuvé',
  rejected: 'Refusé',
  timeout: 'Délai',
  nextStep: 'étape suivante',
  treeAria: 'Aperçu des branchements (lecture seule)'
} as const;

function asText(value: unknown): string { return typeof value === 'string' ? value : ''; }

/**
 * Feuille d'un branchement : `goto` ⇒ « Préfixe → <gotoKey> » (flèche), `stop` ⇒ icône stop,
 * `skip` ⇒ « Ignorer » (`L.outcomes`) ; sinon le libellé `enumValues` de la valeur.
 */
function outcomeLeaf(prefix: string, value: string, step: WorkflowStepSpec, dict: Readonly<Partial<Record<string, string>>>): TreeNode {
  if (value === 'goto') {
    return { label: `${prefix} → ${asText(step['gotoKey']) || '…'}`, icon: 'fa-solid fa-arrow-turn-down', leaf: true };
  }
  if (value === 'stop') {
    return { label: `${prefix} → ${dict['stop'] ?? STUDIO_WORKFLOW_LABELS.outcomes.stop}`, icon: 'fa-solid fa-stop', leaf: true };
  }
  if (value === 'skip') {
    return { label: `${prefix} → ${STUDIO_WORKFLOW_LABELS.outcomes.skip}`, leaf: true };
  }
  return { label: `${prefix} → ${dict[value] ?? value}`, leaf: true };
}

/** Nœud d'une étape : une `condition` a 2 enfants (Vrai/Faux), une `approval` 3 (Approuvé/Refusé/Délai). */
function stepNode(step: WorkflowStepSpec): TreeNode {
  const node: TreeNode = {
    label: step.label || step.key,
    icon: STEP_TYPE_ICONS[step.type],
    expanded: true,
    leaf: true,
    data: { key: step.key, type: step.type }
  };
  const L = STUDIO_WORKFLOW_LABELS;
  if (step.type === 'condition') {
    node.leaf = false;
    node.children = [
      { label: `${TREE_LABELS.onTrue} → ${TREE_LABELS.nextStep}`, leaf: true },
      outcomeLeaf(TREE_LABELS.onFalse, asText(step['onFalse']) || (STEP_DEFAULTS.condition['onFalse'] as string), step, L.enumValues.onFalse)
    ];
  } else if (step.type === 'approval') {
    node.leaf = false;
    node.children = [
      { label: `${TREE_LABELS.approved} → ${TREE_LABELS.nextStep}`, leaf: true },
      outcomeLeaf(TREE_LABELS.rejected, asText(step['onReject']) || (STEP_DEFAULTS.approval['onReject'] as string), step, L.enumValues.onReject),
      outcomeLeaf(TREE_LABELS.timeout, asText(step['onTimeout']) || (STEP_DEFAULTS.approval['onTimeout'] as string), step, L.enumValues.onTimeout)
    ];
  }
  return node;
}

/** Arbre : racine « Déclenchement » puis les étapes dans l'ordre ; tous les nœuds sont expansés. */
function buildTree(steps: readonly WorkflowStepSpec[]): TreeNode[] {
  const children = steps.map(s => stepNode(s));
  return [{ label: TREE_LABELS.trigger, icon: 'fa-solid fa-play', expanded: true, leaf: children.length === 0, children }];
}

/**
 * Aperçu arborescent en lecture seule des branchements d'un workflow (4.4c2 — maquette
 * `d44-workflows-designer-condition.html`) : `condition` → onFalse, `approval` → onReject /
 * onTimeout. Première utilisation de `primeng/tree` dans l'application (D-44-22) : pour rester
 * hors du bundle initial, ce composant ne doit être chargé que via `@defer` par le concepteur
 * (4.4e1) — jamais dans un `imports: []` eager (sinon Angular requalifie la dépendance).
 */
@Component({
  selector: 'app-studio-workflow-condition-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeModule],
  template: `
    <p-tree [value]="nodes()" styleClass="studio-theme wf-tree" [attr.aria-label]="treeLabels.treeAria" data-testid="wf-condition-tree" />
  `,
  styles: [`
    :host { display: block; }
    :host ::ng-deep .wf-tree { border: 1px dashed var(--color-primary-200); border-radius: var(--radius-md, 8px); background: var(--color-neutral-50, #f8fafc); font-size: .8125rem; padding: .25rem .5rem; }
  `]
})
export class StudioWorkflowConditionTreeComponent {
  readonly steps = input.required<WorkflowStepSpec[]>();

  protected readonly treeLabels = TREE_LABELS;
  protected readonly nodes = computed<TreeNode[]>(() => buildTree(this.steps()));
}
