import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { FaqSectionComponent } from './faq-section.component';

describe('FaqSectionComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FaqSectionComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    httpMock.verify();
  });

  function create() {
    const fixture = TestBed.createComponent(FaqSectionComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flushStatus(companyEnabled: boolean, firmEnabled: boolean): void {
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled, firmEnabled } });
  }

  it('rend la section #faq avec 10 questions en <details>', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const section = fixture.nativeElement.querySelector('section#faq') as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.getAttribute('aria-labelledby')).toBe('faq-title');
    const items = fixture.nativeElement.querySelectorAll('details.faq-item') as NodeListOf<HTMLElement>;
    expect(items.length).toBe(10);
    for (const item of Array.from(items)) {
      expect(item.querySelector('summary .question-text')?.textContent?.trim().length).toBeGreaterThan(0);
      expect(item.querySelector('.faq-answer p')?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('injecte le nombre de rôles (13) dans la réponse « utilisateurs et rôles »', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('{rolesCount}');
    expect(text).not.toContain('{count}');
    expect(text).toContain('13 rôles');
  });

  it('bascule la réponse « inscription » quand les inscriptions sont ouvertes', () => {
    const closed = create();
    flushStatus(false, false);
    closed.detectChanges();
    const closedAnswer = (closed.nativeElement.querySelector('details.faq-item .faq-answer p') as HTMLElement).textContent ?? '';

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FaqSectionComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    const http2 = TestBed.inject(HttpTestingController);
    const open = TestBed.createComponent(FaqSectionComponent);
    open.detectChanges();
    http2.expectOne(statusUrl).flush({ success: true, data: { companyEnabled: true, firmEnabled: true } });
    open.detectChanges();
    const openAnswer = (open.nativeElement.querySelector('details.faq-item .faq-answer p') as HTMLElement).textContent ?? '';

    expect(openAnswer).not.toEqual(closedAnswer);
    TestBed.inject(LandingLocaleService).restore();
    http2.verify();
  });

  it('ajoute un lien vers la page Cabinets comptables dans la réponse « expert-comptable »', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.faq-answer .faq-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/cabinets-comptables');
  });

  it('expose un CTA dynamique sous la liste', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const cta = fixture.nativeElement.querySelector('.faq-cta-row app-landing-cta a') as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute('href')).toContain('objet=acces-entreprise');
  });
});
