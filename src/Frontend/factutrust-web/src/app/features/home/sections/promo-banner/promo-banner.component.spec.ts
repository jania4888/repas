import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PromoBannerComponent } from './promo-banner.component';

describe('PromoBannerComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({
      imports: [PromoBannerComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    window.localStorage.clear();
    httpMock.verify();
  });

  function create() {
    const fixture = TestBed.createComponent(PromoBannerComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flushStatus(companyEnabled: boolean, firmEnabled: boolean): void {
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled, firmEnabled } });
  }

  it('état ouvert : quotas injectés (aucun placeholder résiduel) et lien vers /auth/register', () => {
    const fixture = create();
    flushStatus(true, false);
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.promo-text') as HTMLElement;
    expect(text.textContent).not.toContain('{count}');
    expect(text.textContent).toContain('10 factures');
    const cta = fixture.nativeElement.querySelector('.promo-cta') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/auth/register');
  });

  it('état fermé : année courante injectée et lien vers #nouveautes', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.promo-text') as HTMLElement;
    expect(text.textContent).toContain(String(new Date().getFullYear()));
    expect(text.textContent).not.toContain('{year}');
    const cta = fixture.nativeElement.querySelector('.promo-cta') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/#nouveautes');
  });

  it('le bouton fermer masque la bannière et persiste le choix', () => {
    const fixture = create();
    flushStatus(true, true);
    fixture.detectChanges();
    const close = fixture.nativeElement.querySelector('.promo-close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')?.trim().length).toBeGreaterThan(0);
    close.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.promo-banner')).toBeNull();
    expect(window.localStorage.getItem('factutrust_promo_banner_dismissed_v2')).not.toBeNull();
  });

  it('ne réaffiche pas la bannière si elle a été fermée récemment', () => {
    window.localStorage.setItem('factutrust_promo_banner_dismissed_v2', String(Date.now()));
    const fixture = create();
    flushStatus(true, true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.promo-banner')).toBeNull();
  });

  it('tolère une valeur de stockage corrompue', () => {
    window.localStorage.setItem('factutrust_promo_banner_dismissed_v2', 'pas-un-nombre');
    const fixture = create();
    flushStatus(true, true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.promo-banner')).not.toBeNull();
  });

  it('expose une région labellisée', () => {
    const fixture = create();
    flushStatus(false, false);
    fixture.detectChanges();
    const region = fixture.nativeElement.querySelector('[role="region"]') as HTMLElement;
    expect(region.getAttribute('aria-label')?.trim().length).toBeGreaterThan(0);
  });
});
