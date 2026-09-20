import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ImportCustomSystemRequest } from '../studio-ai.models';
import { studioAiSpecWithViewsFixture, studioSystemExportFixture } from '../preview/testing/studio-ai-spec.fixture';
import { StudioAiImportDialogComponent } from './studio-ai-import-dialog.component';

describe('StudioAiImportDialogComponent', () => {
  let fixture: ComponentFixture<StudioAiImportDialogComponent>;
  let component: StudioAiImportDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiImportDialogComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    component.visible.set(false);
    fixture.detectChanges();
  });

  function importButton(): HTMLButtonElement | null {
    return document.querySelector('button[data-action="import"]') as HTMLButtonElement | null;
  }

  function fileEvent(file: File): Event {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as unknown as Event;
  }

  it('fichier > 256 Ko ⇒ « 256 Ko maximum » et aucune lecture du fichier', () => {
    const readSpy = spyOn(FileReader.prototype, 'readAsText');
    const big = new File([new Uint8Array(256 * 1024 + 1)], 'gros.json', { type: 'application/json' });

    component.onFile(fileEvent(big));
    fixture.detectChanges();

    expect(readSpy).not.toHaveBeenCalled();
    expect(component.error()).toBe('Fichier trop volumineux (256 Ko maximum).');
    expect(component.fileName()).toBeNull();
    expect(component.spec()).toBeNull();
    expect(document.body.textContent).toContain('256 Ko maximum');
    expect(importButton()?.disabled).toBeTrue();
  });

  it('JSON invalide ⇒ « JSON invalide », Importer désactivé', () => {
    component.onPaste('{ "specVersion": 1, ');
    fixture.detectChanges();

    expect(component.error()).toBe('JSON invalide.');
    expect(component.spec()).toBeNull();
    expect(component.canSubmit()).toBeFalse();
    expect(document.body.textContent).toContain('JSON invalide.');
    expect(importButton()?.disabled).toBeTrue();
  });

  it('entité sans champs ⇒ message d\'erreur, pas de plantage', () => {
    component.onPaste(JSON.stringify({ specVersion: 1, entities: [{ name: 'Client' }] }));
    fixture.detectChanges();

    expect(component.error()).toBe('Le fichier ne ressemble pas à une spécification de système (tables et champs attendus).');
    expect(component.spec()).toBeNull();
    expect(component.counters()).toBeNull();
    expect(component.canSubmit()).toBeFalse();
    expect(document.body.textContent).toContain('ne ressemble pas à une spécification');
    expect(importButton()?.disabled).toBeTrue();
  });

  it('specVersion ≠ 1 ⇒ message de version, Importer désactivé', () => {
    const spec = { ...studioAiSpecWithViewsFixture(), specVersion: 2 };
    component.onPaste(JSON.stringify(spec));
    fixture.detectChanges();

    expect(component.error()).toBe('specVersion non pris en charge (1 attendu).');
    expect(component.spec()).toBeNull();
    expect(document.body.textContent).toContain('specVersion non pris en charge (1 attendu).');
    expect(importButton()?.disabled).toBeTrue();
  });

  it('spec valide ⇒ compteurs tables/relations/vues et Importer actif', () => {
    component.onPaste(JSON.stringify(studioAiSpecWithViewsFixture()));
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.spec()).toBeTruthy();
    const counters = component.counters();
    expect(counters).toBeTruthy();
    expect(counters!.entities).toBe(2);
    expect(counters!.views).toBe(2);
    expect(document.body.textContent).toContain('Spécification reconnue');
    expect(document.body.textContent).toContain(`${counters!.entities} tables · ${counters!.relations} relations · ${counters!.views} vues`);
    expect(component.canSubmit()).toBeTrue();
    expect(importButton()?.disabled).toBeFalse();
  });

  it('enveloppe d\'export (champ spec) ⇒ la spec interne est reconnue', () => {
    const envelope = studioSystemExportFixture();
    component.onPaste(JSON.stringify(envelope));
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.spec()).toEqual(JSON.parse(JSON.stringify(envelope.spec)));
    expect(component.spec()!['systemKey']).toBeUndefined();
    expect(component.counters()!.entities).toBe(envelope.entityCount);
    expect(component.canSubmit()).toBeTrue();
  });

  it('Importer ⇒ émet { spec, displayNameOverride, includeSeed }', () => {
    const emitted: ImportCustomSystemRequest[] = [];
    component.submitted.subscribe(req => emitted.push(req));
    const spec = studioAiSpecWithViewsFixture();
    component.onPaste(JSON.stringify(spec));
    component.displayNameOverride.set('  Congés (import)  ');
    component.includeSeed.set(false);
    fixture.detectChanges();

    importButton()!.click();
    fixture.detectChanges();

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      spec: JSON.parse(JSON.stringify(spec)),
      displayNameOverride: 'Congés (import)',
      includeSeed: false
    });

    // Nom vide ⇒ `null` ; défaut includeSeed = true.
    component.displayNameOverride.set('   ');
    component.includeSeed.set(true);
    component.submit();
    expect(emitted.length).toBe(2);
    expect(emitted[1].displayNameOverride).toBeNull();
    expect(emitted[1].includeSeed).toBeTrue();
  });

  it('serverError affiché tel quel (400 serveur)', () => {
    component.onPaste(JSON.stringify(studioAiSpecWithViewsFixture()));
    fixture.componentRef.setInput('serverError', 'Validation.spec : entités en double (employes).');
    fixture.detectChanges();

    const alert = document.querySelector('[data-role="server-error"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent?.trim()).toBe('Validation.spec : entités en double (employes).');
    // L'erreur serveur ne bloque pas une nouvelle tentative côté client.
    expect(component.canSubmit()).toBeTrue();
  });

  it('Retirer vide le fichier, le texte et l\'erreur', () => {
    component.fileName.set('system.json');
    component.onPaste('pas du json');
    component.fileName.set('system.json');
    fixture.detectChanges();
    expect(component.error()).toBe('JSON invalide.');

    const remove = document.querySelector('button[data-action="remove"]') as HTMLButtonElement | null;
    expect(remove).toBeTruthy();
    remove!.click();
    fixture.detectChanges();

    expect(component.fileName()).toBeNull();
    expect(component.raw()).toBe('');
    expect(component.error()).toBeNull();
    expect(component.spec()).toBeNull();
    expect(document.querySelector('button[data-action="remove"]')).toBeNull();
    expect(importButton()?.disabled).toBeTrue();
  });
});
