import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioSpecEntity } from '../studio-ai.models';
import { StudioAiSeedCsvImportComponent } from './studio-ai-seed-csv-import.component';

describe('StudioAiSeedCsvImportComponent', () => {
  let fixture: ComponentFixture<StudioAiSeedCsvImportComponent>;
  let component: StudioAiSeedCsvImportComponent;

  const entity: StudioSpecEntity = {
    ref: 'types_conge',
    displayName: 'Type de congé',
    displayNamePlural: 'Types de congé',
    fields: [
      { key: 'code', label: 'Clé', type: 'text', required: true, unique: true },
      { key: 'libelle', label: 'Libellé', type: 'text', required: true, unique: false },
      { key: 'jours', label: 'Jours par an', type: 'number', required: false, unique: false }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiSeedCsvImportComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiSeedCsvImportComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entity', entity);
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Colle un texte CSV dans la zone de collage (déclenche `ngModelChange`). */
  function paste(text: string): void {
    const textarea = host().querySelector('textarea[data-component-id="sai-import-paste"]') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Simule le choix d'un fichier dans l'input (sans passer par le sélecteur natif). */
  function chooseFile(file: File): void {
    component.onFileChosen({ target: { files: [file], value: '' } } as unknown as Event);
    fixture.detectChanges();
  }

  function clickButton(id: string): void {
    (host().querySelector(`[data-component-id="${id}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('refuse un fichier > 512 Ko sans le lire', () => {
    const readAsText = spyOn(FileReader.prototype, 'readAsText');
    const big = new File([new Uint8Array(512 * 1024 + 1)], 'gros.csv', { type: 'text/csv' });

    chooseFile(big);

    expect(readAsText).not.toHaveBeenCalled();
    expect(component.error()).toBe(STUDIO_AI_LABELS.csv.tooLarge);
    expect(component.parsed()).toBeNull();
    expect(host().querySelector('[role="alert"]')?.textContent).toContain(STUDIO_AI_LABELS.csv.tooLarge);
  });

  it('refuse un dépôt non CSV sans le lire', () => {
    const readAsText = spyOn(FileReader.prototype, 'readAsText');
    const file = new File(['a;b'], 'notes.txt', { type: 'text/plain' });

    component.onDrop({ preventDefault: () => undefined, dataTransfer: { files: [file] } } as unknown as DragEvent);
    fixture.detectChanges();

    expect(readAsText).not.toHaveBeenCalled();
    expect(component.error()).toBe(STUDIO_AI_LABELS.csv.notCsv);
    expect(component.parsed()).toBeNull();
  });

  it('lit un fichier .csv via FileReader et pré-remplit la correspondance', async () => {
    const file = new File(['code;Libellé\nCP;Congés payés'], 'types.csv', { type: 'text/csv' });

    chooseFile(file);
    // FileReader est asynchrone : on attend la fin de lecture (bornée) avant d'affirmer.
    for (let i = 0; i < 100 && !component.parsed(); i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.fileName()).toBe('types.csv');
    expect(component.parsed()?.headers).toEqual(['code', 'Libellé']);
    expect(component.mapping()).toEqual(['code', 'libelle']);
  });

  it('pré-rapproche les colonnes aux champs par clé ou libellé', () => {
    paste('code;Libellé;jours par an;couleur\nCP;Congés payés;25;#4f46e5');

    // « code » et « Libellé » par clé (slug de l'en-tête) ; « jours par an » par libellé
    // (insensible à la casse et aux accents) ; « couleur » sans correspondance ⇒ ignorée.
    expect(component.mapping()).toEqual(['code', 'libelle', 'jours', '']);
    expect(component.exampleFor(0)).toBe('CP');

    const selects = host().querySelectorAll('[data-component-id^="sai-import-map-"]');
    expect(selects.length).toBe(4);
    expect(host().textContent).toContain(STUDIO_AI_LABELS.csv.mapping);
  });

  it('Remplacer les données de départ émet applied avec les lignes mappées', () => {
    const emitted: { ref: string; records: Record<string, unknown>[] }[] = [];
    component.applied.subscribe(e => emitted.push(e));

    // « couleur » n'est rapprochée à rien ; la ligne « ;;# » n'a aucune valeur retenue ⇒ ignorée ;
    // la cellule libellé vide de « MAL » devient null.
    paste('code;Libellé;couleur\nCP;Congés payés;#4f46e5\n;;#\nMAL;;#fff');
    clickButton('sai-import-apply');

    expect(emitted).toEqual([{
      ref: 'types_conge',
      records: [
        { code: 'CP', libelle: 'Congés payés' },
        { code: 'MAL', libelle: null }
      ]
    }]);
  });

  it('n\'émet pas applied quand aucune colonne n\'est rapprochée', () => {
    const emitted: unknown[] = [];
    component.applied.subscribe(e => emitted.push(e));

    paste('code;Libellé\nCP;Congés payés');
    component.onMappingChange(0, '');
    component.onMappingChange(1, '');
    fixture.detectChanges();

    const button = host().querySelector('[data-component-id="sai-import-apply"] button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    button.click();
    expect(emitted).toEqual([]);
  });

  it('affiche l\'avis tronqué au-delà des bornes', () => {
    // Borne lignes : 600 lignes de données ⇒ 500 conservées, avis affiché.
    paste(['code', ...Array.from({ length: 600 }, (_, i) => `C${i}`)].join('\n'));

    expect(component.parsed()?.truncated).toBeTrue();
    expect(component.parsed()?.rows.length).toBe(500);
    const notice = host().querySelector('[data-component-id="sai-import-truncated"]');
    expect(notice?.textContent).toContain(formatLabel(STUDIO_AI_LABELS.csv.truncated, { count: 500 }));

    // Borne caractères : au-delà de 64 Ko collés, le texte est tronqué également.
    paste(`code\n${'x'.repeat(70 * 1024)}`);
    expect(component.parsed()?.truncated).toBeTrue();
  });

  it('Annuler émet cancelled', () => {
    let count = 0;
    component.cancelled.subscribe(() => count++);

    clickButton('sai-import-cancel');

    expect(count).toBe(1);
  });
});
