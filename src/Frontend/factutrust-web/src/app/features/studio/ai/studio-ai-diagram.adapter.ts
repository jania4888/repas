import { STUDIO_AI_LABELS, formatLabel } from './studio-ai-labels';
import { StudioSystemSpec, relationTargetName } from './studio-ai.models';
import {
  COL_WIDTH,
  DiagramEdge,
  DiagramModel,
  DiagramNode,
  PADDING,
  ROW_HEIGHT
} from '../relations/studio-relation-diagram.model';

/** Au-delà, les tables en trop sont omises et remplacées par un nœud « +n ». */
export const SPEC_DIAGRAM_MAX_NODES = 60;

/**
 * Diagramme des relations dérivé d'une spec (`StudioSystemSpec`) — contrat 3.4e, fonction pure :
 * - une entité avec `existingKey` devient un nœud `existing` (table réutilisée), sinon `entity` ;
 * - chaque champ `type: 'relation'` produit une arête `many_to_one` ; sa cible est l'entité de la
 *   spec quand `relationTo` en est un `ref`, sinon un nœud `existing` unique (données ERP) ;
 * - chaque relation racine de `spec.relations[]` (N-N) produit un nœud `junction` libellé
 *   `junctionName ?? \`${from}_${to}\`` + deux arêtes `many_to_many` (dédoublonnées par jonction).
 *
 * Disposition identique à `toDiagram` : grille de 3 colonnes (`COL_WIDTH` × `ROW_HEIGHT`, marge
 * `PADDING`), chaque jonction au milieu exact de ses extrémités. Libellés en texte brut (jamais de
 * HTML).
 */
export function specToDiagram(spec: StudioSystemSpec): DiagramModel {
  const nodes: DiagramNode[] = [];
  let edges: DiagramEdge[] = [];
  const refs = new Set(spec.entities.map(e => e.ref));

  for (const entity of spec.entities) {
    nodes.push({ id: entity.ref, label: entity.displayName, kind: entity.existingKey ? 'existing' : 'entity', x: 0, y: 0 });
  }

  for (const entity of spec.entities) {
    for (const field of entity.fields) {
      if (field.type !== 'relation' || !field.relationTo) continue;
      const target = field.relationTo;
      if (!refs.has(target) && !nodes.some(n => n.id === target)) {
        nodes.push({ id: target, label: relationTargetName(spec, target).name, kind: 'existing', x: 0, y: 0 });
      }
      edges.push({ from: entity.ref, to: target, kind: 'many_to_one', label: field.key });
    }
  }

  const junctionEnds = new Map<string, { from: string; to: string }>();
  for (const rel of spec.relations ?? []) {
    const junctionId = rel.junctionName ?? `${rel.from}_${rel.to}`;
    if (junctionEnds.has(junctionId)) continue;
    junctionEnds.set(junctionId, { from: rel.from, to: rel.to });
    nodes.push({ id: junctionId, label: junctionId, kind: 'junction', x: 0, y: 0 });
    edges.push({ from: rel.from, to: junctionId, kind: 'many_to_many' });
    edges.push({ from: junctionId, to: rel.to, kind: 'many_to_many' });
  }

  if (nodes.length > SPEC_DIAGRAM_MAX_NODES) {
    const kept = nodes.slice(0, SPEC_DIAGRAM_MAX_NODES - 1);
    kept.push({
      id: '__more__',
      label: formatLabel(STUDIO_AI_LABELS.preview.diagramMore, { n: nodes.length - kept.length }),
      kind: 'existing',
      x: 0,
      y: 0
    });
    nodes.length = 0;
    nodes.push(...kept);
    const keptIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to));
  }

  // Disposition : x/y sont des coordonnées de CENTRE (rendu `translate` + rect centré), comme
  // `toDiagram` — tables en grille de 3 colonnes, jonction au milieu exact de ses extrémités.
  const regular = nodes.filter(n => n.kind !== 'junction');
  regular.forEach((node, i) => {
    node.x = PADDING + (i % 3) * COL_WIDTH;
    node.y = PADDING + Math.floor(i / 3) * ROW_HEIGHT;
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const junction of nodes) {
    if (junction.kind !== 'junction') continue;
    const ends = junctionEnds.get(junction.id);
    const source = ends ? byId.get(ends.from) : undefined;
    const target = ends ? byId.get(ends.to) : undefined;
    const sx = source ? source.x : PADDING;
    const sy = source ? source.y : PADDING;
    const tx = target ? target.x : PADDING + COL_WIDTH;
    const ty = target ? target.y : PADDING + ROW_HEIGHT;
    junction.x = (sx + tx) / 2;
    junction.y = (sy + ty) / 2;
  }

  const cols = Math.max(1, Math.min(3, nodes.length || 1));
  const rows = Math.ceil(Math.max(nodes.length, 1) / cols);
  return { nodes, edges, width: cols * COL_WIDTH + PADDING, height: rows * ROW_HEIGHT + PADDING + 60 };
}
