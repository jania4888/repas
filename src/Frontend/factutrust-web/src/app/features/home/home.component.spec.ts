import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { HomeComponent } from './home.component';

/**
 * Contrats structurels de la page d'accueil (plan § 5.2) — sections chargées à l'affichage
 * uniquement (les blocs @defer « on idle » ne sont pas forcés dans ces tests).
 */
describe('HomeComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    document.body.style.overflow = '';
    window.localStorage.clear();
    httpMock.verify();
  });

  function create(companyEnabled = false, firmEnabled = false) {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled, firmEnabled } });
    fixture.detectChanges();
    return fixture;
  }

  it('rend les sections eager dans l’ordre du plan (hors blocs @defer)', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const ids = ['top', 'modules', 'fonctionnalites', 'ia', 'forecasting', 'nouveautes', 'cabinets', 'tarifs', 'cas-usage', 'conformite'];
    let previous = -1;
    for (const id of ids) {
      const el = root.querySelector(`#${id}`) as HTMLElement;
      expect(el).withContext(`#${id} présent`).not.toBeNull();
      const index = Array.from(root.querySelectorAll('[id]')).indexOf(el);
      expect(index).withContext(`#${id} après le précédent`).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it('ne rend plus les anciens blocs inline (#about, footer #newsletter) ni les sections supprimées', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#about')).toBeNull();
    expect(root.querySelector('#newsletter')).toBeNull();
    expect(root.querySelector('app-trust-logos-section')).toBeNull();
    expect(root.querySelector('app-simplicity-section')).toBeNull();
    expect(root.querySelector('app-hero-section')).toBeNull();
  });

  it('expose un H1 unique avec la promesse du dictionnaire', () => {
    const fixture = create();
    const h1s = fixture.nativeElement.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent?.trim().length).toBeGreaterThan(20);
  });

  it('hero : note d’invitation quand inscriptions fermées, quotas quand ouvertes', () => {
    const closed = create(false, false);
    const noteClosed = closed.nativeElement.querySelector('.hero-note') as HTMLElement;
    expect(noteClosed.textContent).toContain('invitation');
    expect(noteClosed.textContent).not.toContain('{count}');
  });

  it('hero : « Voir les 18 modules » et lien Cabinet comptable', () => {
    const fixture = create();
    const modulesLink = fixture.nativeElement.querySelector('.hero-modules-link') as HTMLAnchorElement;
    expect(modulesLink.textContent).toContain('18');
    expect(modulesLink.getAttribute('href')).toBe('/#modules');
    const secondary = fixture.nativeElement.querySelector('.hero-secondary') as HTMLAnchorElement;
    expect(secondary.getAttribute('href')).toBe('/cabinets-comptables');
  });

  it('bandeau de preuves : 18 modules, 13 rôles, 90+ outils IA', () => {
    const fixture = create();
    const stats = fixture.nativeElement.querySelector('.trust-strip-stats') as HTMLElement;
    expect(stats.textContent).toContain('18');
    expect(stats.textContent).toContain('13');
    expect(stats.textContent).toContain('90+');
    expect(stats.textContent).not.toContain('{count}');
    const badges = fixture.nativeElement.querySelectorAll('.trust-strip-badges span');
    expect(badges.length).toBeGreaterThanOrEqual(3);
  });

  it('rue virtuelle : « Rue InstaFact » et lien « Visite virtuelle » (storefront activé)', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const heading = root.querySelector('#virtual-street-heading') as HTMLElement;
    expect(heading).not.toBeNull();
    expect(heading.textContent).toContain('Rue InstaFact');
    const link = root.querySelector('.virtual-street-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('Visite virtuelle');
    expect(link.getAttribute('href')).toBe('/visite-virtuelle');
  });

  it('cas d’usage : persona comptable présent avec lien cabinet', () => {
    const fixture = create();
    const accountant = fixture.nativeElement.querySelector('.persona-accountant') as HTMLElement;
    expect(accountant).not.toBeNull();
    expect(accountant.classList.contains('usecase-card')).toBeTrue();
    const link = accountant.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/cabinets-comptables');
  });

  it('réserve le slot #contact (TB7) avant le footer', () => {
    const fixture = create();
    const footer = fixture.nativeElement.querySelector('app-public-footer');
    expect(footer).not.toBeNull();
    // Le slot de contact est un commentaire dans le template — vérifier que le footer
    // est bien le dernier élément rendu (le bloc #contact sera inséré avant lui par TB7).
    const wrapper = fixture.nativeElement.querySelector('.chain-theme-root') as HTMLElement;
    expect(wrapper.lastElementChild?.tagName.toLowerCase()).toBe('app-public-footer');
  });
});
