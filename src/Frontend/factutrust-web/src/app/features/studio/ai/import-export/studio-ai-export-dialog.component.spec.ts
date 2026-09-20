import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { StudioAiBuildService } from '../../studio-ai-build.service';
import { CustomSystem } from '../../studio.models';
import { StudioService } from '../../studio.service';
import { studioSystemExportFixture } from '../preview/testing/studio-ai-spec.fixture';
import { StudioAiExportDialogComponent } from './studio-ai-export-dialog.component';

const SYSTEMS: CustomSystem[] = [
  {
    id: 's1', key: 'gestion_des_conges', displayName: 'Gestion des congés', icon: null, description: null,
    onboardingSteps: null, isActive: true, entityCount: 2, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z'
  },
  {
    id: 's2', key: 'parc_auto', displayName: 'Parc auto', icon: null, description: null,
    onboardingSteps: null, isActive: true, entityCount: 3, createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z'
  }
];

describe('StudioAiExportDialogComponent', () => {
  let builds: jasmine.SpyObj<StudioAiBuildService>;
  let studio: jasmine.SpyObj<StudioService>;

  beforeEach(async () => {
    builds = jasmine.createSpyObj<StudioAiBuildService>('StudioAiBuildService', ['exportSystem']);
    studio = jasmine.createSpyObj<StudioService>('StudioService', ['listSystems']);
    builds.exportSystem.and.returnValue(of({ success: true, data: studioSystemExportFixture(), message: null, errors: [] }));
    studio.listSystems.and.returnValue(of({ success: true, data: SYSTEMS, message: null, errors: [] }));

    await TestBed.configureTestingModule({
      imports: [StudioAiExportDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StudioAiBuildService, useValue: builds },
        { provide: StudioService, useValue: studio }
      ]
    }).compileComponents();
  });

  async function create(systemKey: string | null): Promise<ComponentFixture<StudioAiExportDialogComponent>> {
    const fixture = TestBed.createComponent(StudioAiExportDialogComponent);
    fixture.componentRef.setInput('systemKey', systemKey);
    fixture.detectChanges();
    // Fermé : aucun appel réseau (S-base).
    expect(builds.exportSystem).not.toHaveBeenCalled();
    expect(studio.listSystems).not.toHaveBeenCalled();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function buttonByAction(action: string): HTMLButtonElement | null {
    return document.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
  }

  it('ouvert avec une clé préréglée ⇒ GET export sans p-select et aperçu JSON de la spec', async () => {
    const fixture = await create('gestion_des_conges');

    expect(builds.exportSystem).toHaveBeenCalledTimes(1);
    expect(builds.exportSystem).toHaveBeenCalledWith('gestion_des_conges', false);
    expect(studio.listSystems).not.toHaveBeenCalled();
    expect(document.querySelector('p-select')).toBeNull();

    const pre = document.querySelector('pre.saie__json');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe(JSON.stringify(studioSystemExportFixture().spec, null, 2));
    expect(fixture.componentInstance.fileName()).toBe('studio-system-gestion_des_conges.json');
    expect(document.body.textContent).toContain('Fichier : studio-system-gestion_des_conges.json');
  });

  it('ouvert sans clé ⇒ charge la liste des systèmes et propose un p-select', async () => {
    const fixture = await create(null);

    expect(studio.listSystems).toHaveBeenCalledTimes(1);
    expect(builds.exportSystem).not.toHaveBeenCalled();
    expect(document.querySelector('p-select')).toBeTruthy();
    expect(fixture.componentInstance.systems()).toEqual(SYSTEMS);
    expect(document.querySelector('pre.saie__json')).toBeNull();

    fixture.componentInstance.selectedKey.set('parc_auto');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(builds.exportSystem).toHaveBeenCalledWith('parc_auto', false);
    expect(document.querySelector('pre.saie__json')).toBeTruthy();
  });

  it('la case « Inclure les données de départ » relance l’export avec includeSeed=true', async () => {
    const fixture = await create('gestion_des_conges');
    expect(builds.exportSystem).toHaveBeenCalledTimes(1);

    const box = document.querySelector('#saie-seed input[type="checkbox"], input#saie-seed') as HTMLInputElement | null;
    expect(box).withContext('case « Inclure les données de départ » absente').toBeTruthy();
    box?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.includeSeed()).toBeTrue();
    expect(builds.exportSystem).toHaveBeenCalledTimes(2);
    expect(builds.exportSystem.calls.mostRecent().args).toEqual(['gestion_des_conges', true]);
  });

  it('affiche les compteurs et les points à vérifier renvoyés par le serveur', async () => {
    const dto = studioSystemExportFixture();
    dto.warnings = ['La formule « Solde restant » est exportée en texte.'];
    builds.exportSystem.and.returnValue(of({ success: true, data: dto, message: null, errors: [] }));

    await create('gestion_des_conges');

    const text = document.body.textContent ?? '';
    expect(text).toContain('2 tables · 1 relations · 2 vues');
    expect(text).toContain('Points à vérifier');
    const items = Array.from(document.querySelectorAll('ul.saie__warnings li')).map(li => li.textContent?.trim());
    expect(items.length).toBe(1);
    expect(items[0]).toContain('Solde restant');
  });

  it('« Copier » écrit la spec indentée dans le presse-papiers et affiche « Copié »', async () => {
    const fixture = await create('gestion_des_conges');
    const writeText = spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());

    const copyButton = buttonByAction('copy');
    expect(copyButton?.disabled).toBeFalse();
    copyButton?.click();
    // Laisse la promesse du presse-papiers se résoudre sans attendre les 2 s du retour à « Copier ».
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledOnceWith(JSON.stringify(studioSystemExportFixture().spec, null, 2));
    expect(fixture.componentInstance.copied()).toBeTrue();
    expect(copyButton?.textContent).toContain('Copié');
  });

  it('« Télécharger » crée un blob application/json nommé studio-system-<clé>.json', async () => {
    const fixture = await create('gestion_des_conges');
    let blob: Blob | null = null;
    let downloadName = '';
    const createUrl = spyOn(URL, 'createObjectURL').and.callFake((b: Blob | MediaSource) => {
      blob = b as Blob;
      return 'blob:studio-test';
    });
    const revokeUrl = spyOn(URL, 'revokeObjectURL').and.stub();
    const click = spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    const downloadButton = buttonByAction('download');
    expect(downloadButton?.disabled).toBeFalse();
    downloadButton?.click();
    fixture.detectChanges();

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    // L'URL n'est révoquée qu'après le clic (setTimeout 0) pour laisser le navigateur démarrer le téléchargement.
    expect(revokeUrl).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(revokeUrl).toHaveBeenCalledOnceWith('blob:studio-test');
    expect(blob).toBeTruthy();
    expect(blob!.type).toBe('application/json');
    expect(downloadName).toBe('studio-system-gestion_des_conges.json');
    const content = await new Response(blob!).text();
    expect(content).toBe(JSON.stringify(studioSystemExportFixture().spec, null, 2));
  });

  it('404 flag coupé ⇒ message d’erreur, aucun aperçu', async () => {
    builds.exportSystem.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found', url: '/api/studio/systems/x/export' }))
    );

    const fixture = await create('gestion_des_conges');

    expect(fixture.componentInstance.error()).toBeTruthy();
    expect(fixture.componentInstance.result()).toBeNull();
    expect(document.querySelector('pre.saie__json')).toBeNull();
    expect(document.body.textContent).toContain('Export impossible.');
    expect(buttonByAction('copy')?.disabled).toBeTrue();
    expect(buttonByAction('download')?.disabled).toBeTrue();

    // Fermeture ⇒ remise à zéro de l'erreur.
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.error()).toBeNull();
  });
});
