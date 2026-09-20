import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StudioFilterBuilderComponent } from '../../shared/studio-filter-builder.component';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioSpecRecordView, StudioSystemSpec } from '../studio-ai.models';
import { StudioAiViewsTabComponent } from './studio-ai-views-tab.component';
import { studioAiSpecFixture, studioAiSpecWithViewsFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiViewsTabComponent', () => {
  let fixture: ComponentFixture<StudioAiViewsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioAiViewsTabComponent] }).compileComponents();
    fixture = TestBed.createComponent(StudioAiViewsTabComponent);
  });

  function load(spec: StudioSystemSpec): HTMLElement {
    fixture.componentRef.setInput('spec', spec);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(el: Element | null): string {
    return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('affiche une carte par vue avec le mode normalisé (alias français)', () => {
    const host = load(studioAiSpecWithViewsFixture());

    const cards = Array.from(host.querySelectorAll<HTMLElement>('.sai-view'));
    expect(cards.length).toBe(2);
    expect(cards.map(c => c.dataset['componentId'])).toEqual(['sai-view-kanban', 'sai-view-calendar']);

    expect(text(cards[0])).toContain('Par statut');
    expect(text(cards[0])).toContain(STUDIO_AI_LABELS.views.kanban);
    expect(text(cards[0])).toContain('Demandes de congés');
    // D5 (3.4n) : `statut` existe désormais sur `demandes` ⇒ la puce résout le libellé du champ.
    expect(text(cards[0])).toContain(`${STUDIO_AI_LABELS.views.groupBy} : Statut`);

    // `calendrier` (alias FR) ⇒ p-tag « Calendrier », puces Champ date / Fin résolues en libellés.
    expect(text(cards[1])).toContain(STUDIO_AI_LABELS.views.calendar);
    expect(text(cards[1])).toContain(`${STUDIO_AI_LABELS.views.dateField} : Date de début`);
    expect(text(cards[1])).toContain(`${STUDIO_AI_LABELS.views.endField} : Nombre de jours`);

    const thumbs = Array.from(host.querySelectorAll('[role="img"]'));
    expect(thumbs.length).toBe(2);
    expect(thumbs.every(t => (t.getAttribute('aria-label') ?? '').length > 0)).toBeTrue();
    expect(text(host)).toContain(STUDIO_AI_LABELS.views.count.replace('{count}', '2'));
    expect(host.querySelector('.sai-empty')).toBeNull();
  });

  it('affiche l’état vide sans vue', () => {
    const host = load(studioAiSpecFixture());

    expect(host.querySelectorAll('.sai-view').length).toBe(0);
    expect(text(host.querySelector('.sai-empty'))).toContain(STUDIO_AI_LABELS.views.empty);
    expect(text(host)).toContain(STUDIO_AI_LABELS.views.count.replace('{count}', '0'));
  });

  it('la miniature kanban regroupe le seed par option', () => {
    const spec = studioAiSpecFixture();
    const employes = spec.entities.find(e => e.ref === 'employes')!;
    employes.views = [{ name: 'Par statut', mode: 'kanban', groupBy: 'statut', isDefault: true }];
    spec.seed = [
      {
        entityRef: 'employes',
        records: [
          { matricule: 'E-001', nom: 'Dupont', statut: 'actif' },
          { matricule: 'E-002', nom: 'Martin', statut: 'Actif' },
          { matricule: 'E-003', nom: 'Durand', statut: 'actif' },
          { matricule: 'E-004', nom: 'Petit', statut: 'actif' },
          { matricule: 'E-005', nom: 'Bernard', statut: 'inactif' }
        ]
      }
    ];
    const host = load(spec);

    const columns = Array.from(host.querySelectorAll<HTMLElement>('.th-col'));
    expect(columns.map(c => c.dataset['option'])).toEqual(['actif', 'inactif']);
    expect(columns[0].querySelectorAll('.th-card').length).withContext('4 actifs plafonnés à 3 cartes').toBe(3);
    expect(columns[1].querySelectorAll('.th-card').length).toBe(1);

    const thumb = host.querySelector('[role="img"]');
    expect(thumb?.getAttribute('aria-label')).toContain(STUDIO_AI_LABELS.views.kanban);
    expect(thumb?.getAttribute('aria-label')).toContain('Par statut');
    expect(host.querySelector('[innerHTML]')).toBeNull();
    expect(text(host)).toContain(STUDIO_AI_LABELS.views.isDefault);
  });

  it('les filtres de vue passent par le constructeur de filtres partagé', () => {
    const spec = studioAiSpecWithViewsFixture();
    const host = load(spec);

    // Lecture seule inchangée : aucun constructeur de filtres tant que l'onglet n'est pas éditable.
    expect(host.querySelector('app-studio-filter-builder')).toBeNull();

    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();

    const emitted: { ref: string; index: number; patch: Partial<StudioSpecRecordView> }[] = [];
    fixture.componentInstance.viewChange.subscribe(e => emitted.push(e));

    // Un constructeur par carte de vue, alimenté par les champs de l'entité (forme CustomField).
    const builders = fixture.debugElement.queryAll(By.directive(StudioFilterBuilderComponent));
    expect(builders.length).toBe(2);
    const demandes = spec.entities.find(e => e.ref === 'demandes')!;
    const first = builders[0].componentInstance as StudioFilterBuilderComponent;
    expect(first.fields().map(f => f.key)).toEqual(demandes.fields.map(f => f.key));
    expect(first.disabled()).toBeFalse();

    // Une modification dans le constructeur est reconvertie en forme spec ({ field, op, value })
    // et remontée avec sa cible (table + index de la vue).
    first.filters.set([{ fieldKey: 'nb_jours', op: 'gte', value: 2 }]);
    fixture.detectChanges();

    expect(emitted).toEqual([
      { ref: 'demandes', index: 0, patch: { filters: [{ field: 'nb_jours', op: 'gte', value: 2 }] } }
    ]);
  });
});
