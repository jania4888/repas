import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PublicFooterComponent } from './public-footer.component';

describe('PublicFooterComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicFooterComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
  });

  function create() {
    const fixture = TestBed.createComponent(PublicFooterComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('rend un footer contentinfo sans id #newsletter', () => {
    const fixture = create();
    const footer = fixture.nativeElement.querySelector('footer#footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#newsletter')).toBeNull();
  });

  it('expose 4 colonnes de navigation titrées', () => {
    const fixture = create();
    const columns = fixture.nativeElement.querySelectorAll('.footer-col') as NodeListOf<HTMLElement>;
    expect(columns.length).toBe(4);
    for (const col of Array.from(columns)) {
      expect(col.querySelector('h2')?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('contient le lien Cabinets comptables et les ancres produit', () => {
    const fixture = create();
    const hrefs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).map(a => a.getAttribute('href') ?? '');
    expect(hrefs).toContain('/cabinets-comptables');
    expect(hrefs).toContain('/#modules');
    expect(hrefs).toContain('/#nouveautes');
    expect(hrefs).toContain('/#tarifs');
    expect(hrefs).toContain('/#faq');
  });

  it('ne contient aucun lien mort href="#" et pointe les mentions légales vers /legal/terms', () => {
    const fixture = create();
    const dead = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).filter(
      a => a.getAttribute('href') === '#'
    );
    expect(dead.length).toBe(0);
    const legal = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).filter(
      a => a.getAttribute('href') === '/legal/terms'
    );
    expect(legal.length).toBeGreaterThanOrEqual(2);
  });

  it('affiche le copyright avec l’année courante injectée', () => {
    const fixture = create();
    const copyright = fixture.nativeElement.querySelector('.copyright') as HTMLElement;
    expect(copyright).not.toBeNull();
    expect(copyright.textContent).toContain(String(new Date().getFullYear()));
    expect(copyright.textContent).not.toContain('{year}');
  });

  it('affiche le logo marque sur fond foncé avec dimensions déclarées', () => {
    const fixture = create();
    const img = fixture.nativeElement.querySelector('.footer-brand img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('width')).toBe('1984');
    expect(img.getAttribute('height')).toBe('793');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('alt')?.trim().length).toBeGreaterThan(0);
  });
});
