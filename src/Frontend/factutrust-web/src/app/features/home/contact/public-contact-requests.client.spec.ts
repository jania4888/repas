import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TimeoutError } from 'rxjs';
import { SKIP_AUTH_HEADER, SKIP_ERROR_TOAST } from '@core/http-context';
import type { CreateContactRequestDto } from './contact-request.models';
import { CONTACT_REQUEST_TIMEOUT_MS, PublicContactRequestsClient } from './public-contact-requests.client';

const DTO: CreateContactRequestDto = {
  subject: 'demo-cabinet',
  fullName: 'Amel Ben Salah',
  organization: 'Cabinet BS',
  email: 'amel@exemple.tn',
  phone: '+21620123456',
  size: 'dossiers:6-20',
  message: 'Nous souhaitons une démonstration.',
  consent: true,
  locale: 'fr',
  honeypot: '',
  elapsedMs: 12000
};

describe('PublicContactRequestsClient', () => {
  let client: PublicContactRequestsClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PublicContactRequestsClient, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    client = TestBed.inject(PublicContactRequestsClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('poste le DTO en anonyme sur /api/public/contact-requests et renvoie la référence', () => {
    let result: { reference: string } | undefined;
    client.submit(DTO).subscribe(r => (result = r));
    const req = httpMock.expectOne('/api/public/contact-requests');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(DTO);
    expect(req.request.context.get(SKIP_AUTH_HEADER)).toBeTrue();
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: { reference: 'CR-7F3K9Q' } }, { status: 202, statusText: 'Accepted' });
    expect(result).toEqual({ reference: 'CR-7F3K9Q' });
  });

  it('renvoie une référence vide si l’enveloppe ne contient pas de data', () => {
    let result: { reference: string } | undefined;
    client.submit(DTO).subscribe(r => (result = r));
    httpMock.expectOne(client.baseUrl).flush({ success: true }, { status: 202, statusText: 'Accepted' });
    expect(result).toEqual({ reference: '' });
  });

  it('propage l’erreur HTTP telle quelle', () => {
    let error: unknown;
    client.submit(DTO).subscribe({ error: e => (error = e) });
    httpMock.expectOne(client.baseUrl).flush({ success: false }, { status: 429, statusText: 'Too Many Requests' });
    expect((error as { status: number }).status).toBe(429);
  });

  it('échoue en TimeoutError après 15 s sans réponse', fakeAsync(() => {
    let error: unknown;
    client.submit(DTO).subscribe({ error: e => (error = e) });
    httpMock.expectOne(client.baseUrl);
    tick(CONTACT_REQUEST_TIMEOUT_MS + 1);
    expect(error).toBeInstanceOf(TimeoutError);
  }));
});
