import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioSystemSpec, relationTargetName } from '../studio-ai.models';
import { specToDiagram } from '../studio-ai-diagram.adapter';
import { StudioRelationDiagramComponent } from '../../relations/studio-relation-diagram.component';

/** Une ligne du tableau des relations, dérivée d'un champ `type: 'relation'`. */
interface StudioAiRelationRow {
  sourceRef: string;
  sourceName: string;
  fieldKey: string;
  fieldLabel: string;
  targetRef: string;
  targetName: string;
  erp: boolean;
  cardinality: string;
}

/**
 * Onglet « Relations » (lecture, P1a) : diagramme dérivé de la spec (3.4e, inclut les jonctions
 * N-N de `spec.relations[]`) au-dessus du tableau dérivé des champs `relation` de la spec.
 *
 * Les cibles ERP (`clients`, `products`) portent un badge : ce sont des données existantes de l'ERP,
 * pas des tables créées par le plan. La colonne « À la suppression de la cible » des maquettes est
 * omise (absente de la spec canonique P0).
 */
@Component({
  selector: 'app-studio-ai-relations-tab',
  standalone: true,
  imports: [TagModule, StudioRelationDiagramComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    @if (!rows().length) {
      <p class="sai-hint">{{ labels.noRelations }}</p>
    } @else {
      <app-studio-relation-diagram [model]="diagram()" size="full" [emptyLabel]="labels.noRelations" />
      <div class="sai-table__scroll">
        <table class="sai-table">
          <caption class="sai-hint" style="caption-side: top; text-align: left">
            {{ rows().length }} {{ labels.relations }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ labels.colSource }}</th>
              <th scope="col">{{ labels.colField }}</th>
              <th scope="col">{{ labels.colTarget }}</th>
              <th scope="col">{{ labels.colType }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.sourceRef + '.' + row.fieldKey) {
              <tr>
                <td>{{ row.sourceName }}<div class="sai-code">{{ row.sourceRef }}</div></td>
                <td>{{ row.fieldLabel }}<div class="sai-code">{{ row.fieldKey }}</div></td>
                <td>
                  {{ row.targetName }}
                  @if (row.erp) {
                    <p-tag class="sai-soon" severity="info" [value]="labels.erpBadge" />
                  }
                </td>
                <td class="sai-hint">{{ row.cardinality }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (erpRows().length) {
        <div class="sai-block" style="margin-top: var(--spacing-4, 1rem)">
          <div class="sai-block__head">{{ labels.erpRelations }}</div>
          <ul class="sai-list">
            @for (row of erpRows(); track row.sourceRef + '.' + row.fieldKey) {
              <li class="sai-list__item sai-list__item--static">
                <i class="fa-solid fa-link" aria-hidden="true"></i>
                <span>{{ row.sourceName }} · {{ row.fieldLabel }} → {{ row.targetName }}</span>
                <span class="sai-list__meta">{{ labels.existingData }}</span>
              </li>
            }
          </ul>
        </div>
      }
    }
  `
})
export class StudioAiRelationsTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** Réservé à P1b : l'onglet reste en lecture seule en P1a. */
  readonly editable = input(false);

  readonly labels = STUDIO_AI_LABELS.preview;

  /** Diagramme des relations dérivé de la spec (3.4e) : champs `relation` + jonctions N-N. */
  readonly diagram = computed(() => specToDiagram(this.spec()));

  readonly rows = computed<StudioAiRelationRow[]>(() => {
    const spec = this.spec();
    const rows: StudioAiRelationRow[] = [];
    for (const entity of spec.entities) {
      for (const field of entity.fields) {
        if (field.type !== 'relation') continue;
        const targetRef = field.relationTo ?? '';
        const { name: targetName, erp } = relationTargetName(spec, targetRef);
        rows.push({
          sourceRef: entity.ref,
          sourceName: entity.displayName,
          fieldKey: field.key,
          fieldLabel: field.label,
          targetRef,
          targetName: targetName || '—',
          erp,
          cardinality: formatLabel(STUDIO_AI_LABELS.preview.cardinality, {
            source: entity.displayNamePlural || entity.displayName,
            target: targetName || targetRef
          })
        });
      }
    }
    return rows;
  });

  readonly erpRows = computed(() => this.rows().filter(r => r.erp));
}
