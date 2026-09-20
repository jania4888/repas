import { CustomEntity } from '../studio.models';
import { EntityRelationDto, EntityRelationKind } from './studio-relations.models';

/** Nœud du diagramme de relations (2.5g). */
export interface DiagramNode {
  id: string;
  label: string;
  kind: 'entity' | 'junction' | 'existing';
  x: number;
  y: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  kind: EntityRelationKind;
  label?: string;
}

export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

// ≥ largeur nœud entité (140) + ~largeur d'un libellé de jonction (« Intervention × Technicien »
// ≈ 170px à 12px) + marge : la jonction est placée au milieu de deux colonnes adjacentes et son
// libellé ne doit empiéter sur aucune des deux boîtes.
export const COL_WIDTH = 340;
export const ROW_HEIGHT = 120;
// ≥ demi-largeur d'un nœud entité (140/2 = 70) pour que la première colonne ne soit pas
// rognée par le bord gauche du viewBox (les coordonnées sont des centres, voir le rendu
// `translate(x, y)` + `rect x="-70"` du composant).
export const PADDING = 80;

/**
 * Modèle de diagramme des relations Studio (contrat consommé par 3.4e : `specToDiagram` produit le
 * même `DiagramModel`). Placement en grille par colonnes (entités), chaque jonction N-N est un nœud
 * losange inséré entre ses deux extrémités, relié par deux arêtes `many_to_many`. Les N-N sont
 * dédoublonnées par `junctionEntityId`. Aucune donnée HTML : les libellés restent du texte brut.
 */
export function toDiagram(entities: CustomEntity[], relations: EntityRelationDto[]): DiagramModel {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const byId = new Map(entities.map(e => [e.id, e]));

  const regular = entities.filter(e => e.kind !== 'Junction');
  regular.forEach((e, i) => {
    nodes.push({ id: e.id, label: e.displayName, kind: 'entity', x: PADDING + (i % 3) * COL_WIDTH, y: PADDING + Math.floor(i / 3) * ROW_HEIGHT });
  });

  const seenJunctions = new Set<string>();
  let junctionCount = 0;
  for (const rel of relations) {
    if (rel.kind !== 'many_to_many') continue;
    const jId = rel.junctionEntityId;
    if (jId) {
      if (seenJunctions.has(jId)) continue;
      seenJunctions.add(jId);
    }
    const junctionEntity = jId ? byId.get(jId) : undefined;
    const nodeId = jId ?? `virtual-${junctionCount}`;
    const source = byId.get(rel.sourceEntityId);
    const target = byId.get(rel.targetEntityId);
    const sx = source ? PADDING + (regular.indexOf(source) % 3) * COL_WIDTH : PADDING;
    const sy = source ? PADDING + Math.floor(regular.indexOf(source) / 3) * ROW_HEIGHT : PADDING;
    const tx = target ? PADDING + (regular.indexOf(target) % 3) * COL_WIDTH : PADDING + COL_WIDTH;
    const ty = target ? PADDING + Math.floor(regular.indexOf(target) / 3) * ROW_HEIGHT : PADDING + ROW_HEIGHT;
    nodes.push({
      id: nodeId,
      label: junctionEntity?.displayName ?? rel.junctionEntityKey ?? 'Jonction',
      kind: 'junction',
      // x/y sont des coordonnées de CENTRE (rendu `translate` + rect centré) : la jonction se
      // place au milieu exact de ses deux extrémités. Ne pas ajouter COL_WIDTH/2 — cela la
      // superposait à la cible quand source et cible sont sur des colonnes adjacentes.
      x: (sx + tx) / 2,
      y: (sy + ty) / 2
    });
    edges.push({ from: rel.sourceEntityId, to: nodeId, kind: 'many_to_many' });
    edges.push({ from: nodeId, to: rel.targetEntityId, kind: 'many_to_many' });
    junctionCount++;
  }

  for (const rel of relations) {
    if (rel.kind === 'many_to_many') continue;
    edges.push({ from: rel.sourceEntityId, to: rel.targetEntityId, kind: rel.kind, label: rel.fieldKey });
  }

  const cols = Math.max(1, Math.min(3, nodes.length || 1));
  const rows = Math.ceil(Math.max(nodes.length, 1) / cols);
  return { nodes, edges, width: cols * COL_WIDTH + PADDING, height: rows * ROW_HEIGHT + PADDING + 60 };
}
