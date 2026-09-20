import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DiagramModel, DiagramNode } from './studio-relation-diagram.model';

/**
 * Diagramme SVG des relations (2.5g1) : `<svg [attr.viewBox]>` en template Angular, `<text>{{ node.label
 * }}</text>` interpolé (échappé — jamais d'`innerHTML` ni de `bypassSecurityTrust*`), `role="img"` +
 * `aria-label`. `size` = 'compact' (page Relations) ou 'full' (réutilisé par 3.4e).
 */
let markerSeq = 0;

@Component({
  selector: 'app-studio-relation-diagram',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (model().nodes.length > 0) {
      <svg class="srd" [class.srd--compact]="size() === 'compact'" [attr.viewBox]="viewBox()" role="img"
        [attr.aria-label]="'Diagramme des relations : ' + model().nodes.length + ' tables'" data-testid="relation-diagram">
        <defs>
          <marker [attr.id]="markerId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="srd__arrow" />
          </marker>
        </defs>
        @for (edge of model().edges; track $index) {
          @if (nodeById(edge.from); as from) {
            @if (nodeById(edge.to); as to) {
              <line class="srd__edge" [attr.x1]="from.x" [attr.y1]="from.y" [attr.x2]="to.x" [attr.y2]="to.y"
                [attr.marker-end]="'url(#' + markerId + ')'" />
            }
          }
        }
        @for (node of model().nodes; track node.id) {
          <g class="srd__node" [class.srd__node--junction]="node.kind === 'junction'" [attr.transform]="'translate(' + node.x + ',' + node.y + ')'">
            @if (node.kind === 'junction') {
              <!-- Boîte jonction élargie (170) : contient les libellés « A × B » usuels. -->
              <rect class="srd__shape srd__shape--junction" x="-85" y="-16" width="170" height="32" rx="4" />
            } @else {
              <rect class="srd__shape" x="-70" y="-20" width="140" height="40" rx="8" />
            }
            <text class="srd__label" text-anchor="middle" dominant-baseline="central">{{ node.label }}</text>
          </g>
        }
      </svg>
    } @else {
      <p class="studio-muted">{{ emptyLabel() }}</p>
    }
  `,
  styles: [`
    .srd { width: 100%; height: auto; min-height: 220px; display: block; }
    .srd--compact { max-height: 20rem; }
    .srd__edge { stroke: var(--color-neutral-400, #94a3b8); stroke-width: 1.5; }
    .srd__arrow { fill: var(--color-neutral-400, #94a3b8); }
    .srd__shape { fill: var(--color-background-elevated, #fff); stroke: var(--color-primary-400, #60a5fa); stroke-width: 1.5; }
    .srd__shape--junction { fill: var(--color-primary-50, #eff6ff); stroke-dasharray: 4 3; }
    .srd__label { fill: var(--color-neutral-700); font-size: 12px; font-weight: 600; pointer-events: none; }
  `]
})
export class StudioRelationDiagramComponent {
  /** Id unique par instance : deux diagrammes sur une même page (3.4e) ne doivent pas se partager `srd-arrow`. */
  protected readonly markerId = `srd-arrow-${++markerSeq}`;
  readonly model = input.required<DiagramModel>();
  readonly size = input<'compact' | 'full'>('full');
  readonly emptyLabel = input('Relations non activées.');

  readonly viewBox = computed(() => `0 0 ${this.model().width} ${this.model().height}`);

  nodeById(id: string): DiagramNode | undefined {
    return this.model().nodes.find(n => n.id === id);
  }

}
