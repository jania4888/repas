import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StudioRelationDiagramComponent } from './studio-relation-diagram.component';
import { DiagramModel } from './studio-relation-diagram.model';

const model: DiagramModel = {
  nodes: [
    { id: 'e1', label: 'Interventions', kind: 'entity', x: 40, y: 40 },
    { id: 'j1', label: 'Jonction', kind: 'junction', x: 200, y: 40 },
    { id: 'e2', label: 'Techniciens', kind: 'entity', x: 360, y: 40 }
  ],
  edges: [
    { from: 'e1', to: 'j1', kind: 'many_to_many' },
    { from: 'j1', to: 'e2', kind: 'many_to_many' }
  ],
  width: 480,
  height: 140
};

describe('StudioRelationDiagramComponent', () => {
  let fixture: ComponentFixture<StudioRelationDiagramComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioRelationDiagramComponent] }).compileComponents();
    fixture = TestBed.createComponent(StudioRelationDiagramComponent);
    fixture.componentRef.setInput('model', model);
    fixture.detectChanges();
  });

  it('rend un <g> par nœud et une <line> par arête, role=img', () => {
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 140');
    expect(svg.querySelectorAll('g.srd__node').length).toBe(3);
    expect(svg.querySelectorAll('line.srd__edge').length).toBe(2);
    expect(svg.querySelector('.srd__shape--junction')).not.toBeNull();
  });

  it('un libellé contenant < est rendu en texte (interpolation échappée)', () => {
    fixture.componentRef.setInput('model', {
      ...model,
      nodes: [{ id: 'e1', label: 'A <img src=x>', kind: 'entity', x: 40, y: 40 }],
      edges: []
    });
    fixture.detectChanges();
    const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
    expect(svg.querySelector('text')?.textContent).toContain('A <img src=x>');
    expect(svg.querySelector('img')).toBeNull();
  });

  it('modèle vide ⇒ libellé d\'état vide', () => {
    fixture.componentRef.setInput('model', { nodes: [], edges: [], width: 100, height: 100 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Relations non activées.');
  });
});
