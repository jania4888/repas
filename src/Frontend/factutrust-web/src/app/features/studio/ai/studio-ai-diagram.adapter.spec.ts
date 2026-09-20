import { COL_WIDTH, PADDING, ROW_HEIGHT } from '../relations/studio-relation-diagram.model';
import { specToDiagram } from './studio-ai-diagram.adapter';
import { studioAiSpecFixture, studioAiSpecWithViewsFixture } from './preview/testing/studio-ai-spec.fixture';

describe('specToDiagram', () => {
  it('crée une arête plusieurs-à-un par champ relation interne', () => {
    const model = specToDiagram(studioAiSpecFixture());

    expect(model.edges.filter(e => e.kind === 'many_to_one').map(e => [e.from, e.to, e.label])).toEqual([
      ['demandes', 'employes', 'employe_id'],
      ['demandes', 'clients', 'client_id']
    ]);
    expect(model.nodes.map(n => n.id)).toEqual(['employes', 'demandes', 'clients']);

    // Grille de 3 colonnes identique à `toDiagram` (constantes partagées du modèle 2.5g).
    const [employes, demandes] = model.nodes;
    expect([employes.x, employes.y]).toEqual([PADDING, PADDING]);
    expect([demandes.x, demandes.y]).toEqual([PADDING + COL_WIDTH, PADDING]);
    expect(model.width).toBe(3 * COL_WIDTH + PADDING);
    expect(model.height).toBe(ROW_HEIGHT + PADDING + 60);
  });

  it('crée une jonction et deux arêtes pour une relation plusieurs-à-plusieurs', () => {
    const model = specToDiagram(studioAiSpecWithViewsFixture());

    const junction = model.nodes.find(n => n.kind === 'junction');
    expect(junction?.id).toBe('employes_demandes');
    expect(junction?.label).toBe('employes_demandes');
    expect(model.edges.filter(e => e.kind === 'many_to_many').map(e => [e.from, e.to])).toEqual([
      ['employes', 'employes_demandes'],
      ['employes_demandes', 'demandes']
    ]);

    // Jonction au milieu exact de ses extrémités (régression 2.5i).
    const a = model.nodes.find(n => n.id === 'employes')!;
    const b = model.nodes.find(n => n.id === 'demandes')!;
    expect(junction?.x).toBe((a.x + b.x) / 2);
    expect(junction?.y).toBe((a.y + b.y) / 2);

    // Sans `junctionName`, le libellé retombe sur `${from}_${to}`.
    const fallback = specToDiagram({
      ...studioAiSpecFixture(),
      relations: [{ kind: 'many_to_many', from: 'employes', to: 'demandes' }]
    });
    expect(fallback.nodes.find(n => n.kind === 'junction')?.label).toBe('employes_demandes');
  });

  it('marque les tables existantes et les cibles ERP', () => {
    const spec = studioAiSpecFixture();
    spec.entities.find(e => e.ref === 'employes')!.existingKey = 'legacy_employes';
    spec.entities.find(e => e.ref === 'demandes')!.fields.push({
      key: 'second_client_id',
      label: 'Client secondaire',
      type: 'relation',
      required: false,
      unique: false,
      relationTo: 'clients'
    });

    const model = specToDiagram(spec);

    expect(model.nodes.find(n => n.id === 'employes')?.kind).toBe('existing');
    expect(model.nodes.find(n => n.id === 'demandes')?.kind).toBe('entity');

    // Cible ERP ajoutée une seule fois malgré deux champs qui la référencent.
    const erp = model.nodes.filter(n => n.id === 'clients');
    expect(erp.length).toBe(1);
    expect(erp[0].kind).toBe('existing');
    expect(erp[0].label).toBe('Clients');
    expect(model.edges.filter(e => e.to === 'clients' && e.kind === 'many_to_one').length).toBe(2);
  });
});
