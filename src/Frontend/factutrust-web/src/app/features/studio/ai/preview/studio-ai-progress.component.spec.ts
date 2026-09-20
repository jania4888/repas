import { TestBed } from '@angular/core/testing';
import { StudioBuildStep } from '../studio-ai.models';
import { StudioAiProgressComponent } from './studio-ai-progress.component';

const STEPS: StudioBuildStep[] = [
  { phase: 'creating_system', label: 'Système', status: 'done', detail: 'Créer le système' },
  { phase: 'creating_entity', label: 'Table Employés', status: 'running' },
  { phase: 'seeding_data', label: 'Données de référence', status: 'pending' }
];

describe('StudioAiProgressComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioAiProgressComponent] }).compileComponents();
  });

  function create(steps: StudioBuildStep[] = STEPS) {
    const fixture = TestBed.createComponent(StudioAiProgressComponent);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
    return fixture;
  }

  it('rend une ligne par étape avec l’icône de son statut', () => {
    const fixture = create();
    const items = fixture.nativeElement.querySelectorAll('.saip__step');
    expect(items.length).toBe(3);
    expect(items[0].querySelector('.fa-circle-check')).toBeTruthy();
    expect(items[1].querySelector('.fa-spinner')).toBeTruthy();
    expect(items[2].querySelector('.fa-circle')).toBeTruthy();
  });

  it('affiche l’avancement, l’étape en cours et le rappel de ne pas fermer la page', () => {
    const fixture = create();
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('.saip__count').textContent).toContain('1 / 3');
    expect(text).toContain('Étape 2 sur 3');
    expect(text).toContain('Table Employés');
    expect(text).toContain('Ne fermez pas cette page.');
  });

  it('marque l’étape en échec', () => {
    const fixture = create([{ phase: 'creating_fields', label: 'Champs', status: 'error', detail: 'Champ invalide' }]);
    expect(fixture.nativeElement.querySelector('.saip__step--error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.fa-circle-xmark')).toBeTruthy();
  });

  it('marque une étape ignorée (skipped) et la compte comme terminée dans l’avancement', () => {
    const fixture = create([
      { phase: 'creating_system', label: 'Système', status: 'done' },
      { phase: 'creating_relation', label: 'Relation N-N', status: 'skipped' }
    ]);
    expect(fixture.nativeElement.querySelector('.saip__step--skipped')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.fa-forward')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Ignoré');
    expect(fixture.nativeElement.querySelector('.saip__count').textContent).toContain('2 / 2');
    expect(fixture.nativeElement.querySelector('.saip__bar-fill').style.width).toBe('100%');
  });

  it('puce Vues = étapes creating_views terminées / total', () => {
    const fixture = create([
      { phase: 'creating_system', label: 'Système', status: 'done' },
      { phase: 'creating_views', label: 'Vue Kanban', status: 'done' },
      { phase: 'creating_views', label: 'Vue Calendrier', status: 'skipped' },
      { phase: 'creating_views', label: 'Vue Liste', status: 'running' }
    ]);
    const chip = fixture.nativeElement.querySelector('.saip__chip[data-phase="views"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent!.replace(/\s+/g, ' ').trim()).toBe('Vues 2/3');
  });

  it('sans étape de vue ⇒ pas de puce Vues', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('[data-phase="views"]')).toBeNull();
  });
});
