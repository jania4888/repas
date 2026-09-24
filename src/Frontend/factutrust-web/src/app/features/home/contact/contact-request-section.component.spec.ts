import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { LANDING_COPY_FR } from '../content/landing-copy.fr';
import { CONTACT_FALLBACK_EMAIL } from '../content/fr/contact';
import type { ContactRequestSubject } from './contact-request.models';
import { ContactRequestSectionComponent, type ContactRequestHeading } from './contact-request-section.component';

function routeWithObjet(objet: string) {
  const params = convertToParamMap({ objet });
  return { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } };
}

describe('ContactRequestSectionComponent', () => {
  function create(
    options: { defaultSubject?: ContactRequestSubject; heading?: ContactRequestHeading; objet?: string; enabled?: boolean } = {}
  ): ComponentFixture<ContactRequestSectionComponent> {
    TestBed.configureTestingModule({
      imports: [ContactRequestSectionComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        ...(options.objet !== undefined ? [routeWithObjet(options.objet)] : [])
      ]
    });
    const fixture = TestBed.createComponent(ContactRequestSectionComponent);
    if (options.defaultSubject !== undefined) {
      fixture.componentRef.setInput('defaultSubject', options.defaultSubject);
    }
    if (options.heading !== undefined) {
      fixture.componentRef.setInput('heading', options.heading);
    }
    if (options.enabled === false) {
      // environment.publicContact.enabled est une constante de build : on la neutralise ici.
      (fixture.componentInstance as unknown as { enabled: boolean }).enabled = false;
    }
    fixture.detectChanges();
    return fixture;
  }

  it('affiche la section #contact avec l’en-tête du dictionnaire par défaut et le formulaire', () => {
    const fixture = create();
    const section: HTMLElement = fixture.nativeElement.querySelector('section#contact.contact-request');
    expect(section).not.toBeNull();
    expect(section.getAttribute('tabindex')).toBe('-1');
    expect(section.getAttribute('aria-labelledby')).toBe('contact-request-title');
    const title: HTMLElement = section.querySelector('h2')!;
    expect(title.textContent?.trim()).toBe(LANDING_COPY_FR.contact.title);
    const lead: HTMLElement = section.querySelector('.contact-request__lead')!;
    expect(lead.textContent?.trim()).toBe(LANDING_COPY_FR.contact.lead);
    expect(section.querySelector('app-contact-request-form select#cr-subject')).not.toBeNull();
  });

  it('utilise l’en-tête fourni en entrée (page cabinet : « Parlons de votre cabinet »)', () => {
    const fixture = create({ heading: LANDING_COPY_FR.cabinets.contact });
    const title: HTMLElement = fixture.nativeElement.querySelector('h2');
    expect(title.textContent?.trim()).toBe('Parlons de votre cabinet');
  });

  it('quand le formulaire est désactivé (flag), affiche le repli e-mail sans formulaire', () => {
    const fixture = create({ enabled: false });
    const section: HTMLElement = fixture.nativeElement.querySelector('section#contact');
    expect(section).not.toBeNull();
    expect(section.querySelector('app-contact-request-form')).toBeNull();
    const lead: HTMLElement = section.querySelector('.contact-request__lead')!;
    expect(lead.textContent).toContain(CONTACT_FALLBACK_EMAIL);
    const mailto: HTMLAnchorElement = section.querySelector('a.contact-request__mailto')!;
    expect(mailto.getAttribute('href')).toBe(`mailto:${CONTACT_FALLBACK_EMAIL}`);
    expect(mailto.textContent?.trim()).toBe(CONTACT_FALLBACK_EMAIL);
  });

  it('?objet=demo-cabinet présélectionne l’objet du formulaire', () => {
    const fixture = create({ objet: 'demo-cabinet' });
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#cr-subject');
    expect(select.value).toBe('demo-cabinet');
  });

  it('un ?objet= invalide retombe sur defaultSubject', () => {
    const fixture = create({ objet: 'inconnu', defaultSubject: 'demo-cabinet' });
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#cr-subject');
    expect(select.value).toBe('demo-cabinet');
  });

  it('sans ?objet=, le defaultSubject acces-entreprise est appliqué', () => {
    const fixture = create();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#cr-subject');
    expect(select.value).toBe('acces-entreprise');
  });
});
