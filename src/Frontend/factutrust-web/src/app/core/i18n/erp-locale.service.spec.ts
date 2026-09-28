import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { ErpPreferencesService } from '@core/services/erp-preferences.service';
import {
  resolveBootLocale,
  setErpBootArabicCatalogRejectedForTests,
  setErpBootEffectiveLocaleForTests
} from './erp-boot-locale';
import { ErpLocaleService } from './erp-locale.service';
import {
  ERP_FORCE_FR_SESSION_KEY,
  ERP_LOCALE_STORAGE_KEY,
  ERP_LOCALE_SYNC_RELOAD_KEY
} from './erp-locale.types';

describe('ErpLocaleService', () => {
  let service: ErpLocaleService;
  let reload: jasmine.Spy;
  const firm = signal(false);
  const portal = signal(false);
  const user = signal<{ id: string } | null>(null);
  const router = { url: '/dashboard', navigated: true };

  function setup(): void {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            user,
            isAccountingFirm: firm,
            isClientPortal: portal,
            isAuthenticated: () => !!user()
          }
        },
        { provide: ErpPreferencesService, useValue: { setLanguage: () => Promise.resolve() } },
        { provide: Router, useValue: router }
      ]
    });
    service = TestBed.inject(ErpLocaleService);
    reload = spyOn(service as unknown as { reload: () => void }, 'reload');
  }

  beforeEach(() => {
    firm.set(false);
    portal.set(false);
    user.set(null);
    router.url = '/dashboard';
    localStorage.removeItem(ERP_LOCALE_STORAGE_KEY);
    sessionStorage.removeItem(ERP_FORCE_FR_SESSION_KEY);
    sessionStorage.removeItem(ERP_LOCALE_SYNC_RELOAD_KEY);
    setErpBootEffectiveLocaleForTests('fr');
    setErpBootArabicCatalogRejectedForTests(false);
    setup();
  });

  afterEach(() => {
    setErpBootEffectiveLocaleForTests('fr');
    sessionStorage.removeItem(ERP_FORCE_FR_SESSION_KEY);
    sessionStorage.removeItem(ERP_LOCALE_SYNC_RELOAD_KEY);
    localStorage.removeItem(ERP_LOCALE_STORAGE_KEY);
    document.documentElement.setAttribute('lang', 'fr');
    document.documentElement.setAttribute('dir', 'ltr');
  });

  it('resolve applique fr par défaut', () => {
    service.resolve();
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(reload).not.toHaveBeenCalled();
  });

  it('ne pose pas le rtl si le catalogue arabe a été refusé au démarrage', () => {
    setErpBootArabicCatalogRejectedForTests(true);
    localStorage.setItem(ERP_LOCALE_STORAGE_KEY, 'ar');
    document.documentElement.setAttribute('dir', 'rtl');

    const locale = service.resolve({ userPreferredLanguage: 'ar' });

    expect(locale).toBe('fr');
    expect(service.locale()).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(localStorage.getItem(ERP_LOCALE_STORAGE_KEY)).toBe('ar');
  });

  it('dir suit le catalogue chargé : pas de rtl sur un catalogue français', () => {
    sessionStorage.setItem(ERP_LOCALE_SYNC_RELOAD_KEY, '1');

    const locale = service.resolve({ userPreferredLanguage: 'ar' });

    expect(reload).not.toHaveBeenCalled();
    expect(locale).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('préférence différente du catalogue : un seul rechargement de synchronisation', () => {
    service.resolve({ userPreferredLanguage: 'ar' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ERP_LOCALE_STORAGE_KEY)).toBe('ar');

    reload.calls.reset();
    service.resolve({ userPreferredLanguage: 'ar' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('espace cabinet : français, sélecteur masqué', () => {
    firm.set(true);
    setErpBootEffectiveLocaleForTests('ar');
    expect(service.shouldShowLanguageSwitcher()).toBeFalse();
    expect(service.resolve({ userPreferredLanguage: 'ar' })).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('pages hors périmètre reconnues par le chemin, query string comprise', () => {
    for (const url of ['/firm/dashboard', '/portal', '/auth/register-firm?plan=pro', '/auth/accept-portal-invite/abc']) {
      router.url = url;
      expect(service.shouldShowLanguageSwitcher()).withContext(url).toBeFalse();
    }
    router.url = '/settings/accounting-firm';
    expect(service.shouldShowLanguageSwitcher()).toBeTrue();
  });

  it('connexion cabinet avec le catalogue arabe chargé : marqueur de session puis rechargement', () => {
    setErpBootEffectiveLocaleForTests('ar');
    firm.set(true);
    user.set({ id: 'u1' });
    TestBed.flushEffects();

    expect(sessionStorage.getItem(ERP_FORCE_FR_SESSION_KEY)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('connexion société en arabe : aucun rechargement', () => {
    setErpBootEffectiveLocaleForTests('ar');
    user.set({ id: 'u2' });
    TestBed.flushEffects();

    expect(sessionStorage.getItem(ERP_FORCE_FR_SESSION_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('le marqueur de session force le démarrage en français', () => {
    localStorage.setItem(ERP_LOCALE_STORAGE_KEY, 'ar');
    sessionStorage.setItem(ERP_FORCE_FR_SESSION_KEY, '1');
    expect(resolveBootLocale(true)).toBe('fr');
    sessionStorage.removeItem(ERP_FORCE_FR_SESSION_KEY);
    expect(resolveBootLocale(true)).toBe('ar');
  });

  it('retour en contexte société : le marqueur est levé', () => {
    sessionStorage.setItem(ERP_FORCE_FR_SESSION_KEY, '1');
    service.resolve();
    expect(sessionStorage.getItem(ERP_FORCE_FR_SESSION_KEY)).toBeNull();
  });

  it("setLocaleAndReload : refuse l'arabe en espace cabinet, lève le marqueur sinon", async () => {
    firm.set(true);
    await service.setLocaleAndReload('ar');
    expect(reload).not.toHaveBeenCalled();

    firm.set(false);
    sessionStorage.setItem(ERP_FORCE_FR_SESSION_KEY, '1');
    await service.setLocaleAndReload('ar');
    expect(sessionStorage.getItem(ERP_FORCE_FR_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(ERP_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
