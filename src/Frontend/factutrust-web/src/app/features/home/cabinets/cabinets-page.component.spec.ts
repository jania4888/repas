import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LANDING_COPY_FR } from '../content/landing-copy.fr';
import { CabinetsPageComponent } from './cabinets-page.component';

const COPY = LANDING_COPY_FR.cabinets;
const STATUS_URL = `${environment.apiUrl}/public/registration-status`;

describe('CabinetsPageComponent', () => {
  let httpMock: HttpTestingController;

  afterEach(() => {
    TestBed.inject(LandingLocaleService).restore();
    httpMock.verify();
  });

  function create(status: { companyEnabled: boolean; firmEnabled: boolean } = { companyEnabled: false, firmEnabled: false }): ComponentFixture<CabinetsPageComponent> {
    TestBed.configureTestingModule({
      imports: [CabinetsPageComponent],
      providers: [provideRouter([]), provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CabinetsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne(STATUS_URL).flush({ success: true, data: status });
    fixture.detectChanges();
    return fixture;
  }

  it('rend le chrome partagé (header, main, footer) et les 8 sections ancrées', () => {
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('app-public-header')).not.toBeNull();
    expect(root.querySelector('main')).not.toBeNull();
    expect(root.querySelector('app-public-footer')).not.toBeNull();
    for (const id of ['top', 'fonctionnement', 'fonctionnalites-cabinet', 'roles', 'securite-cabinet', 'offre-cabinet', 'faq-cabinet', 'contact']) {
      expect(root.querySelector(`#${id}`)).withContext(`ancre #${id}`).not.toBeNull();
    }
  });

  it('a un H1 unique, égal à la copie du dictionnaire', () => {
    const fixture = create();
    const h1s = fixture.nativeElement.querySelectorAll('main h1') as NodeListOf<HTMLElement>;
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent?.trim()).toBe('Vos dossiers. Votre équipe. Une vue d’ensemble.');
    expect(h1s[0].textContent?.trim()).toBe(COPY.hero.title);
    const kicker: HTMLElement = fixture.nativeElement.querySelector('#top .cab-kicker');
    expect(kicker.textContent?.trim()).toBe(COPY.hero.kicker);
  });

  it('affiche les 3 puces de réassurance du hero et le CTA secondaire vers #fonctionnement', () => {
    const fixture = create();
    const bullets = fixture.nativeElement.querySelectorAll('#top .cab-hero__bullets li') as NodeListOf<HTMLElement>;
    expect(bullets.length).toBe(3);
    expect(bullets[1].textContent).toContain('ses dossiers affectés');
    const secondary: HTMLAnchorElement = fixture.nativeElement.querySelector('#top a[href="#fonctionnement"]');
    expect(secondary).not.toBeNull();
    expect(secondary.textContent?.trim()).toBe(COPY.hero.secondaryCta);
  });

  it('état fermé : le CTA cabinet du hero pointe vers #contact avec objet=demo-cabinet', () => {
    const fixture = create({ companyEnabled: false, firmEnabled: false });
    const cta: HTMLAnchorElement = fixture.nativeElement.querySelector('#top app-landing-cta a');
    expect(cta.getAttribute('data-cta-state')).toBe('closed');
    expect(cta.getAttribute('href')).toBe('/cabinets-comptables?objet=demo-cabinet#contact');
    expect(cta.textContent?.trim()).toBe('Demander une démo cabinet');
    // Pas de note « ouvert » quand l’inscription cabinet est fermée.
    expect(fixture.nativeElement.querySelector('.cab-hero__note')).toBeNull();
  });

  it('état ouvert : le CTA cabinet du hero pointe vers /auth/register-firm avec la note d’inscription', () => {
    const fixture = create({ companyEnabled: false, firmEnabled: true });
    const cta: HTMLAnchorElement = fixture.nativeElement.querySelector('#top app-landing-cta a');
    expect(cta.getAttribute('data-cta-state')).toBe('open');
    expect(cta.getAttribute('href')).toBe('/auth/register-firm');
    expect(cta.textContent?.trim()).toBe('Créer mon espace cabinet');
    const note: HTMLElement = fixture.nativeElement.querySelector('.cab-hero__note');
    expect(note.textContent?.trim()).toBe(COPY.hero.openNote);
  });

  it('rend les 3 étapes de #fonctionnement depuis la copie', () => {
    const fixture = create();
    const steps = fixture.nativeElement.querySelectorAll('#fonctionnement .cab-step') as NodeListOf<HTMLElement>;
    expect(steps.length).toBe(3);
    expect(steps[0].querySelector('h3')?.textContent?.trim()).toBe(COPY.howItWorks.steps[0].title);
    expect(fixture.nativeElement.querySelector('#fonctionnement h2').textContent.trim()).toBe(COPY.howItWorks.title);
  });

  it('rend les 5 familles de #fonctionnalites-cabinet avec les marqueurs « selon activation »', () => {
    const fixture = create();
    const families = fixture.nativeElement.querySelectorAll('#fonctionnalites-cabinet .cab-family');
    expect(families.length).toBe(5);
    const flags = Array.from(
      fixture.nativeElement.querySelectorAll('#fonctionnalites-cabinet .cab-flag') as NodeListOf<HTMLElement>
    );
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].textContent?.trim()).toBe(LANDING_COPY_FR.shared.common.uponActivation);
    // Les astérisques de la copie ne sont pas rendus tels quels dans les puces.
    const section: HTMLElement = fixture.nativeElement.querySelector('#fonctionnalites-cabinet');
    expect(section.querySelector('.cab-family__list')?.textContent).not.toContain('*');
    const footnote: HTMLElement = fixture.nativeElement.querySelector('#fonctionnalites-cabinet .cab-footnote');
    expect(footnote.textContent?.trim()).toContain('selon leur activation');
  });

  it('rend les 3 cartes de #roles (Responsable, Collaborateur, Chef de mission IA selon activation) + le bandeau', () => {
    const fixture = create();
    const cards = fixture.nativeElement.querySelectorAll('#roles .cab-role') as NodeListOf<HTMLElement>;
    expect(cards.length).toBe(3);
    expect(cards[0].querySelector('h3')?.textContent?.trim()).toBe(COPY.roles.cards[0].title);
    expect(cards[2].textContent).toContain('Chef de mission');
    expect(cards[2].querySelector('.cab-flag')?.textContent?.trim()).toBe(LANDING_COPY_FR.shared.common.uponActivation);
    const banner: HTMLElement = fixture.nativeElement.querySelector('#roles .cab-roles__banner');
    expect(banner.textContent?.trim()).toBe(COPY.roles.banner);
  });

  it('rend les 4 faits de #securite-cabinet + note IA + lien vers la sécurité de l’accueil', () => {
    const fixture = create();
    const facts = fixture.nativeElement.querySelectorAll('#securite-cabinet .cab-fact');
    expect(facts.length).toBe(4);
    const aiNote: HTMLElement = fixture.nativeElement.querySelector('#securite-cabinet .cab-ai-note');
    expect(aiNote.textContent?.trim()).toBe(COPY.security.aiNote);
    const more: HTMLAnchorElement = fixture.nativeElement.querySelector('#securite-cabinet a.cab-link-more');
    expect(more.textContent?.trim()).toBe(COPY.security.moreLink);
    expect(more.getAttribute('href')).toBe('/#securite-detail');
  });

  it('rend #offre-cabinet « sur devis » sans chiffre, avec CTA démo forcé et lien tarifs', () => {
    const fixture = create();
    const offer: HTMLElement = fixture.nativeElement.querySelector('#offre-cabinet');
    expect(offer.querySelector('h2')?.textContent?.trim()).toBe(COPY.offer.title);
    expect(offer.querySelectorAll('.cab-offer__list li').length).toBe(3);
    const cta: HTMLAnchorElement = offer.querySelector('app-landing-cta a')!;
    expect(cta.getAttribute('data-cta-state')).toBe('closed');
    expect(cta.getAttribute('href')).toBe('/cabinets-comptables?objet=demo-cabinet#contact');
    expect(cta.textContent?.trim()).toBe(COPY.offer.cta);
    const pricing: HTMLAnchorElement = offer.querySelector('a.cab-offer__pricing')!;
    expect(pricing.getAttribute('href')).toBe('/#tarifs');
  });

  it('rend la FAQ en 7 <details> natifs alignés sur la copie (source du JSON-LD du shell)', () => {
    const fixture = create();
    const details = fixture.nativeElement.querySelectorAll('#faq-cabinet details.faq-item') as NodeListOf<HTMLElement>;
    expect(details.length).toBe(7);
    expect(details.length).toBe(COPY.faq.items.length);
    details.forEach((el, i) => {
      expect(el.querySelector('summary.faq-question')?.textContent?.trim()).toBe(COPY.faq.items[i].question);
      expect(el.querySelector('.faq-answer')?.textContent?.trim()).toBe(COPY.faq.items[i].answer);
    });
  });

  it('monte la section contact partagée avec l’en-tête cabinet et l’objet demo-cabinet', () => {
    const fixture = create();
    const section: HTMLElement = fixture.nativeElement.querySelector('app-contact-request-section section#contact');
    expect(section).not.toBeNull();
    expect(section.querySelector('h2')?.textContent?.trim()).toBe(COPY.contact.title);
    const select: HTMLSelectElement = section.querySelector('#cr-subject')!;
    expect(select.value).toBe('demo-cabinet');
  });

  it('ne contient aucun terme interdit (contrat éditorial § 5.3)', () => {
    const fixture = create();
    const text = (fixture.nativeElement.querySelector('main') as HTMLElement).textContent ?? '';
    const forbidden = ['eIDAS', 'Factur-X', 'GPT-4', 'OpenAI', 'RGPD', 'timbre', 'garanti', 'Garanti', '€', 'TND'];
    for (const term of forbidden) {
      expect(text).withContext(`terme interdit « ${term} »`).not.toContain(term);
    }
    expect(text).not.toMatch(/100\s?%/);
    expect(text).not.toMatch(/\d+\s?TND/);
  });

  it('n’utilise pas la classe wow (animations par IntersectionObserver)', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('.wow')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.cab-reveal').length).toBeGreaterThan(5);
  });
});
