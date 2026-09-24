import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { NewFeaturesSectionComponent } from './new-features-section.component';

describe('NewFeaturesSectionComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NewFeaturesSectionComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
  });

  function create() {
    const fixture = TestBed.createComponent(NewFeaturesSectionComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('rend la section #nouveautes focusable avec un titre labellisé', () => {
    const fixture = create();
    const section = fixture.nativeElement.querySelector('section#nouveautes') as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.getAttribute('tabindex')).toBe('-1');
    const titleId = section.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(section.querySelector(`#${titleId}`)?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('affiche les 13 cartes de nouveautés, la première mise en avant', () => {
    const fixture = create();
    const cards = fixture.nativeElement.querySelectorAll('.news-card') as NodeListOf<HTMLElement>;
    expect(cards.length).toBe(13);
    expect(fixture.nativeElement.querySelectorAll('.news-card-featured').length).toBe(1);
    const first = cards[0];
    expect(first.classList.contains('news-card-featured')).toBeTrue();
    // Chaque carte a une icône, un titre et un texte
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.card-icon i')).not.toBeNull();
      expect(card.querySelector('.card-title')?.textContent?.trim().length).toBeGreaterThan(0);
      expect(card.querySelector('.card-text')?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('remplace {year} du kicker par l’année courante et n’expose aucun CTA mort', () => {
    const fixture = create();
    const kicker = fixture.nativeElement.querySelector('.eyebrow') as HTMLElement;
    expect(kicker.textContent).toContain(String(new Date().getFullYear()));
    expect(kicker.textContent).not.toContain('{year}');
    expect(fixture.nativeElement.querySelector('a[href]')).toBeNull();
    // La note de bas de section est présente
    expect(fixture.nativeElement.querySelector('.news-note')?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
