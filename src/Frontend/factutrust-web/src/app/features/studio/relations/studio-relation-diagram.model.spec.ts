import { toDiagram } from './studio-relation-diagram.model';
import { CustomEntity } from '../studio.models';
import { EntityRelationDto } from './studio-relations.models';

const entity = (id: string, key: string, name: string, kind?: 'Standard' | 'Junction'): CustomEntity => ({
  id, key, displayName: name, displayNamePlural: name, icon: null, description: null,
  isActive: true, fieldCount: 0, createdAt: '', updatedAt: '', kind: kind ?? 'Standard'
});

const rel = (overrides: Partial<EntityRelationDto>): EntityRelationDto => ({
  kind: 'many_to_many', sourceEntityId: 'e1', sourceEntityKey: 'a', sourceLabel: 'A',
  targetEntityId: 'e2', targetEntityKey: 'b', targetLabel: 'B',
  fieldId: 'f1', fieldKey: 'a_id', isRequired: true, isUnique: false, ...overrides
});

describe('toDiagram', () => {
  it('une N-N produit un nœud jonction et deux arêtes, dédoublonnées par junctionEntityId', () => {
    const model = toDiagram(
      [entity('e1', 'a', 'A'), entity('e2', 'b', 'B'), entity('j1', 'a_b', 'A × B', 'Junction')],
      [
        rel({ junctionEntityId: 'j1', junctionEntityKey: 'a_b' }),
        rel({ junctionEntityId: 'j1', junctionEntityKey: 'a_b', sourceEntityId: 'e2', targetEntityId: 'e1' })
      ]);
    expect(model.nodes.length).toBe(3);
    const jn = model.nodes.find(n => n.kind === 'junction');
    expect(jn?.id).toBe('j1');
    expect(jn?.label).toBe('A × B');
    expect(model.edges.length).toBe(2);
    expect(model.edges.every(e => e.kind === 'many_to_many')).toBeTrue();
    expect(model.edges.map(e => [e.from, e.to])).toEqual([['e1', 'j1'], ['j1', 'e2']]);
  });

  it('place la jonction au milieu exact de ses extrémités, sans chevaucher la cible (régression 2.5i)', () => {
    const model = toDiagram(
      [entity('e1', 'a', 'A'), entity('e2', 'b', 'B'), entity('j1', 'a_b', 'A × B', 'Junction')],
      [rel({ junctionEntityId: 'j1', junctionEntityKey: 'a_b' })]);
    const a = model.nodes.find(n => n.id === 'e1')!;
    const b = model.nodes.find(n => n.id === 'e2')!;
    const jn = model.nodes.find(n => n.id === 'j1')!;
    // x/y sont des centres (rendu `translate` + rect centré) : la jonction est au milieu,
    // jamais superposée à la cible adjacente.
    expect(jn.x).toBe((a.x + b.x) / 2);
    expect(jn.y).toBe((a.y + b.y) / 2);
    expect(jn.x).not.toBe(b.x);
    // Boîtes nœuds (140×40, jonction 170×32) : aucun recouvrement horizontal entre jonction et cible.
    expect(Math.abs(jn.x - b.x)).toBeGreaterThanOrEqual(170 / 2 + 140 / 2);
    // Le libellé courant « A × B » (~170px à 12px) ne déborde pas sur les boîtes adjacentes.
    expect(Math.abs(jn.x - a.x)).toBeGreaterThanOrEqual(140 / 2 + 85);
  });

  it('maintient chaque nœud entité dans les bornes du viewBox (pas de rognage à gauche)', () => {
    const model = toDiagram(
      [entity('e1', 'a', 'A'), entity('e2', 'b', 'B'), entity('e3', 'c', 'C'), entity('e4', 'd', 'D')],
      []);
    for (const n of model.nodes) {
      expect(n.x - 70).toBeGreaterThanOrEqual(0); // demi-largeur du rect entité
      expect(n.x + 70).toBeLessThanOrEqual(model.width);
      expect(n.y - 20).toBeGreaterThanOrEqual(0);
      expect(n.y + 20).toBeLessThanOrEqual(model.height);
    }
  });

  it('une many_to_one produit une arête unique étiquetée par la clé de champ', () => {
    const model = toDiagram(
      [entity('e1', 'a', 'A'), entity('e2', 'b', 'B')],
      [rel({ kind: 'many_to_one', fieldKey: 'client_id', junctionEntityId: null })]);
    expect(model.nodes.every(n => n.kind === 'entity')).toBeTrue();
    expect(model.edges).toEqual([{ from: 'e1', to: 'e2', kind: 'many_to_one', label: 'client_id' }]);
  });

  it('les libellés sont conservés tels quels (pas de balisage)', () => {
    const model = toDiagram([entity('e1', 'a', 'A <script>')], []);
    expect(model.nodes[0].label).toBe('A <script>');
    expect(model.width).toBeGreaterThan(0);
    expect(model.height).toBeGreaterThan(0);
  });

  it('liste vide ⇒ modèle vide mais dimensions positives', () => {
    const model = toDiagram([], []);
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
    expect(model.width).toBeGreaterThan(0);
  });
});
