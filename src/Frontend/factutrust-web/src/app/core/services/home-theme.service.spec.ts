import { DOCUMENT } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  BOOTSTRAP_CSS,
  CHAIN_BOOTSTRAP_LINK_ID,
  CHAIN_BOOTSTRAP_NEXT_LINK_ID,
  CHAIN_CSS_AFTER_BOOTSTRAP,
  CHAIN_THEME_LINK_ID_PREFIX,
  CHAIN_THEME_SCRIPT_ID,
  HomeThemeService,
  LANDING_ARABIC_FONT_PRELOADS,
  LANDING_FONT_PRELOAD_ID_PREFIX,
  LANDING_RTL_CSS,
  LANDING_RTL_LINK_ID
} from './home-theme.service';

describe('HomeThemeService', () => {
  let service: HomeThemeService;
  let doc: Document;
  let reduced = false;
  const g = globalThis as { wow?: { stop: jasmine.Spy; init: jasmine.Spy } };
  const originalWow = g.wow;

  const byId = (id: string): HTMLElement | null => doc.getElementById(id);
  const hrefOf = (id: string): string | null => byId(id)?.getAttribute('href') ?? null;
  const themeIds = (): string[] =>
    Array.from(doc.querySelectorAll('link[id^="factutrust-"], script[id^="factutrust-"]')).map(e => e.id);

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HomeThemeService);
    doc = TestBed.inject(DOCUMENT);
    reduced = false;
    spyOn(window, 'matchMedia').and.callFake(() => ({ matches: reduced }) as MediaQueryList);
    // Empêche Karma de charger réellement animation.js / les CSS : on garde des <link>/<script> inertes.
    spyOnProperty(HTMLScriptElement.prototype, 'src', 'set').and.stub();
    g.wow = { stop: jasmine.createSpy('stop'), init: jasmine.createSpy('init') };
  });

  afterEach(fakeAsync(() => {
    service.unloadChainTheme();
    tick(1);
    doc.querySelectorAll('link[id^="factutrust-"], script[id^="factutrust-"]').forEach(e => e.remove());
    g.wow = originalWow;
  }));

  it('charge Bootstrap LTR puis les feuilles Chain (sans owl.css) et animation.js en FR', () => {
    service.loadChainTheme();
    expect(service.isLoaded).toBeTrue();
    expect(service.currentDir).toBe('ltr');
    expect(hrefOf(CHAIN_BOOTSTRAP_LINK_ID)).toBe(BOOTSTRAP_CSS.ltr);
    CHAIN_CSS_AFTER_BOOTSTRAP.forEach((href, i) => expect(hrefOf(`${CHAIN_THEME_LINK_ID_PREFIX}${i}`)).toBe(href));
    expect(themeIds().some(id => hrefOf(id)?.includes('owl.css'))).toBeFalse();
    expect(byId(CHAIN_THEME_SCRIPT_ID)).not.toBeNull();
    expect(byId(LANDING_RTL_LINK_ID)).toBeNull();
    expect(byId(`${LANDING_FONT_PRELOAD_ID_PREFIX}0`)).toBeNull();

    // Ordre : Bootstrap avant les feuilles Chain
    const ids = themeIds();
    expect(ids.indexOf(CHAIN_BOOTSTRAP_LINK_ID)).toBeLessThan(ids.indexOf(`${CHAIN_THEME_LINK_ID_PREFIX}0`));
  });

  it('est idempotent : un second appel identique n’ajoute rien', () => {
    service.loadChainTheme('fr');
    const before = themeIds().length;
    service.loadChainTheme('fr');
    expect(themeIds().length).toBe(before);
  });

  it('charge Bootstrap RTL, landing-rtl.css et les préchargements de police en AR', () => {
    service.loadChainTheme('ar');
    expect(service.currentDir).toBe('rtl');
    expect(hrefOf(CHAIN_BOOTSTRAP_LINK_ID)).toBe(BOOTSTRAP_CSS.rtl);
    expect(hrefOf(LANDING_RTL_LINK_ID)).toBe(LANDING_RTL_CSS);
    LANDING_ARABIC_FONT_PRELOADS.forEach((href, i) => {
      const link = byId(`${LANDING_FONT_PRELOAD_ID_PREFIX}${i}`) as HTMLLinkElement;
      expect(link).not.toBeNull();
      expect(link.rel).toBe('preload');
      expect(link.getAttribute('as')).toBe('font');
      expect(link.getAttribute('href')).toBe(href);
      expect(link.crossOrigin).toBe('anonymous');
    });
  });

  it('n’injecte pas animation.js quand l’utilisateur préfère réduire les animations', () => {
    reduced = true;
    service.loadChainTheme('fr');
    expect(byId(CHAIN_THEME_SCRIPT_ID)).toBeNull();
    expect(byId(CHAIN_BOOTSTRAP_LINK_ID)).not.toBeNull();
  });

  it('swapDirection insère la nouvelle feuille avant l’ancienne puis retire l’ancienne au load', () => {
    service.loadChainTheme('fr');
    const old = byId(CHAIN_BOOTSTRAP_LINK_ID)!;
    service.loadChainTheme('ar');
    expect(service.currentDir).toBe('rtl');

    const next = byId(CHAIN_BOOTSTRAP_NEXT_LINK_ID) as HTMLLinkElement;
    expect(next).not.toBeNull();
    expect(next.getAttribute('href')).toBe(BOOTSTRAP_CSS.rtl);
    expect(next.nextElementSibling).toBe(old);
    expect(doc.contains(old)).toBeTrue();
    expect(byId(LANDING_RTL_LINK_ID)).toBeNull();

    next.dispatchEvent(new Event('load'));
    expect(doc.contains(old)).toBeFalse();
    expect(byId(CHAIN_BOOTSTRAP_NEXT_LINK_ID)).toBeNull();
    expect(hrefOf(CHAIN_BOOTSTRAP_LINK_ID)).toBe(BOOTSTRAP_CSS.rtl);
    expect(hrefOf(LANDING_RTL_LINK_ID)).toBe(LANDING_RTL_CSS);
    expect(g.wow!.stop).toHaveBeenCalled();
    expect(g.wow!.init).toHaveBeenCalled();
  });

  it('retour AR → FR retire landing-rtl.css et les préchargements', () => {
    service.loadChainTheme('ar');
    service.swapDirection('ltr');
    (byId(CHAIN_BOOTSTRAP_NEXT_LINK_ID) as HTMLLinkElement).dispatchEvent(new Event('load'));
    expect(hrefOf(CHAIN_BOOTSTRAP_LINK_ID)).toBe(BOOTSTRAP_CSS.ltr);
    expect(byId(LANDING_RTL_LINK_ID)).toBeNull();
    expect(byId(`${LANDING_FONT_PRELOAD_ID_PREFIX}0`)).toBeNull();
    expect(service.currentDir).toBe('ltr');
  });

  it('unloadChainTheme est différé et retire tout, en arrêtant WOW', fakeAsync(() => {
    service.loadChainTheme('ar');
    service.unloadChainTheme();
    expect(byId(CHAIN_BOOTSTRAP_LINK_ID)).withContext('encore présent avant le tick').not.toBeNull();
    tick(0);
    expect(themeIds()).toEqual([]);
    expect(service.isLoaded).toBeFalse();
    expect(g.wow!.stop).toHaveBeenCalled();
  }));

  it('un loadChainTheme dans le même tick annule le déchargement différé (/ → /ar)', fakeAsync(() => {
    service.loadChainTheme('fr');
    const bootstrap = byId(CHAIN_BOOTSTRAP_LINK_ID);
    service.unloadChainTheme();
    service.loadChainTheme('fr');
    tick(0);
    expect(byId(CHAIN_BOOTSTRAP_LINK_ID)).toBe(bootstrap);
    expect(service.isLoaded).toBeTrue();
  }));

  it('resyncAnimations est sans effet si WOW est absent', () => {
    g.wow = undefined;
    expect(() => service.resyncAnimations()).not.toThrow();
  });
});
