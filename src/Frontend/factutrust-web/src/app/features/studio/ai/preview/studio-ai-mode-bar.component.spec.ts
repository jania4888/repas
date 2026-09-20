import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiPreviewMode } from '../studio-ai.models';
import { StudioAiModeBarComponent } from './studio-ai-mode-bar.component';

describe('StudioAiModeBarComponent', () => {
  let fixture: ComponentFixture<StudioAiModeBarComponent>;
  const labels = STUDIO_AI_LABELS.modes;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiModeBarComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiModeBarComponent);
    fixture.componentRef.setInput('mode', 'preview');
    fixture.detectChanges();
  });

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function modeButtons(): HTMLButtonElement[] {
    return Array.from(root().querySelectorAll<HTMLButtonElement>('.sai-modebar__btn'));
  }

  function expiry(): HTMLElement | null {
    return root().querySelector<HTMLElement>('.sai-expiry');
  }

  it('rend trois boutons avec aria-pressed sur le mode actif', () => {
    const toolbar = root().querySelector('.sai-modebar');
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    expect(toolbar?.getAttribute('aria-label')).toBe(labels.toolbar);

    const buttons = modeButtons();
    expect(buttons.length).toBe(3);
    expect(buttons.map(b => b.dataset['mode'])).toEqual(['preview', 'test', 'customize']);
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(buttons.map(b => b.textContent?.trim())).toEqual([labels.preview, labels.test, labels.customize]);
    expect(expiry()).withContext('pas de pilule sans échéance').toBeNull();

    fixture.componentRef.setInput('mode', 'customize');
    fixture.detectChanges();
    expect(modeButtons().map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('émet modeChange au clic', () => {
    const emitted: StudioAiPreviewMode[] = [];
    fixture.componentInstance.modeChange.subscribe(m => emitted.push(m));

    modeButtons().find(b => b.dataset['mode'] === 'test')?.click();
    modeButtons().find(b => b.dataset['mode'] === 'preview')?.click();

    expect(emitted).withContext('le mode déjà actif n’est pas ré-émis').toEqual(['test']);
  });

  it('affiche « Expire dans » au format mm:ss et passe en alerte sous 5 minutes', () => {
    fixture.componentRef.setInput('expiresInSeconds', 581);
    fixture.detectChanges();

    let pill = expiry();
    expect(pill?.getAttribute('role')).toBe('status');
    expect(pill?.getAttribute('aria-live')).toBe('polite');
    expect(pill?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${labels.expiresIn} 09:41`);
    expect(pill?.getAttribute('aria-label')).toBe(`${labels.expiresIn} 9 minutes 41 secondes`);
    expect(pill?.classList.contains('sai-expiry--warn')).toBeFalse();

    fixture.componentRef.setInput('expiresInSeconds', 299);
    fixture.detectChanges();
    pill = expiry();
    expect(pill?.textContent).toContain('04:59');
    expect(pill?.classList.contains('sai-expiry--warn')).toBeTrue();
    expect(pill?.classList.contains('sai-expiry--expired')).toBeFalse();
    expect(modeButtons().every(b => !b.disabled)).toBeTrue();
  });

  it('à 0 affiche Expiré, désactive les modes et propose Régénérer', () => {
    const regenerated: number[] = [];
    fixture.componentInstance.regenerate.subscribe(() => regenerated.push(1));
    fixture.componentRef.setInput('expiresInSeconds', 0);
    fixture.detectChanges();

    const pill = expiry();
    expect(pill?.textContent?.trim()).toBe(labels.expired);
    expect(pill?.classList.contains('sai-expiry--expired')).toBeTrue();
    expect(pill?.getAttribute('aria-label')).toBe(labels.expired);
    expect(modeButtons().every(b => b.disabled)).toBeTrue();
    expect(root().querySelector('.sai-modebar')?.getAttribute('aria-disabled')).toBe('true');

    const regen = Array.from(root().querySelectorAll('button'))
      .find(b => b.textContent?.includes(labels.regenerate));
    expect(regen).withContext('bouton « Régénérer »').toBeDefined();
    regen?.click();
    expect(regenerated.length).toBe(1);
  });

  it('affiche le badge du nombre de modifications', () => {
    expect(root().querySelector('.sai-modebar__badge')).toBeNull();

    fixture.componentRef.setInput('changeCount', 3);
    fixture.detectChanges();

    const badge = root().querySelector('.sai-modebar__badge');
    expect(badge?.textContent?.trim()).toBe('3');
    expect(badge?.closest('.sai-modebar__btn')?.getAttribute('data-mode')).toBe('customize');
    expect(badge?.getAttribute('aria-label')).toBe(`3 ${labels.changes}`);
  });
});
