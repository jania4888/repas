import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TurnstileLoaderService } from './turnstile-loader.service';
import { TurnstileWidgetComponent } from './turnstile-widget.component';
import type { TurnstileApi, TurnstileRenderOptions } from './turnstile.types';

describe('TurnstileWidgetComponent', () => {
  let api: jasmine.SpyObj<TurnstileApi>;
  let renderOptions: TurnstileRenderOptions | undefined;
  let loader: { load: jasmine.Spy<() => Promise<TurnstileApi>> };

  beforeEach(() => {
    renderOptions = undefined;
    api = jasmine.createSpyObj<TurnstileApi>('turnstile', ['render', 'reset', 'remove']);
    api.render.and.callFake((_el, o) => {
      renderOptions = o;
      return 'widget-1';
    });
    loader = { load: jasmine.createSpy('load').and.returnValue(Promise.resolve(api)) };
    TestBed.configureTestingModule({
      imports: [TurnstileWidgetComponent],
      providers: [{ provide: TurnstileLoaderService, useValue: loader }]
    });
  });

  function create(locale: 'fr' | 'ar' = 'fr'): ComponentFixture<TurnstileWidgetComponent> {
    const fixture = TestBed.createComponent(TurnstileWidgetComponent);
    fixture.componentRef.setInput('siteKey', 'site-key');
    fixture.componentRef.setInput('locale', locale);
    fixture.componentRef.setInput('ariaLabel', 'Vérification anti-robot');
    fixture.detectChanges();
    return fixture;
  }

  it('rend le widget avec sitekey, action « contact », langue et thème clair', async () => {
    const fixture = create('ar');
    await fixture.whenStable();
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(api.render).toHaveBeenCalledTimes(1);
    const host = fixture.nativeElement.querySelector('.turnstile-host') as HTMLElement;
    expect(api.render.calls.mostRecent().args[0]).toBe(host);
    expect(host.getAttribute('aria-label')).toBe('Vérification anti-robot');
    expect(renderOptions).toEqual(
      jasmine.objectContaining({ sitekey: 'site-key', action: 'contact', language: 'ar', theme: 'light', 'response-field': false })
    );
  });

  it('émet le jeton via callback puis null à l’expiration', async () => {
    const fixture = create();
    const tokens: (string | null)[] = [];
    fixture.componentInstance.token.subscribe(t => tokens.push(t));
    await fixture.whenStable();
    renderOptions!.callback('tok-123');
    renderOptions!['expired-callback']!();
    expect(tokens).toEqual(['tok-123', null]);
  });

  it('reset() réinitialise le widget et émet null ; la destruction retire le widget', async () => {
    const fixture = create();
    const tokens: (string | null)[] = [];
    fixture.componentInstance.token.subscribe(t => tokens.push(t));
    await fixture.whenStable();
    fixture.componentInstance.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    expect(tokens).toEqual([null]);
    fixture.destroy();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('émet failed si le script Turnstile ne peut pas être chargé', async () => {
    loader.load.and.returnValue(Promise.reject(new Error('offline')));
    const fixture = TestBed.createComponent(TurnstileWidgetComponent);
    fixture.componentRef.setInput('siteKey', 'site-key');
    let failed = 0;
    fixture.componentInstance.failed.subscribe(() => failed++);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    expect(failed).toBe(1);
    expect(api.render).not.toHaveBeenCalled();
  });
});
