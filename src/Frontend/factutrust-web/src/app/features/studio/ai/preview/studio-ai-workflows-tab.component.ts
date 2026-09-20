import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { StudioPlanSummary } from '../../studio-ai-build.service';
import { STEP_TYPE_ICONS } from '../../workflows/studio-workflow-labels';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioSystemSpec } from '../studio-ai.models';
import { workflowCardsFromSummary } from './studio-ai-workflow-summary.util';

/** Workflow lu de façon défensive (`spec.workflows[]` ou `entity.workflow`), forme non contractuelle avant 4.x. */
export interface StudioAiWorkflowRow {
  id: string;
  name: string;
  entityName: string;
  steps: number | null;
}

/**
 * Onglet « Workflows » de l'aperçu : cartes-chronologies construites depuis `summary.workflows[]`
 * (contrat 4.3c, 4.4k1) quand le résumé en porte ; sinon rendu générique (nom, table, nombre
 * d'étapes) si la spec contient `workflows[]` / `entity.workflow` ; état vide en dernier recours.
 * `spec` est optionnel : un plan `Workflow` n'a pas de `StudioSystemSpec` (D12).
 */
@Component({
  selector: 'app-studio-ai-workflows-tab',
  standalone: true,
  imports: [TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-body">
      @if (cards().length) {
        <div class="sai-wf-cards" data-component-id="sai-workflow-cards">
          @for (card of cards(); track card.id) {
            <article class="sai-wf-card" [attr.data-testid]="'sai-wf-' + card.id">
              <header class="sai-wf-card__head">
                <i class="fa-solid fa-route" aria-hidden="true"></i>
                <div>
                  <strong>{{ card.name }}</strong>
                  <div class="sai-wf-card__meta">
                    @if (card.entityName) { <span class="sai-code">{{ card.entityName }}</span> }
                    @if (card.trigger) { <span>{{ labels.trigger }} : {{ triggerLabel(card.trigger) }}</span> }
                    <span>{{ stepsLabel(card.steps.length) }}</span>
                  </div>
                </div>
                <p-tag [severity]="card.isActive ? 'success' : 'secondary'" [value]="card.isActive ? labels.active : labels.inactive" />
              </header>
              <ol class="sai-wf-steps">
                @for (step of card.steps; track step.key; let i = $index) {
                  <li class="sai-wf-step">
                    <span class="sai-wf-step__index">{{ i + 1 }}</span>
                    <i [class]="stepIcon(step.type)" aria-hidden="true"></i>
                    <span>{{ step.label }}</span>
                    @if (step.type) { <span class="sai-code">{{ step.type }}</span> }
                  </li>
                }
              </ol>
            </article>
          }
          <p class="sai-wf-note studio-muted"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> {{ labels.inactiveNote }}</p>
        </div>
      } @else if (workflows().length) {
        <ul class="sai-list">
          @for (workflow of workflows(); track workflow.id) {
            <li class="sai-list__item sai-list__item--static">
              <i class="fa-solid fa-route" aria-hidden="true"></i>
              <span>{{ workflow.name }}</span>
              <span class="sai-code">{{ workflow.entityName }}</span>
              @if (workflow.steps !== null) {
                <span class="sai-list__meta">{{ stepsLabel(workflow.steps) }}</span>
              }
            </li>
          }
        </ul>
      } @else {
        <div class="sai-empty" data-component-id="sai-workflows-empty">
          <span class="sai-empty__icon" aria-hidden="true"><i class="fa-solid fa-route"></i></span>
          <strong>{{ labels.emptyTitle }}</strong>
          <span>{{ labels.emptyHint }}</span>
        </div>
      }
    </div>
  `
})
export class StudioAiWorkflowsTabComponent {
  /** Spec détaillée ; absente pour un plan `Workflow` (les cartes viennent alors du résumé). */
  readonly spec = input<StudioSystemSpec | null>(null);
  /** Résumé du plan (`summary.workflows[]`, contrat figé A-43/A-44b). */
  readonly summary = input<StudioPlanSummary | null>(null);

  readonly labels = STUDIO_AI_LABELS.workflows;
  /** A-44a 4.4a1 (pas de doublon `stepIcons` dans STUDIO_AI_LABELS, D-44-09/D-44-86). */
  readonly stepTypeIcons: Readonly<Record<string, string>> = STEP_TYPE_ICONS;

  readonly cards = computed(() => workflowCardsFromSummary(this.summary()));

  stepsLabel(count: number): string {
    return this.labels.steps.replace('{count}', String(count));
  }

  triggerLabel(t: string | null): string {
    return t ? (this.labels.triggers as Record<string, string>)[t] ?? t : '';
  }

  /** D-44-86 : type hors enum ⇒ icône neutre `fa-solid fa-circle-dot`. */
  stepIcon(t: string | null): string {
    return (t && this.stepTypeIcons[t]) || 'fa-solid fa-circle-dot';
  }

  readonly workflows = computed<StudioAiWorkflowRow[]>(() => {
    const spec = this.spec();
    if (!spec) return [];
    const rows: StudioAiWorkflowRow[] = [];
    const root = spec['workflows'];
    if (Array.isArray(root)) {
      root.forEach((raw, index) => {
        const row = this.toRow(raw, `root:${index}`, spec);
        if (row) rows.push(row);
      });
    }
    for (const entity of spec.entities) {
      const row = this.toRow(entity['workflow'], `entity:${entity.ref}`, spec, entity.displayName);
      if (row) rows.push(row);
    }
    return rows;
  });

  private toRow(raw: unknown, id: string, spec: StudioSystemSpec, fallbackEntity = ''): StudioAiWorkflowRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const name = this.str(record['name']) ?? this.str(record['displayName']) ?? this.str(record['key']) ?? this.labels.title;
    const entityRef = this.str(record['entity']) ?? this.str(record['entityRef']) ?? this.str(record['table']);
    const entity = entityRef ? spec.entities.find(e => e.ref === entityRef) : undefined;
    const steps = record['steps'] ?? record['states'] ?? record['statuses'];
    return {
      id,
      name,
      entityName: entity?.displayName ?? entityRef ?? fallbackEntity,
      steps: Array.isArray(steps) ? steps.length : null
    };
  }

  private str(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  }
}
