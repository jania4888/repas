import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StudioAiRelationsTabComponent } from './studio-ai-relations-tab.component';
import { studioAiSpecWithViewsFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiRelationsTabComponent', () => {
  let fixture: ComponentFixture<StudioAiRelationsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioAiRelationsTabComponent] }).compileComponents();

    fixture = TestBed.createComponent(StudioAiRelationsTabComponent);
    fixture.componentRef.setInput('spec', studioAiSpecWithViewsFixture());
    fixture.detectChanges();
  });

  it('l’onglet Relations rend le diagramme complet', () => {
    const svg: SVGSVGElement | null = fixture.nativeElement.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('srd--compact')).toBeFalse();

    // 2 entités + la cible ERP `clients` (nœud existing unique) + la jonction N-N.
    const nodeLabels = Array.from(svg?.querySelectorAll('.srd__label') ?? []).map(el => el.textContent);
    expect(nodeLabels).toEqual(['Employé', 'Demande de congé', 'Clients', 'employes_demandes']);
    expect(svg?.querySelector('g.srd__node--junction')).not.toBeNull();
    expect(svg?.querySelectorAll('line.srd__edge').length).toBe(4);

    // Le tableau existant est conservé sous le diagramme.
    expect(fixture.nativeElement.querySelector('table.sai-table')).not.toBeNull();
  });
});
