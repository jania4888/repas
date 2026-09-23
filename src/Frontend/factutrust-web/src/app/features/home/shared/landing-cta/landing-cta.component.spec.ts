import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCtaComponent } from './landing-cta.component';

describe('LandingCtaComponent', () => {
  let httpMock: HttpTestingController;
  const statusUrl = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LandingCtaComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    httpMock.verify();
  });

  function create(inputs: Partial<Record<string, unknown>> = {}): ComponentFixture<LandingCtaComponent> {
    const fixture = TestBed.createComponent(LandingCtaComponent);
    for (const [k, v] of Object.entries(inputs)) {
      fixture.componentRef.setInput(k, v);
    }
    fixture.detectChanges();
    return fixture;
  }

  function flushStatus(companyEnabled: boolean, firmEnabled: boolean): void {
    httpMock.expectOne(statusUrl).flush({ success: true, data: { companyEnabled, firmEnabled } });
  }

  function anchor(fixture: ComponentFixture<LandingCtaComponent>): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('a');
  }

  it('affiche un squelette aria-hidden tant que le statut est inconnu, puis le lien', () => {
    const fixture = create();
    const skeleton = fixture.nativeElement.querySelector('[data-cta-state="loading"]') as HTMLElement;
    expect(skeleton).not.toBeNull();
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.classList.contains('main-button')).toBeTrue();
    expect(anchor(fixture)).toBeNull();

    flushStatus(true, true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-cta-state="loading"]')).toBeNull();
    expect(anchor(fixture)).not.toBeNull();
  });

  it('pointe vers /auth/register avec le libellé « ouvert » quand les inscriptions PME sont ouvertes', () => {
    const fixture = create({ audience: 'company', cssClass: 'gradient-button' });
    flushStatus(true, false);
    fixture.detectChanges();
    const a = anchor(fixture)!;
    expect(a.getAttribute('data-cta-state')).toBe('open');
    expect(a.getAttribute('href')).toBe('/auth/register');
    expect(a.textContent?.trim()).toBe('Créer un compte gratuit');
    expect(a.classList.contains('gradient-button')).toBeTrue();
  });

  it('pointe vers /auth/register-firm pour un cabinet quand l’inscription cabinet est ouverte', () => {
    const fixture = create({ audience: 'firm' });
    flushStatus(false, true);
    fixture.detectChanges();
    const a = anchor(fixture)!;
    expect(a.getAttribute('data-cta-state')).toBe('open');
    expect(a.getAttribute('href')).toBe('/auth/register-firm');
    expect(a.textContent?.trim()).toBe('Créer mon espace cabinet');
  });

  it('bascule vers le formulaire de contact (#contact?objet=acces-entreprise) quand les inscriptions sont fermées', () => {
    const fixture = create({ audience: 'company' });
    flushStatus(false, false);
    fixture.detectChanges();
    const a = anchor(fixture)!;
    expect(a.getAttribute('data-cta-state')).toBe('closed');
    expect(a.getAttribute('href')).toBe('/?objet=acces-entreprise#contact');
    expect(a.textContent?.trim()).toBe('Demander un accès');
  });

  it('utilise objet=demo-cabinet et le libellé cabinet fermé', () => {
    const fixture = create({ audience: 'firm' });
    flushStatus(true, false);
    fixture.detectChanges();
    const a = anchor(fixture)!;
    expect(a.getAttribute('href')).toBe('/?objet=demo-cabinet#contact');
    expect(a.textContent?.trim()).toBe('Demander une démo cabinet');
  });

  it('forceContact ignore le statut, n’affiche pas de squelette et respecte subjectOverride / closedLabelOverride / contactPath', () => {
    const fixture = create({
      forceContact: true,
      subjectOverride: 'entreprise',
      closedLabelOverride: 'Discuter de votre projet',
      contactPath: '/cabinets-comptables'
    });
    expect(fixture.nativeElement.querySelector('[data-cta-state="loading"]')).toBeNull();
    const a = anchor(fixture)!;
    expect(a.getAttribute('data-cta-state')).toBe('closed');
    expect(a.getAttribute('href')).toBe('/cabinets-comptables?objet=entreprise#contact');
    expect(a.textContent?.trim()).toBe('Discuter de votre projet');
    // ensureLoaded est tout de même déclenché (partagé avec les autres CTA)
    flushStatus(true, true);
    fixture.detectChanges();
    expect(anchor(fixture)!.getAttribute('data-cta-state')).toBe('closed');
  });

  it('préfixe le chemin de contact par /ar quand la landing est en arabe', () => {
    TestBed.inject(LandingLocaleService).apply('ar');
    const fixture = create({ audience: 'company' });
    flushStatus(false, false);
    fixture.detectChanges();
    expect(anchor(fixture)!.getAttribute('href')).toBe('/ar?objet=acces-entreprise#contact');
  });

  it('openLabelOverride remplace le libellé ouvert', () => {
    const fixture = create({ openLabelOverride: 'Commencer gratuitement' });
    flushStatus(true, true);
    fixture.detectChanges();
    expect(anchor(fixture)!.textContent?.trim()).toBe('Commencer gratuitement');
  });
});
