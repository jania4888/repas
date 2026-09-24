import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PublicHeaderComponent } from './public-header.component';

describe('PublicHeaderComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicHeaderComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    document.body.style.overflow = '';
    httpMock.verify();
  });

  function create() {
    const fixture = TestBed.createComponent(PublicHeaderComponent);
    fixture.detectChanges();
    // <app-landing-cta> charge le statut d'inscription
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled: false, firmEnabled: false } });
    fixture.detectChanges();
    return fixture;
  }

  function navLinks(fixture: { nativeElement: HTMLElement }): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('ul.nav a'));
  }

  it('expose 6 ancres + le lien Cabinets comptables, puis le CTA dynamique, puis « Se connecter » en dernier', () => {
    const fixture = create();
    const hrefs = navLinks(fixture).map(a => a.getAttribute('href') ?? '');
    expect(hrefs).toContain('/#top');
    expect(hrefs).toContain('/#modules');
    expect(hrefs).toContain('/#nouveautes');
    expect(hrefs).toContain('/#tarifs');
    expect(hrefs).toContain('/#securite-detail');
    expect(hrefs).toContain('/#faq');
    expect(hrefs).toContain('/cabinets-comptables');
    // Le dernier <li> porte le lien de connexion
    const items = Array.from(fixture.nativeElement.querySelectorAll('ul.nav > li')) as HTMLElement[];
    const last = items[items.length - 1];
    const login = last.querySelector('a');
    expect(login?.getAttribute('href')).toBe('/auth/login');
  });

  it('monte le sélecteur de langue (TD3) dans le slot avant le login', () => {
    const fixture = create();
    const slot = fixture.nativeElement.querySelector('.landing-lang-slot') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.querySelector('app-landing-lang-switcher')).not.toBeNull();
    const items = Array.from(fixture.nativeElement.querySelectorAll('ul.nav > li')) as HTMLElement[];
    const ctaItem = items.find(li => li.classList.contains('landing-header-cta-item'));
    expect(ctaItem).toBeTruthy();
    // Le sélecteur précède le <li> du bouton « Se connecter » (Chain stylise li:last-child a).
    const langIndex = items.findIndex(li => li.classList.contains('landing-lang-slot'));
    expect(langIndex).toBeGreaterThanOrEqual(0);
    expect(langIndex).toBeLessThan(items.length - 1);
  });

  it('le logo pointe vers l’accueil localisé avec un alt de marque', () => {
    const fixture = create();
    const logo = fixture.nativeElement.querySelector('a.logo img') as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute('alt')?.trim().length).toBeGreaterThan(0);
    const logoLink = fixture.nativeElement.querySelector('a.logo') as HTMLAnchorElement;
    expect(logoLink.getAttribute('href')).toBe('/');
  });

  it('tiroir mobile : bouton aria-expanded, ouverture/fermeture, Échap restaure le focus', () => {
    const fixture = create();
    const trigger = fixture.nativeElement.querySelector('.menu-trigger') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('mobile-menu');

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    const drawer = fixture.nativeElement.querySelector('#mobile-menu') as HTMLElement;
    expect(drawer).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('le tiroir mobile contient les mêmes ancres + Cabinets', () => {
    const fixture = create();
    const trigger = fixture.nativeElement.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const drawer = fixture.nativeElement.querySelector('#mobile-menu') as HTMLElement;
    const hrefs = Array.from(drawer.querySelectorAll<HTMLAnchorElement>('a')).map(a => a.getAttribute('href') ?? '');
    expect(hrefs).toContain('/#modules');
    expect(hrefs).toContain('/cabinets-comptables');
    expect(hrefs).toContain('/auth/login');
    // Fermeture au clic sur un lien de navigation (le sélecteur de langue n'est pas un lien de tiroir)
    (drawer.querySelector('a.mobile-nav-link') as HTMLAnchorElement).click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
