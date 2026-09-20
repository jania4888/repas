import { ComponentFixture, TestBed } from '@angular/core/testing';
import { STUDIO_SPEC_LIMITS, countSpec } from '../studio-ai.models';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiOverviewTabComponent } from './studio-ai-overview-tab.component';
import { studioAiSpecFixture, studioAiSpecWithViewsFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiOverviewTabComponent', () => {
  let fixture: ComponentFixture<StudioAiOverviewTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioAiOverviewTabComponent] }).compileComponents();

    const spec = studioAiSpecFixture();
    fixture = TestBed.createComponent(StudioAiOverviewTabComponent);
    fixture.componentRef.setInput('spec', spec);
    fixture.componentRef.setInput('counters', countSpec(spec));
    fixture.componentRef.setInput('warnings', ['Vérifiez la devise de « Indemnité ».']);
    fixture.detectChanges();
  });

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('lists every entity with its field and relation counts', () => {
    const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.sai-list__item'));
    const entityItems = items.map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');

    expect(entityItems.some(t => t.includes('Employé') && t.includes(`3 ${STUDIO_AI_LABELS.preview.fields}`))).toBeTrue();
    expect(
      entityItems.some(t => t.includes('Demande de congé') && t.includes(`2 ${STUDIO_AI_LABELS.preview.relations}`))
    ).toBeTrue();
  });

  it('renders the counter cards, the relation diagram and the limits hint', () => {
    expect(text()).toContain(STUDIO_AI_LABELS.preview.diagram);
    expect(fixture.nativeElement.querySelector('svg[role="img"]')).not.toBeNull();
    expect(text()).not.toContain(STUDIO_AI_LABELS.preview.diagramSoon);
    expect(text()).toContain(`${STUDIO_SPEC_LIMITS.maxEntities} tables max`);
    expect(text()).toContain(`${STUDIO_SPEC_LIMITS.maxFields} champs par table`);

    const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.sai-card'));
    expect(cards.length).toBe(6);
    expect(cards[0].textContent).toContain('2');
  });

  it('shows the warnings to review', () => {
    expect(text()).toContain(STUDIO_AI_LABELS.preview.warningsTitle);
    expect(text()).toContain('Vérifiez la devise');
  });

  it('la vue d’ensemble rend le diagramme SVG role=img', () => {
    fixture.componentRef.setInput('spec', studioAiSpecWithViewsFixture());
    fixture.detectChanges();

    const svg: SVGSVGElement | null = fixture.nativeElement.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('srd--compact')).toBeTrue();
    const nodeLabels = Array.from(svg?.querySelectorAll('.srd__label') ?? []).map(el => el.textContent);
    expect(nodeLabels).toEqual(['Employé', 'Demande de congé', 'Clients', 'employes_demandes']);
    expect(svg?.querySelectorAll('line.srd__edge').length).toBe(4);

    const srText = (fixture.nativeElement as HTMLElement).querySelector('.sr-only')?.textContent ?? '';
    expect(srText).toContain('Demande de congé → Employé (many_to_one)');
    expect(srText).toContain('employes_demandes → Demande de congé (many_to_many)');
  });

  it('emits openEntity with the entity ref when a table is clicked', () => {
    const emitted: string[] = [];
    fixture.componentInstance.openEntity.subscribe(ref => emitted.push(ref));

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.sai-list__item'));
    (buttons[1] as HTMLButtonElement).click();

    expect(emitted).toEqual(['demandes']);
  });
});
