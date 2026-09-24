import { DOCUMENT } from '@angular/common';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LANDING_HEADER_OFFSET_PX, LANDING_SCROLL_RETRY_MS, LandingScrollService } from './landing-scroll.service';

describe('LandingScrollService', () => {
  let service: LandingScrollService;
  let doc: Document;
  let scrollSpy: jasmine.Spy;
  let matchMediaSpy: jasmine.Spy;
  let reduced = false;
  const created: HTMLElement[] = [];

  function addSection(id: string, top = 500, tabindex = true): HTMLElement {
    const el = doc.createElement('section');
    el.id = id;
    if (tabindex) {
      el.setAttribute('tabindex', '-1');
    }
    spyOn(el, 'getBoundingClientRect').and.returnValue({ top } as DOMRect);
    doc.body.appendChild(el);
    created.push(el);
    return el;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LandingScrollService);
    doc = TestBed.inject(DOCUMENT);
    reduced = false;
    scrollSpy = spyOn(window, 'scrollTo').and.stub();
    matchMediaSpy = spyOn(window, 'matchMedia').and.callFake(
      () => ({ matches: reduced }) as MediaQueryList
    );
  });

  afterEach(() => {
    created.splice(0).forEach(el => el.remove());
  });

  it('défile vers la section en compensant la hauteur du header et lui donne le focus', () => {
    const el = addSection('tarifs', 640);
    const focusSpy = spyOn(el, 'focus');
    expect(service.scrollToAnchor('tarifs')).toBeTrue();
    const args = scrollSpy.calls.mostRecent().args[0] as ScrollToOptions;
    expect(args.top).toBe(640 + window.scrollY - LANDING_HEADER_OFFSET_PX);
    expect(args.behavior).toBe('smooth');
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('utilise behavior=auto quand l’utilisateur préfère réduire les animations', () => {
    reduced = true;
    addSection('faq', 300, false);
    service.scrollToAnchor('faq');
    expect((scrollSpy.calls.mostRecent().args[0] as ScrollToOptions).behavior).toBe('auto');
    expect(service.prefersReducedMotion()).toBeTrue();
  });

  it('ne donne pas le focus à une cible sans tabindex', () => {
    const el = addSection('modules', 300, false);
    const focusSpy = spyOn(el, 'focus');
    service.scrollToAnchor('modules');
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('ré-essaie jusqu’à 3 fois (300 ms) si la section n’est pas encore rendue', fakeAsync(() => {
    expect(service.scrollToAnchor('contact')).toBeFalse();
    expect(scrollSpy).not.toHaveBeenCalled();
    tick(LANDING_SCROLL_RETRY_MS);
    addSection('contact', 900);
    tick(LANDING_SCROLL_RETRY_MS);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  }));

  it('abandonne après 3 tentatives sans cible', fakeAsync(() => {
    service.scrollToAnchor('inexistant');
    tick(LANDING_SCROLL_RETRY_MS * 5);
    expect(scrollSpy).not.toHaveBeenCalled();
  }));

  it('scrollToTop remonte en haut de page', () => {
    service.scrollToTop();
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
