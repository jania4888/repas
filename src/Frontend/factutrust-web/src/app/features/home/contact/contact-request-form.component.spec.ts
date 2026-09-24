import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { environment } from '@environments/environment';
import { LANDING_COPY_FR } from '../content/landing-copy.fr';
import { CONTACT_FALLBACK_EMAIL } from '../content/fr/contact';
import { ContactRequestFormComponent } from './contact-request-form.component';
import type { ContactRequestSubject, CreateContactRequestDto } from './contact-request.models';

const SUBMIT_URL = `${environment.apiUrl}/public/contact-requests`;
const COPY = LANDING_COPY_FR.contact;

/**
 * Fournit un `ActivatedRoute` factice portant `?objet=` (lu au init + abonnement).
 */
function routeWithObjet(objet: string | null) {
  const params = convertToParamMap(objet === null ? {} : { objet });
  return { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params }, queryParamMap: of(params) } };
}

describe('ContactRequestFormComponent', () => {
  let httpMock: HttpTestingController;

  afterEach(() => {
    httpMock.verify();
  });

  function create(options: { defaultSubject?: ContactRequestSubject; objet?: string | null } = {}): ComponentFixture<ContactRequestFormComponent> {
    TestBed.configureTestingModule({
      imports: [ContactRequestFormComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        ...(options.objet !== undefined ? [routeWithObjet(options.objet)] : [])
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ContactRequestFormComponent);
    if (options.defaultSubject !== undefined) {
      fixture.componentRef.setInput('defaultSubject', options.defaultSubject);
    }
    fixture.detectChanges();
    return fixture;
  }

  function fillValid(fixture: ComponentFixture<ContactRequestFormComponent>): void {
    const form = fixture.componentInstance.form;
    form.controls.fullName.setValue('Amel Ben Salah');
    form.controls.organization.setValue('Cabinet Ben Salah');
    form.controls.email.setValue('amel@exemple.tn');
    form.controls.phone.setValue('+216 20 123 456');
    form.controls.message.setValue('Bonjour, nous souhaitons une démonstration de la version Cabinet.');
    form.controls.consent.setValue(true);
  }

  function submitForm(fixture: ComponentFixture<ContactRequestFormComponent>): void {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    button.click();
    fixture.detectChanges();
  }

  function fieldError(fixture: ComponentFixture<ContactRequestFormComponent>, fieldId: string): string {
    const el: HTMLElement | null = fixture.nativeElement.querySelector(`#${fieldId}-error`);
    return el?.textContent?.trim() ?? '';
  }

  it('affiche les libellés depuis le dictionnaire et le compteur 0 / 2000', () => {
    const fixture = create();
    const label: HTMLElement = fixture.nativeElement.querySelector('label[for="cr-subject"]');
    expect(label.textContent?.trim()).toBe(COPY.fields.subject.label);
    const counter: HTMLElement = fixture.nativeElement.querySelector('#cr-message-counter');
    expect(counter.textContent?.trim()).toBe('0 / 2000');
    const honeypotLabel: HTMLElement = fixture.nativeElement.querySelector('label[for="cr-website"]');
    expect(honeypotLabel.textContent?.trim()).toBe(COPY.fields.website.label);
  });

  it('compte les caractères du message en direct (aria-live)', () => {
    const fixture = create();
    fixture.componentInstance.form.controls.message.setValue('Bonjour InstaFact');
    fixture.detectChanges();
    const counter: HTMLElement = fixture.nativeElement.querySelector('#cr-message-counter');
    expect(counter.textContent?.trim()).toBe('17 / 2000');
    expect(counter.getAttribute('aria-live')).toBe('polite');
  });

  it('pré-remplit le sujet depuis ?objet= quand le code est valide', () => {
    const fixture = create({ objet: 'demo-cabinet' });
    expect(fixture.componentInstance.form.controls.subject.value).toBe('demo-cabinet');
  });

  it('retombe sur defaultSubject quand ?objet= est invalide', () => {
    const fixture = create({ objet: 'pas-un-objet', defaultSubject: 'demo-cabinet' });
    expect(fixture.componentInstance.form.controls.subject.value).toBe('demo-cabinet');
  });

  it('retombe sur defaultSubject quand ?objet= est absent', () => {
    const fixture = create({ defaultSubject: 'demo-cabinet' });
    expect(fixture.componentInstance.form.controls.subject.value).toBe('demo-cabinet');
  });

  it('propose les tailles en dossiers pour demo-cabinet, en employés sinon, et réinitialise au changement', () => {
    const fixture = create({ objet: 'demo-cabinet' });
    const form = fixture.componentInstance.form;
    fixture.detectChanges();
    let options = Array.from(fixture.nativeElement.querySelectorAll('#cr-size option') as NodeListOf<HTMLOptionElement>);
    expect(options.map(o => o.value)).toEqual(['', 'dossiers:1-5', 'dossiers:6-20', 'dossiers:21-50', 'dossiers:50+']);
    form.controls.size.setValue('dossiers:6-20');
    form.controls.subject.setValue('entreprise');
    fixture.detectChanges();
    expect(form.controls.size.value).toBe('');
    options = Array.from(fixture.nativeElement.querySelectorAll('#cr-size option') as NodeListOf<HTMLOptionElement>);
    expect(options.map(o => o.value)).toEqual(['', 'employes:1-5', 'employes:6-20', 'employes:21-100', 'employes:100+']);
  });

  it('affiche un aperçu normalisé du téléphone quand il diffère de la saisie', () => {
    const fixture = create();
    const phone = fixture.componentInstance.form.controls.phone;
    phone.setValue('20 123 456');
    fixture.detectChanges();
    const preview: HTMLElement = fixture.nativeElement.querySelector('#cr-phone-preview');
    expect(preview.textContent?.trim()).toBe('20123456');
    phone.setValue('+21620123456');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#cr-phone-preview')).toBeNull();
  });

  it('une soumission invalide ne fait aucun appel HTTP et affiche les erreurs par champ', () => {
    const fixture = create();
    submitForm(fixture);
    httpMock.expectNone(SUBMIT_URL);
    expect(fieldError(fixture, 'cr-fullname')).toBe(COPY.errors.required);
    expect(fieldError(fixture, 'cr-email')).toBe(COPY.errors.required);
    expect(fieldError(fixture, 'cr-phone')).toBe(COPY.errors.required);
    expect(fieldError(fixture, 'cr-message')).toBe(COPY.errors.required);
    expect(fieldError(fixture, 'cr-consent')).toBe(COPY.errors.consent);
    const email: HTMLElement = fixture.nativeElement.querySelector('#cr-email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain('cr-email-error');
  });

  it('valide le format e-mail avec un message dédié', () => {
    const fixture = create();
    fillValid(fixture);
    fixture.componentInstance.form.controls.email.setValue('pas-un-email');
    submitForm(fixture);
    httpMock.expectNone(SUBMIT_URL);
    expect(fieldError(fixture, 'cr-email')).toBe(COPY.errors.email);
  });

  it('valide le téléphone tunisien (accepte +216 20 123 456 et 20123456, refuse 12345)', () => {
    const fixture = create();
    fillValid(fixture);
    const phone = fixture.componentInstance.form.controls.phone;
    phone.setValue('12345');
    submitForm(fixture);
    httpMock.expectNone(SUBMIT_URL);
    expect(fieldError(fixture, 'cr-phone')).toBe(COPY.errors.phone);

    phone.setValue('20123456');
    fixture.detectChanges();
    expect(phone.valid).toBeTrue();
    phone.setValue('+216 20 123 456');
    fixture.detectChanges();
    expect(phone.valid).toBeTrue();
  });

  it('exige un message de 10 à 2000 caractères', () => {
    const fixture = create();
    fillValid(fixture);
    const message = fixture.componentInstance.form.controls.message;
    message.setValue('abc');
    submitForm(fixture);
    httpMock.expectNone(SUBMIT_URL);
    expect(fieldError(fixture, 'cr-message')).toBe('Saisissez au moins 10 caractères.');
  });

  it('un honeypot rempli produit un faux succès sans aucun appel HTTP', () => {
    const fixture = create();
    fillValid(fixture);
    fixture.componentInstance.form.controls.website.setValue('https://spam.example');
    submitForm(fixture);
    httpMock.expectNone(SUBMIT_URL);
    const panel: HTMLElement = fixture.nativeElement.querySelector('.cr-panel--success');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain(COPY.success.title);
    // Aucune référence affichée pour un faux succès.
    expect(panel.querySelector('.cr-panel__ref')).toBeNull();
  });

  it('envoie le DTO exact du contrat § 4.5 (téléphone normalisé, honeypot, elapsedMs, locale, consent)', () => {
    const fixture = create({ objet: 'demo-cabinet' });
    fillValid(fixture);
    const form = fixture.componentInstance.form;
    form.controls.size.setValue('dossiers:6-20');
    form.controls.phone.setValue('20 123 456');
    submitForm(fixture);

    const req = httpMock.expectOne(SUBMIT_URL);
    expect(req.request.method).toBe('POST');
    const body = req.request.body as CreateContactRequestDto;
    expect(body.subject).toBe('demo-cabinet');
    expect(body.fullName).toBe('Amel Ben Salah');
    expect(body.organization).toBe('Cabinet Ben Salah');
    expect(body.email).toBe('amel@exemple.tn');
    expect(body.phone).toBe('20123456');
    expect(body.size).toBe('dossiers:6-20');
    expect(body.message).toContain('démonstration');
    expect(body.consent).toBeTrue();
    expect(body.locale).toBe('fr');
    expect(Object.keys(body)).toContain('honeypot');
    expect(body.honeypot).toBe('');
    expect(typeof body.elapsedMs).toBe('number');
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
    expect('turnstileToken' in body).toBeFalse();
    req.flush({ success: true, data: { reference: 'CR-TEST01' } }, { status: 202, statusText: 'Accepted' });
  });

  it('omet size du DTO quand la taille n’est pas choisie', () => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    const req = httpMock.expectOne(SUBMIT_URL);
    const body = req.request.body as Record<string, unknown>;
    expect('size' in body).toBeFalse();
    req.flush({ success: true, data: { reference: 'CR-OK0001' } }, { status: 202, statusText: 'Accepted' });
  });

  it('202 → référence affichée, focus déplacé sur le panneau, formulaire réinitialisé (objet conservé)', fakeAsync(() => {
    const fixture = create({ objet: 'demo-cabinet' });
    fillValid(fixture);
    submitForm(fixture);
    // Le bouton est désactivé pendant l’envoi.
    const inFlight: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(inFlight.disabled).toBeTrue();

    httpMock.expectOne(SUBMIT_URL).flush({ success: true, data: { reference: 'CR-7F3K9Q' } }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    tick(); // flush le setTimeout de déplacement du focus
    fixture.detectChanges();

    const panel: HTMLElement = fixture.nativeElement.querySelector('.cr-panel--success');
    expect(panel.textContent).toContain('CR-7F3K9Q');
    expect(document.activeElement).toBe(panel);
    expect(fixture.componentInstance.form.controls.subject.value).toBe('demo-cabinet');
    expect(fixture.componentInstance.form.controls.fullName.value).toBe('');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    tick(500); // purge le debounce du brouillon
  }));

  it('400 → erreurs serveur attachées aux contrôles + résumé role="alert", valeurs conservées', async () => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock.expectOne(SUBMIT_URL).flush(
      {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fieldErrors: { email: [{ code: 'Invalid', message: 'Adresse e-mail refusée par le serveur' }] },
        globalErrors: []
      },
      { status: 400, statusText: 'Bad Request' }
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fieldError(fixture, 'cr-email')).toBe('Adresse e-mail refusée par le serveur');
    const summary: HTMLElement = fixture.nativeElement.querySelector('.cr-alert[role="alert"]');
    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain(COPY.errors.validationGlobal);
    // Le formulaire reste éditable et les valeurs sont conservées.
    const form = fixture.componentInstance.form;
    expect(form.enabled).toBeTrue();
    expect(form.controls.fullName.value).toBe('Amel Ben Salah');
  });

  it('429 → bouton désactivé avec compte à rebours, puis réactivé à expiration', fakeAsync(() => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock
      .expectOne(SUBMIT_URL)
      .flush(
        { success: false, message: 'Too many requests', errors: ['Trop de requêtes'] },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '3' } }
      );
    tick(0);
    fixture.detectChanges();

    const banner: HTMLElement = fixture.nativeElement.querySelector('.cr-alert--warning');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('3');
    let button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBeTrue();
    // Les valeurs saisies sont conservées pendant le blocage.
    expect(fixture.componentInstance.form.controls.message.value).toContain('démonstration');

    tick(1000);
    fixture.detectChanges();
    expect(banner.textContent).toContain('2');
    tick(2000);
    fixture.detectChanges();

    button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.cr-alert--warning')).toBeNull();
    tick(500); // purge le debounce du brouillon
  }));

  it('429 → le message alerté est statique, le décompte vit hors live-region (WCAG)', fakeAsync(() => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock
      .expectOne(SUBMIT_URL)
      .flush(
        { success: false, message: 'Too many requests' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '3' } }
      );
    tick(0);
    fixture.detectChanges();

    const banner: HTMLElement = fixture.nativeElement.querySelector('.cr-alert[role="alert"]');
    // Le nœud alerté reste identique d'un tick à l'autre (pas de ré-annonce chaque seconde).
    const announced = Array.from(
      banner.querySelectorAll<HTMLElement>('p:not([aria-hidden])')
    );
    expect(announced).toHaveSize(1);
    expect(announced[0].textContent).toContain('Réessayez dans quelques instants');

    const countdown = banner.querySelector<HTMLElement>('.cr-alert__countdown');
    expect(countdown).not.toBeNull();
    expect(countdown!.getAttribute('aria-hidden')).toBe('true');
    expect(countdown!.textContent).toContain('3');

    tick(1000);
    fixture.detectChanges();
    const bannerAfter: HTMLElement = fixture.nativeElement.querySelector('.cr-alert[role="alert"]');
    const announcedAfter = Array.from(
      bannerAfter.querySelectorAll<HTMLElement>('p:not([aria-hidden])')
    );
    expect(announcedAfter).toHaveSize(1);
    expect(announcedAfter[0].textContent).toContain('Réessayez dans quelques instants');
    expect(
      fixture.nativeElement.querySelector('.cr-alert__countdown').textContent
    ).toContain('2');
    tick(3000);
    tick(500); // purge le debounce du brouillon
  }));

  it('429 sans en-tête Retry-After → repli 60 s', fakeAsync(() => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock
      .expectOne(SUBMIT_URL)
      .flush({ success: false, message: 'Too many' }, { status: 429, statusText: 'Too Many Requests' });
    tick(0);
    fixture.detectChanges();
    const banner: HTMLElement = fixture.nativeElement.querySelector('.cr-alert--warning');
    expect(banner.textContent).toContain('60');
    tick(60_000);
    tick(500);
  }));

  it('503 → panneau de repli avec l’adresse e-mail (mailto) à la place du formulaire', async () => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock.expectOne(SUBMIT_URL).flush({ success: false, error: 'disabled' }, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    const panel: HTMLElement = fixture.nativeElement.querySelector('.cr-panel--disabled');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain(CONTACT_FALLBACK_EMAIL);
    const mailto: HTMLAnchorElement = panel.querySelector('a[href^="mailto:"]')!;
    expect(mailto.getAttribute('href')).toBe(`mailto:${CONTACT_FALLBACK_EMAIL}`);
  });

  it('erreur réseau (status 0) → message de connectivité, formulaire conservé', () => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock.expectOne(SUBMIT_URL).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    fixture.detectChanges();
    const banner: HTMLElement = fixture.nativeElement.querySelector('.cr-alert[role="alert"]');
    expect(banner.textContent).toContain(COPY.errors.network);
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect(fixture.componentInstance.form.controls.email.value).toBe('amel@exemple.tn');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBeFalse();
  });

  it('erreur inattendue (500) → message générique', () => {
    const fixture = create();
    fillValid(fixture);
    submitForm(fixture);
    httpMock.expectOne(SUBMIT_URL).flush({ success: false }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    const banner: HTMLElement = fixture.nativeElement.querySelector('.cr-alert[role="alert"]');
    expect(banner.textContent).toContain(COPY.errors.unknown);
  });

  it('sans clé de site Turnstile, le widget n’est pas rendu', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('app-turnstile-widget')).toBeNull();
  });

  it('le bouton « Envoyer une autre demande » ramène au formulaire (objet conservé)', async () => {
    const fixture = create({ objet: 'demo-cabinet' });
    fillValid(fixture);
    submitForm(fixture);
    httpMock.expectOne(SUBMIT_URL).flush({ success: true, data: { reference: 'CR-ANOTHER' } }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const again: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-panel--success button');
    again.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect(fixture.componentInstance.form.controls.subject.value).toBe('demo-cabinet');
  });
});
