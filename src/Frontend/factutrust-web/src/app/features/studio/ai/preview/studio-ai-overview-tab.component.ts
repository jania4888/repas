import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { STUDIO_SPEC_LIMITS, StudioSpecCounters, StudioSystemSpec } from '../studio-ai.models';
import { specToDiagram } from '../studio-ai-diagram.adapter';
import { counterChips } from '../studio-ai-spec.util';
import { StudioRelationDiagramComponent } from '../../relations/studio-relation-diagram.component';

/** Une entité de l'arbre « Structure du système ». */
interface StudioAiOverviewNode {
  ref: string;
  displayName: string;
  icon: string;
  fieldCount: number;
  relationCount: number;
}

/**
 * Onglet « Vue d'ensemble » (lecture, P1a) : arbre des tables à gauche, compteurs et points à
 * vérifier à droite.
 *
 * Le diagramme des relations (3.4e) est dérivé de la spec par `specToDiagram` ; il est décrit en
 * texte (`sr-only`) pour les lecteurs d'écran et détaillé dans l'onglet Relations.
 */
@Component({
  selector: 'app-studio-ai-overview-tab',
  standalone: true,
  imports: [StudioRelationDiagramComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-grid">
      <div>
        <div class="sai-block__head">{{ labels.structure }}</div>
        @if (!nodes().length) {
          <p class="sai-hint">{{ labels.noEntities }}</p>
        } @else {
          <ul class="sai-list">
            @for (node of nodes(); track node.ref) {
              <li>
                <button type="button" class="sai-list__item" (click)="openEntity.emit(node.ref)">
                  <i [class]="node.icon" aria-hidden="true"></i>
                  <span>{{ node.displayName }}</span>
                  <span class="sai-list__meta">
                    {{ node.fieldCount }} {{ labels.fields }}
                    @if (node.relationCount) {
                      · {{ node.relationCount }} {{ labels.relations }}
                    }
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div>
        <div class="sai-block__head">{{ labels.summary }}</div>
        <div class="sai-cards">
          @for (card of cards(); track card.label) {
            <div class="sai-card">
              <div class="sai-card__num">{{ card.value }}</div>
              <div class="sai-card__lbl">{{ card.label }}</div>
            </div>
          }
        </div>

        <div class="sai-block" style="margin-top: var(--spacing-4, 1rem)">
          <div class="sai-block__head">{{ labels.diagram }}</div>
          <app-studio-relation-diagram [model]="diagram()" size="compact" [emptyLabel]="labels.noRelations" />
          @if (diagramDescription()) {
            <p class="sr-only">{{ diagramDescription() }}</p>
          }
        </div>

        <p class="sai-hint">{{ limitsHint }}</p>
      </div>
    </div>

    <div class="sai-block" style="margin-top: var(--spacing-4, 1rem)">
      <div class="sai-block__head">{{ warnings().length }} {{ labels.warningsTitle }}</div>
      @if (!warnings().length) {
        <p class="sai-hint">{{ labels.noWarnings }}</p>
      } @else {
        <ul class="sai-list">
          @for (warning of warnings(); track warning) {
            <li class="sai-list__item sai-list__item--static">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              <span>{{ warning }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `
})
export class StudioAiOverviewTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  readonly counters = input.required<StudioSpecCounters>();
  readonly warnings = input<string[]>([]);

  /** `ref` de la table cliquée : la page bascule sur l'onglet Tables et l'y sélectionne. */
  readonly openEntity = output<string>();

  readonly labels = STUDIO_AI_LABELS.preview;
  readonly limitsHint = formatLabel(STUDIO_AI_LABELS.preview.limitsTemplate, {
    maxEntities: STUDIO_SPEC_LIMITS.maxEntities,
    maxFields: STUDIO_SPEC_LIMITS.maxFields,
    maxSeedRecords: STUDIO_SPEC_LIMITS.maxSeedRecords
  });

  readonly nodes = computed<StudioAiOverviewNode[]>(() =>
    this.spec().entities.map(entity => ({
      ref: entity.ref,
      displayName: entity.displayName,
      icon: entity.icon || 'fa-solid fa-table',
      fieldCount: entity.fields.length,
      relationCount: entity.fields.filter(f => f.type === 'relation').length
    }))
  );

  readonly cards = computed(() => counterChips(this.counters()));

  /** Diagramme des relations dérivé de la spec (3.4e). */
  readonly diagram = computed(() => specToDiagram(this.spec()));

  /** Description textuelle « A → B (kind) » du diagramme (le SVG est restitué comme une image). */
  readonly diagramDescription = computed(() => {
    const model = this.diagram();
    const labelOf = (id: string): string => model.nodes.find(n => n.id === id)?.label ?? id;
    return model.edges
      .map(e => formatLabel(STUDIO_AI_LABELS.preview.diagramEdge, { from: labelOf(e.from), to: labelOf(e.to), kind: e.kind }))
      .join(' ; ');
  });
}
