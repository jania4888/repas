import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { LANDING_LOCALE_STORAGE_KEY, LandingLocaleService } from './landing-locale.service';

describe('LandingLocaleService', () => {
  let service: LandingLocaleService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LandingLocaleService);
    doc = TestBed.inject(DOCUMENT);
    localStorage.removeItem(LANDING_LOCALE_STORAGE_KEY);
  });

  afterEach(() => {
    service.restore();
    localStorage.removeItem(LANDING_LOCALE_STORAGE_KEY);
  });

  it('démarre en FR / LTR', () => {
    expect(service.locale()).toBe('fr');
    expect(service.dir()).toBe('ltr');
    expect(service.isRtl()).toBeFalse();
    expect(service.langTag()).toBe('fr-TN');
  });

  it("apply('ar') pose lang/dir sur <html>, la classe body et mémorise la préférence", () => {
    service.apply('ar');
    expect(doc.documentElement.getAttribute('lang')).toBe('ar');
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
    expect(doc.body.classList.contains('landing-rtl')).toBeTrue();
    expect(localStorage.getItem(LANDING_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(service.isRtl()).toBeTrue();
    expect(service.langTag()).toBe('ar-TN');
    expect(service.preferred()).toBe('ar');
  });

  it("apply('fr') repasse en LTR et retire la classe", () => {
    service.apply('ar');
    service.apply('fr');
    expect(doc.documentElement.getAttribute('dir')).toBe('ltr');
    expect(doc.documentElement.getAttribute('lang')).toBe('fr');
    expect(doc.body.classList.contains('landing-rtl')).toBeFalse();
    expect(service.preferred()).toBe('fr');
  });

  it('restore() rétablit fr/ltr sans toucher à la préférence mémorisée', () => {
    service.apply('ar');
    service.restore();
    expect(service.locale()).toBe('fr');
    expect(doc.documentElement.getAttribute('lang')).toBe('fr');
    expect(doc.documentElement.getAttribute('dir')).toBe('ltr');
    expect(doc.body.classList.contains('landing-rtl')).toBeFalse();
    expect(service.preferred()).toBe('ar');
  });

  it('est idempotent', () => {
    service.apply('ar');
    service.apply('ar');
    expect(doc.body.classList.contains('landing-rtl')).toBeTrue();
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it("n'échoue pas si localStorage est indisponible", () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    spyOn(Storage.prototype, 'getItem').and.throwError('denied');
    expect(() => service.apply('ar')).not.toThrow();
    expect(service.isRtl()).toBeTrue();
    expect(service.preferred()).toBeNull();
  });

  it('preferred() ignore une valeur inconnue', () => {
    localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, 'en');
    expect(service.preferred()).toBeNull();
  });
});
