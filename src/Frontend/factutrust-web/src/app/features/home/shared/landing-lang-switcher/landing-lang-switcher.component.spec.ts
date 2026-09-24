import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingLangSwitcherComponent } from './landing-lang-switcher.component';

@Component({ standalone: true, template: '' })
class StubPageComponent {}

describe('LandingLangSwitcherComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LandingLangSwitcherComponent],
      providers: [provideRouter([{ path: '**', component: StubPageComponent }])]
    });
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
  });

  async function create(url: string) {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(LandingLangSwitcherComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('propose un lien par langue avec lang/dir/hreflang et libellés du dictionnaire', async () => {
    if (!environment.landing?.arabicEnabled) {
      pending('arabe désactivé dans cet environnement');
      return;
    }
    const fixture = await create('/cabinets-comptables#contact');
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.lang-switcher__item')
    ) as HTMLAnchorElement[];
    expect(links.length).toBe(2);

    const [fr, ar] = links;
    expect(fr.getAttribute('lang')).toBe('fr');
    expect(fr.getAttribute('dir')).toBe('ltr');
    expect(fr.getAttribute('hreflang')).toBe('fr-TN');
    expect(fr.textContent?.trim()).toBe('FR');
    expect(ar.getAttribute('lang')).toBe('ar');
    expect(ar.getAttribute('dir')).toBe('rtl');
    expect(ar.getAttribute('hreflang')).toBe('ar-TN');
    expect(ar.textContent?.trim()).toBe('العربية');
    // Les deux liens ont un aria-label explicite (« Afficher la page en arabe »…).
    for (const link of links) {
      expect(link.getAttribute('aria-label')?.trim().length).toBeGreaterThan(0);
    }
  });

  it('conserve le chemin et le fragment : /cabinets-comptables#contact → /ar/cabinets-comptables#contact', async () => {
    if (!environment.landing?.arabicEnabled) {
      pending('arabe désactivé dans cet environnement');
      return;
    }
    const fixture = await create('/cabinets-comptables#contact');
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.lang-switcher__item')
    ) as HTMLAnchorElement[];
    const ar = links.find(a => a.getAttribute('lang') === 'ar')!;
    expect(ar.getAttribute('href')).toBe('/ar/cabinets-comptables#contact');
  });

  it('sur /ar, le lien FR retire le préfixe et porte aria-current sur la langue active', async () => {
    if (!environment.landing?.arabicEnabled) {
      pending('arabe désactivé dans cet environnement');
      return;
    }
    TestBed.inject(LandingLocaleService).apply('ar');
    const fixture = await create('/ar#tarifs');
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.lang-switcher__item')
    ) as HTMLAnchorElement[];
    const fr = links.find(a => a.getAttribute('lang') === 'fr')!;
    const ar = links.find(a => a.getAttribute('lang') === 'ar')!;
    expect(fr.getAttribute('href')).toBe('/#tarifs');
    expect(ar.getAttribute('aria-current')).toBe('true');
    expect(fr.getAttribute('aria-current')).toBeNull();
  });

  it('ne rend rien quand l’arabe est désactivé (rollback sans code)', async () => {
    if (environment.landing?.arabicEnabled) {
      pending('assertion réservée à l’environnement de production (arabicEnabled=false)');
      return;
    }
    const fixture = await create('/');
    expect(fixture.nativeElement.querySelector('.lang-switcher')).toBeNull();
  });
});
