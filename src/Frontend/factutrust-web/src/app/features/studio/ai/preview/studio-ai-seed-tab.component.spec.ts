import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioAiSeedCsvImportComponent } from './studio-ai-seed-csv-import.component';
import { StudioAiSeedTabComponent } from './studio-ai-seed-tab.component';
import { studioAiSpecFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiSeedTabComponent', () => {
  let fixture: ComponentFixture<StudioAiSeedTabComponent>;
  let component: StudioAiSeedTabComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiSeedTabComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiSeedTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('spec', studioAiSpecFixture());
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function importButton(): HTMLButtonElement | null {
    return host().querySelector('[data-component-id="sai-seed-import-csv-employes"] button');
  }

  /** Panneau d'import déplié (composant enfant), s'il est rendu. */
  function importPanel(): StudioAiSeedCsvImportComponent | null {
    return fixture.debugElement.query(By.directive(StudioAiSeedCsvImportComponent))?.componentInstance ?? null;
  }

  it('affiche les blocs de données de départ en lecture seule, sans import', () => {
    expect(host().querySelectorAll('.sai-block').length).toBe(1);
    expect(host().textContent).toContain('Employés');
    expect(host().textContent).toContain('Dupont');
    expect(host().querySelector('[data-component-id^="sai-seed-import-csv"]')).toBeNull();
    expect(host().querySelector('app-studio-ai-seed-csv-import')).toBeNull();
  });

  it('le bouton Importer un CSV n\'apparaît qu\'en mode éditable', () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();

    const button = importButton();
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain(STUDIO_AI_LABELS.csv.title);
  });

  it('une table existante réutilisée reste sans import', () => {
    const locked = studioAiSpecFixture();
    locked.entities[0].existingKey = 'employes_erp';
    fixture.componentRef.setInput('spec', locked);
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();

    expect(importButton()).toBeNull();
  });

  it('le bouton bascule le panneau d\'import pour la table', () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();

    importButton()?.click();
    fixture.detectChanges();
    expect(importPanel()).withContext('le panneau inline se déplie').toBeTruthy();
    expect(importPanel()?.entity().ref).toBe('employes');

    importButton()?.click();
    fixture.detectChanges();
    expect(importPanel()).withContext('un second clic replie le panneau').toBeNull();
  });

  it('l\'import appliqué émet seedReplace, affiche la confirmation et ferme le panneau', () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    importButton()?.click();
    fixture.detectChanges();

    const emitted: { ref: string; records: Record<string, unknown>[] }[] = [];
    component.seedReplace.subscribe(e => emitted.push(e));

    importPanel()?.applied.emit({ ref: 'employes', records: [{ nom: 'Martin' }, { nom: 'Bernard' }] });
    fixture.detectChanges();

    expect(emitted).toEqual([{ ref: 'employes', records: [{ nom: 'Martin' }, { nom: 'Bernard' }] }]);
    expect(importPanel()).withContext('le panneau se referme après application').toBeNull();
    const notice = host().querySelector('[data-component-id="sai-seed-import-applied"]');
    expect(notice?.textContent).toContain(formatLabel(STUDIO_AI_LABELS.csv.applied, { count: 2 }));
  });

  it('Annuler referme le panneau sans émettre seedReplace', () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    importButton()?.click();
    fixture.detectChanges();

    const emitted: unknown[] = [];
    component.seedReplace.subscribe(e => emitted.push(e));

    importPanel()?.cancelled.emit();
    fixture.detectChanges();

    expect(emitted).toEqual([]);
    expect(importPanel()).toBeNull();
  });
});
