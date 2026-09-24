import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HomeThemeService } from '@core/services/home-theme.service';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingScrollService } from '@core/services/landing-scroll.service';
import { LandingSeoService } from '@core/services/landing-seo.service';
import { environment } from '@environments/environment';
import { LandingShellComponent } from './landing-shell.component';

@Component({ standalone: true, template: `<h1 id="home-page">home</h1>` })
class HomeStubComponent {}

@Component({ standalone: true, template: `<h1 id="cabinets-page">cabinets</h1>` })
class CabinetsStubComponent {}

@Component({ standalone: true, template: `<p id="login-page">login</p>` })
class LoginStubComponent {}

describe('LandingShellComponent', () => {
  let theme: jasmine.SpyObj<HomeThemeService>;
  let seo: jasmine.SpyObj<LandingSeoService>;
  let scroll: jasmine.SpyObj<LandingScrollService>;
  let locale: LandingLocaleService;
  let originalArabicEnabled: boolean;

  const children = [
    { path: '', pathMatch: 'full' as const, component: HomeStubComponent, data: { seoPage: 'home' } },
    { path: 'cabinets-comptables', component: CabinetsStubComponent, data: { seoPage: 'cabinets' } }
  ];

  beforeEach(() => {
    originalArabicEnabled = environment.landing.arabicEnabled;
    environment.landing.arabicEnabled = true;
    theme = jasmine.createSpyObj<HomeThemeService>('HomeThemeService', [
      'loadChainTheme',
      'unloadChainTheme',
      'cancelPendingUnload',
      'resyncAnimations'
    ]);
    seo = jasmine.createSpyObj<LandingSeoService>('LandingSeoService', ['apply', 'restore']);
    scroll = jasmine.createSpyObj<LandingScrollService>('LandingScrollService', ['scrollToAnchor', 'scrollToTop']);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: LandingShellComponent, data: { locale: 'fr' }, children },
          { path: 'ar', component: LandingShellComponent, data: { locale: 'ar' }, children },
          { path: 'auth/login', component: LoginStubComponent }
        ]),
        { provide: HomeThemeService, useValue: theme },
        { provide: LandingSeoService, useValue: seo },
        { provide: LandingScrollService, useValue: scroll }
      ]
    });
    locale = TestBed.inject(LandingLocaleService);
  });

  afterEach(() => {
    locale.restore();
    environment.landing.arabicEnabled = originalArabicEnabled;
  });

  it("à l'init : locale, thème (après annulation d'un déchargement en attente) puis SEO de l'enfant", fakeAsync(async () => {
    const harness = await RouterTestingHarness.create('/');
    tick();

    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(theme.cancelPendingUnload).toHaveBeenCalledBefore(theme.loadChainTheme);
    expect(theme.loadChainTheme).toHaveBeenCalledWith('fr');
    expect(seo.apply).toHaveBeenCalledWith(jasmine.objectContaining({ page: 'home', locale: 'fr' }));
    expect(harness.routeNativeElement?.querySelector('#home-page')).toBeTruthy();
    expect(scroll.scrollToTop).not.toHaveBeenCalled();
    expect(scroll.scrollToAnchor).not.toHaveBeenCalled();
  }));

  it('navigation / → /cabinets-comptables : le shell survit, le thème est chargé une seule fois, SEO cabinet + haut de page', fakeAsync(async () => {
    const harness = await RouterTestingHarness.create('/');
    tick();
    await harness.navigateByUrl('/cabinets-comptables');
    tick();

    expect(theme.loadChainTheme).toHaveBeenCalledTimes(1);
    expect(theme.unloadChainTheme).not.toHaveBeenCalled();
    expect(seo.apply.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ page: 'cabinets', locale: 'fr' }));
    expect(scroll.scrollToTop).toHaveBeenCalledTimes(1);
  }));

  it('un fragment déclenche scrollToAnchor et pas scrollToTop', fakeAsync(async () => {
    const harness = await RouterTestingHarness.create('/');
    tick();
    await harness.navigateByUrl('/cabinets-comptables#contact');
    tick();

    expect(scroll.scrollToAnchor).toHaveBeenCalledWith('contact');
    expect(scroll.scrollToTop).not.toHaveBeenCalled();
  }));

  it('montage /ar : lang=ar dir=rtl et thème RTL', fakeAsync(async () => {
    await RouterTestingHarness.create('/ar');
    tick();

    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(theme.loadChainTheme).toHaveBeenCalledWith('ar');
    expect(seo.apply).toHaveBeenCalledWith(jasmine.objectContaining({ page: 'home', locale: 'ar' }));
  }));

  it("sortie vers /auth/login : restore() du SEO, déchargement du thème et retour à lang=fr dir=ltr", fakeAsync(async () => {
    const harness = await RouterTestingHarness.create('/ar');
    tick();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    await harness.navigateByUrl('/auth/login');
    tick();

    expect(seo.restore).toHaveBeenCalled();
    expect(theme.unloadChainTheme).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.body.classList.contains('landing-rtl')).toBeFalse();
    expect(TestBed.inject(Router).url).toBe('/auth/login');
  }));
});
