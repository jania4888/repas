import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { STUDIO_SPEC_LIMITS, StudioSpecChange, StudioSpecField } from '../studio-ai.models';
import { StudioAiTablesTabComponent } from './studio-ai-tables-tab.component';
import { studioAiSpecFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiTablesTabComponent', () => {
  let fixture: ComponentFixture<StudioAiTablesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiTablesTabComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiTablesTabComponent);
    fixture.componentRef.setInput('spec', studioAiSpecFixture());
    fixture.detectChanges();
  });

  function rows(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).map(
      tr => tr.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    );
  }

  it('selects the first entity by default and renders its fields with French type labels', () => {
    expect(fixture.componentInstance.activeRef()).toBe('employes');

    const headers = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('thead th')).map(
      th => th.textContent?.trim()
    );
    expect(headers).toEqual([
      STUDIO_AI_LABELS.preview.colLabel,
      STUDIO_AI_LABELS.preview.colKey,
      STUDIO_AI_LABELS.preview.colType,
      STUDIO_AI_LABELS.preview.colRequired,
      STUDIO_AI_LABELS.preview.colUnique,
      STUDIO_AI_LABELS.preview.colDetails
    ]);

    expect(rows().length).toBe(3);
    expect(rows()[0]).toContain('Matricule');
    expect(rows()[0]).toContain(STUDIO_AI_LABELS.fieldTypes.text);
    expect(rows()[2]).toContain('Actif · Inactif');
  });

  it('expands the entity requested through selectedRef', () => {
    fixture.componentRef.setInput('selectedRef', 'demandes');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeRef()).toBe('demandes');
    expect(rows().length).toBe(5);
  });

  it('describes relation targets, flagging ERP targets', () => {
    fixture.componentRef.setInput('selectedRef', 'demandes');
    fixture.detectChanges();

    const spec = studioAiSpecFixture();
    const entityRelation = spec.entities[1].fields[0];
    const erpRelation = spec.entities[1].fields[1];
    expect(fixture.componentInstance.details(entityRelation)).toBe('→ Employé');
    expect(fixture.componentInstance.details(erpRelation)).toBe(`→ Clients (${STUDIO_AI_LABELS.preview.erpBadge})`);
    expect(fixture.componentInstance.details(spec.entities[1].fields[4])).toBe('EUR');
  });

  it('lets the user pick another entity from the left list', () => {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.sai-list__item'));
    expect(buttons.length).toBe(2);

    (buttons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeRef()).toBe('demandes');
    expect(rows().length).toBe(5);
  });

  // ---- Mode Personnaliser (3.4g1) ------------------------------------------------------------------

  /** Passe l'onglet en édition avec les changements `diffSpec` fournis par le store. */
  function editMode(changes: StudioSpecChange[] = []): HTMLElement {
    fixture.componentRef.setInput('editable', true);
    fixture.componentRef.setInput('changes', changes);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('en mode éditable, un champ modifié émet fieldChange et la ligne est marquée', () => {
    const host = editMode();
    const emitted: { ref: string; key: string; patch: Partial<StudioSpecField> }[] = [];
    fixture.componentInstance.fieldChange.subscribe(e => emitted.push(e));

    const input = host.querySelector('[data-component-id="sai-field-label-nom"]') as HTMLInputElement;
    expect(input).withContext('le libellé devient un champ de saisie inline').toBeTruthy();
    input.value = 'Nom de famille';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(emitted).toEqual([{ ref: 'employes', key: 'nom', patch: { label: 'Nom de famille' } }]);

    // Le store applique la mutation puis renvoie `changes` : la ligne est marquée « Modifié ».
    fixture.componentRef.setInput('changes', [
      { path: 'entities.employes.fields.nom', kind: 'changed', label: 'Nom — Employé' }
    ]);
    fixture.detectChanges();

    const changed = host.querySelector('tr.sai-row--changed');
    expect(changed).withContext('la ligne modifiée est mise en évidence').toBeTruthy();
    expect(changed?.textContent).toContain(STUDIO_AI_LABELS.customize.changedTag);
  });

  it('ajoute un champ avec une clé unique et bloque au maximum', () => {
    const host = editMode();
    const emitted: string[] = [];
    fixture.componentInstance.fieldAdd.subscribe(ref => emitted.push(ref));

    const addButton = () =>
      host.querySelector('[data-component-id="sai-field-add"] button') as HTMLButtonElement;
    expect(addButton()).withContext('le bouton « Ajouter un champ » est présent').toBeTruthy();

    // « Ajouter un champ » : le composant émet la table cible ; le store crée la clé unique.
    addButton().click();
    fixture.detectChanges();
    expect(emitted).toEqual(['employes']);

    // À STUDIO_SPEC_LIMITS.maxFields champs, le bouton est désactivé avec l'explication.
    const spec = studioAiSpecFixture();
    const employes = spec.entities[0];
    while (employes.fields.length < STUDIO_SPEC_LIMITS.maxFields) {
      const n = employes.fields.length + 1;
      employes.fields.push({ key: `champ_${n}`, label: `Champ ${n}`, type: 'text', required: false, unique: false });
    }
    fixture.componentRef.setInput('spec', spec);
    fixture.detectChanges();

    expect(addButton().disabled).toBeTrue();
    expect(host.textContent).toContain(STUDIO_AI_LABELS.customize.maxFields);
    addButton().click();
    expect(emitted.length).withContext('bloqué : aucune émission au maximum').toBe(1);
  });

  it('retirer puis rétablir un champ', () => {
    const host = editMode();
    const emitted: { ref: string; key: string }[] = [];
    fixture.componentInstance.fieldRemove.subscribe(e => emitted.push(e));

    const deleteBtn = host.querySelector('[data-component-id="sai-field-delete-nom"] button') as HTMLButtonElement;
    expect(deleteBtn).withContext('chaque ligne a son bouton « Retirer »').toBeTruthy();
    deleteBtn.click();
    fixture.detectChanges();
    expect(emitted).toEqual([{ ref: 'employes', key: 'nom' }]);

    // Le store sort le champ du brouillon : la spec ne le contient plus, `changes` le porte en
    // `removed` — la ligne barrée « Retiré » avec « Rétablir » apparaît.
    const spec = studioAiSpecFixture();
    const nom = spec.entities[0].fields.find(f => f.key === 'nom')!;
    spec.entities[0].fields = spec.entities[0].fields.filter(f => f.key !== 'nom');
    fixture.componentRef.setInput('spec', spec);
    fixture.componentRef.setInput('changes', [
      { path: 'entities.employes.fields.nom', kind: 'removed', label: 'Nom — Employé', before: nom }
    ]);
    fixture.detectChanges();

    expect(host.querySelector('[data-component-id="sai-field-delete-nom"]')).toBeNull();
    const removedRow = host.querySelector('tr.sai-row--removed');
    expect(removedRow).toBeTruthy();
    expect(removedRow?.textContent).toContain(STUDIO_AI_LABELS.customize.removedTag);

    const restore = host.querySelector('[data-component-id="sai-field-restore-nom"]') as HTMLButtonElement;
    expect(restore?.textContent).toContain(STUDIO_AI_LABELS.customize.restoreField);
    restore.click();
    fixture.detectChanges();
    expect(emitted).toEqual([
      { ref: 'employes', key: 'nom' },
      { ref: 'employes', key: 'nom' }
    ]);
  });

  it('réordonne les champs par glisser-déposer et par clavier', () => {
    const host = editMode();
    const emitted: { ref: string; from: number; to: number }[] = [];
    fixture.componentInstance.fieldReorder.subscribe(e => emitted.push(e));

    // Chaque ligne de champ a sa poignée et ses boutons Monter / Descendre (labels customize
    // portés par l'hôte `p-button`, le clic va au bouton natif).
    expect(host.querySelector('[data-component-id="sai-field-drag-nom"]'))
      .withContext('poignée cdkDragHandle de la ligne')
      .toBeTruthy();
    const up = host.querySelector('[data-component-id="sai-field-up-nom"]') as HTMLElement;
    const down = host.querySelector('[data-component-id="sai-field-down-nom"]') as HTMLElement;
    expect(up?.getAttribute('aria-label')).toBe(STUDIO_AI_LABELS.customize.moveUp);
    expect(down?.getAttribute('aria-label')).toBe(STUDIO_AI_LABELS.customize.moveDown);

    // Clavier : « Descendre » sur « nom » (index 1) émet le déplacement 1 → 2.
    (down.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual([{ ref: 'employes', from: 1, to: 2 }]);

    // Bords : « Monter » sur le premier champ et « Descendre » sur le dernier sont désactivés.
    const firstUp = host.querySelector('[data-component-id="sai-field-up-matricule"] button') as HTMLButtonElement;
    const lastDown = host.querySelector('[data-component-id="sai-field-down-statut"] button') as HTMLButtonElement;
    expect(firstUp.disabled).toBeTrue();
    expect(lastDown.disabled).toBeTrue();
    firstUp.click();
    lastDown.click();
    expect(emitted.length).withContext('aucune émission aux bornes').toBe(1);

    // Glisser-déposer : l'événement cdkDropListDropped est simulé (index relatifs aux lignes cdkDrag).
    const entity = fixture.componentInstance.activeEntity()!;
    fixture.componentInstance.onDrop(entity, { previousIndex: 0, currentIndex: 2 } as CdkDragDrop<StudioSpecField[]>);
    expect(emitted).toEqual([
      { ref: 'employes', from: 1, to: 2 },
      { ref: 'employes', from: 0, to: 2 }
    ]);
  });

  it('verrouille les tables existantes', () => {
    const spec = studioAiSpecFixture();
    spec.entities[0].existingKey = 'employes_existants';
    fixture.componentRef.setInput('spec', spec);
    const host = editMode();

    expect(host.textContent).toContain(STUDIO_AI_LABELS.customize.locked);
    expect(host.querySelector('[data-component-id^="sai-field-label-"]'))
      .withContext('aucune saisie inline sur une table existante')
      .toBeNull();
    expect(host.querySelector('[data-component-id="sai-field-add"]')).toBeNull();
    // La grille de lecture reste affichée telle quelle.
    expect(host.textContent).toContain('Matricule');
    expect(rows().length).toBe(3);
  });
});
