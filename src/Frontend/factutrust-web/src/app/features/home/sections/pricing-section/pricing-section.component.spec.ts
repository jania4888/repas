import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PricingSectionComponent } from './pricing-section.component';

describe('PricingSectionComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PricingSectionComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    httpMock.verify();
  });

  function create(companyEnabled = false, firmEnabled = false) {
    const fixture = TestBed.createComponent(PricingSectionComponent);
    fixture.detectChanges();
    // Les <app-landing-cta> (3 plans + cabinet + entreprise) partagent une seule requête de statut
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled, firmEnabled } });
    fixture.detectChanges();
    return fixture;
  }

  function planCards(fixture: { nativeElement: HTMLElement }): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.pricing-grid .pricing-card'));
  }

  it('affiche les 3 plans avec les prix LANDING_PRICING (0 / 49 / 39 TND par mois)', () => {
    const fixture = create();
    const cards = planCards(fixture);
    expect(cards.length).toBe(3);
    const amounts = cards.map(c => c.querySelector('.price-amount')?.textContent?.trim());
    expect(amounts).toEqual(['0', '49', '39']);
    // Montants en LTR explicite
    for (const card of cards) {
      expect(card.querySelector('.price-amount')?.getAttribute('dir')).toBe('ltr');
    }
  });

  it('met en avant le plan annuel : badge, économie −20 %, facturation 468 TND/an en LTR', () => {
    const fixture = create();
    const featured = fixture.nativeElement.querySelector('.pricing-card.featured') as HTMLElement;
    expect(featured).not.toBeNull();
    expect(featured.querySelector('.pricing-badge-featured')?.textContent?.trim().length).toBeGreaterThan(0);
    expect(featured.querySelector('.pricing-badge.savings')?.textContent).toContain('20 %');
    const billing = featured.querySelector('.pricing-billing') as HTMLElement;
    expect(billing.textContent).toContain('468');
    expect(billing.querySelector('span[dir="ltr"]')).not.toBeNull();
    const note = featured.querySelector('.pricing-note') as HTMLElement;
    expect(note.textContent).toContain('120');
    expect(note.querySelector('span[dir="ltr"]')).not.toBeNull();
  });

  it('injecte les quotas du plan gratuit (10/10/20/50/100 Mo/5) sans placeholder résiduel', () => {
    const fixture = create();
    const free = planCards(fixture)[0];
    const features = Array.from(free.querySelectorAll('.pricing-features li')).map(li => li.textContent ?? '');
    const joined = features.join(' ');
    expect(joined).not.toContain('{count}');
    expect(joined).not.toContain('{amount}');
    expect(joined).toContain('10 factures');
    expect(joined).toContain('10 devis');
    expect(joined).toContain('20 clients');
    expect(joined).toContain('50 produits');
    expect(joined).toContain('100 Mo');
    expect(joined).toContain('5 utilisateurs');
  });

  it('affiche le bloc Cabinet comptable (CTA contact forcé + lien page cabinet)', () => {
    const fixture = create();
    const block = fixture.nativeElement.querySelector('aside.cabinet-block') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.getAttribute('aria-labelledby')).toBe('cabinet-block-title');
    const cta = block.querySelector('app-landing-cta a') as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute('href')).toContain('objet=demo-cabinet');
    const link = block.querySelector('.cabinet-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/cabinets-comptables');
  });

  it('affiche la bannière Entreprise avec CTA contact objet=entreprise', () => {
    const fixture = create();
    const banner = fixture.nativeElement.querySelector('.enterprise-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    const cta = banner.querySelector('app-landing-cta a') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toContain('objet=entreprise');
  });

  it('affiche la FAQ tarifaire (4 entrées) sans la mention « 30 jours »', () => {
    const fixture = create();
    const items = fixture.nativeElement.querySelectorAll('.pricing-faq .faq-item');
    expect(items.length).toBe(4);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('30 jours');
  });

  it('pointe les CTA des plans vers /auth/register quand les inscriptions sont ouvertes', () => {
    const fixture = create(true, false);
    const first = planCards(fixture)[0].querySelector('app-landing-cta a') as HTMLAnchorElement;
    expect(first.getAttribute('href')).toBe('/auth/register');
  });
});
