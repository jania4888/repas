import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { CabinetTeaserSectionComponent } from './cabinet-teaser-section.component';

describe('CabinetTeaserSectionComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CabinetTeaserSectionComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
  });

  function create() {
    const fixture = TestBed.createComponent(CabinetTeaserSectionComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('rend la section #cabinets avec titre labellisé', () => {
    const fixture = create();
    const section = fixture.nativeElement.querySelector('section#cabinets') as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.getAttribute('tabindex')).toBe('-1');
    expect(section.getAttribute('aria-labelledby')).toBe('cabinet-teaser-title');
  });

  it('lie le CTA principal à la page Cabinets comptables', () => {
    const fixture = create();
    const cta = fixture.nativeElement.querySelector('.teaser-cta') as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute('href')).toBe('/cabinets-comptables');
  });

  it('lie « demander une démo » vers la page cabinet avec objet=demo-cabinet et ancre #contact', () => {
    const fixture = create();
    const demo = fixture.nativeElement.querySelector('.teaser-demo-link') as HTMLAnchorElement;
    expect(demo).not.toBeNull();
    const href = demo.getAttribute('href') ?? '';
    expect(href).toContain('/cabinets-comptables');
    expect(href).toContain('objet=demo-cabinet');
    expect(href).toContain('#contact');
  });

  it('liste les points clés avec des coches', () => {
    const fixture = create();
    const items = fixture.nativeElement.querySelectorAll('.check-list li') as NodeListOf<HTMLElement>;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(fixture.nativeElement.querySelectorAll('.check-list .pi-check-circle').length).toBe(items.length);
  });
});
