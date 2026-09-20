import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { CustomSystem } from '../../studio.models';
import { StudioService } from '../../studio.service';
import { StudioAiDuplicateDialogComponent, StudioAiDuplicateRequest } from './studio-ai-duplicate-dialog.component';

const SYSTEMS: CustomSystem[] = [
  {
    id: 's1', key: 'gestion_des_conges', displayName: 'Gestion des congés', icon: null, description: null,
    onboardingSteps: null, isActive: true, entityCount: 4, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z'
  },
  {
    id: 's2', key: 'parc_auto', displayName: 'Parc auto', icon: null, description: null,
    onboardingSteps: null, isActive: true, entityCount: 3, createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z'
  }
];

describe('StudioAiDuplicateDialogComponent', () => {
  let studio: jasmine.SpyObj<StudioService>;

  beforeEach(async () => {
    studio = jasmine.createSpyObj<StudioService>('StudioService', ['listSystems']);
    studio.listSystems.and.returnValue(of({ success: true, data: SYSTEMS, message: null, errors: [] }));

    await TestBed.configureTestingModule({
      imports: [StudioAiDuplicateDialogComponent],
      providers: [provideNoopAnimations(), { provide: StudioService, useValue: studio }]
    }).compileComponents();
  });

  async function create(systemKey: string | null): Promise<ComponentFixture<StudioAiDuplicateDialogComponent>> {
    const fixture = TestBed.createComponent(StudioAiDuplicateDialogComponent);
    fixture.componentRef.setInput('systemKey', systemKey);
    fixture.detectChanges();
    // Fermé : aucun appel réseau (S-base).
    expect(studio.listSystems).not.toHaveBeenCalled();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function nameInput(): HTMLInputElement | null {
    return document.querySelector('input#said-name') as HTMLInputElement | null;
  }

  function submitButton(): HTMLButtonElement | null {
    return document.querySelector('button[data-action="duplicate"]') as HTMLButtonElement | null;
  }

  it('clé préréglée ⇒ pas de p-select, nom pré-rempli « <nom> (copie) »', async () => {
    const fixture = await create('gestion_des_conges');

    expect(document.querySelector('p-select')).toBeNull();
    expect(fixture.componentInstance.selectedKey()).toBe('gestion_des_conges');
    expect(document.querySelector('[data-role="source"]')?.textContent).toContain('Gestion des congés');
    expect(fixture.componentInstance.placeholder()).toBe('Gestion des congés (copie)');
    expect(nameInput()?.placeholder).toBe('Gestion des congés (copie)');
    expect(submitButton()?.disabled).toBeFalse();
  });

  it('sans clé ⇒ liste des systèmes dans un p-select', async () => {
    const fixture = await create(null);

    expect(studio.listSystems).toHaveBeenCalledTimes(1);
    expect(document.querySelector('p-select')).toBeTruthy();
    expect(document.querySelector('[data-role="source"]')).toBeNull();
    expect(fixture.componentInstance.systems()).toEqual(SYSTEMS);
    // Aucun système choisi ⇒ « Créer la copie » désactivé.
    expect(submitButton()?.disabled).toBeTrue();

    fixture.componentInstance.selectedKey.set('parc_auto');
    fixture.detectChanges();
    expect(fixture.componentInstance.placeholder()).toBe('Parc auto (copie)');
    expect(submitButton()?.disabled).toBeFalse();
  });

  it('nom limité à 128 caractères avec compteur', async () => {
    const fixture = await create('gestion_des_conges');
    const component = fixture.componentInstance;

    expect(nameInput()?.getAttribute('maxlength')).toBe('128');
    expect(document.querySelector('[data-role="name-counter"]')?.textContent?.trim()).toBe('0/128');

    component.onNameChange('Congés RH');
    fixture.detectChanges();
    expect(document.querySelector('[data-role="name-counter"]')?.textContent?.trim()).toBe('9/128');

    component.onNameChange('x'.repeat(200));
    fixture.detectChanges();
    expect(component.displayName().length).toBe(128);
    expect(document.querySelector('[data-role="name-counter"]')?.textContent?.trim()).toBe('128/128');
  });

  it('Créer la copie ⇒ émet { key, displayName|null }', async () => {
    const fixture = await create('gestion_des_conges');
    const component = fixture.componentInstance;
    const emitted: StudioAiDuplicateRequest[] = [];
    component.submitted.subscribe(req => emitted.push(req));

    component.onNameChange('  Congés 2027  ');
    fixture.detectChanges();
    submitButton()!.click();
    expect(emitted).toEqual([{ key: 'gestion_des_conges', displayName: 'Congés 2027' }]);

    // Nom vide ⇒ `null` (défaut serveur « <nom> (copie) »).
    component.onNameChange('   ');
    component.submit();
    expect(emitted.length).toBe(2);
    expect(emitted[1]).toEqual({ key: 'gestion_des_conges', displayName: null });

    // Occupé ⇒ bouton désactivé et aucune émission.
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(submitButton()?.disabled).toBeTrue();
    component.submit();
    expect(emitted.length).toBe(2);
  });
});
