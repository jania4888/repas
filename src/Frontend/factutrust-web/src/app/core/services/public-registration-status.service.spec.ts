import { HttpRequest, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { SKIP_AUTH_HEADER, SKIP_ERROR_TOAST } from '@core/http-context';
import { PublicRegistrationStatusService } from './public-registration-status.service';

describe('PublicRegistrationStatusService', () => {
  let service: PublicRegistrationStatusService;
  let httpMock: HttpTestingController;
  const url = `${environment.apiUrl}/public/registration-status`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PublicRegistrationStatusService, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
    });
    service = TestBed.inject(PublicRegistrationStatusService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('est « fermé » et non chargé avant tout appel', () => {
    expect(service.loaded()).toBeFalse();
    expect(service.companyOpen()).toBeFalse();
    expect(service.firmOpen()).toBeFalse();
  });

  it('interroge une seule fois le statut, en anonyme et sans toast global', () => {
    service.ensureLoaded();
    service.ensureLoaded();
    const req = httpMock.expectOne((r: HttpRequest<unknown>) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_AUTH_HEADER)).toBeTrue();
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    req.flush({ success: true, data: { companyEnabled: true, firmEnabled: true } });

    expect(service.loaded()).toBeTrue();
    expect(service.snapshot()).toEqual({ companyEnabled: true, firmEnabled: true });
    expect(service.companyOpen()).toBe(environment.publicRegistration.companyEnabled);
    expect(service.firmOpen()).toBe(environment.publicRegistration.firmEnabled && environment.accountingFirmsEnabled);
    httpMock.expectNone(url);
  });

  it('considère les inscriptions fermées si success=false ou data manquante', () => {
    service.ensureLoaded();
    httpMock.expectOne(url).flush({ success: false, data: null, error: 'x' });
    expect(service.loaded()).toBeTrue();
    expect(service.companyOpen()).toBeFalse();
    expect(service.firmOpen()).toBeFalse();
  });

  it('considère les inscriptions fermées sur erreur HTTP (503) et marque loaded', () => {
    service.ensureLoaded();
    httpMock.expectOne(url).flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(service.loaded()).toBeTrue();
    expect(service.snapshot()).toEqual({ companyEnabled: false, firmEnabled: false });
  });

  it('considère les inscriptions fermées après dépassement du délai', fakeAsync(() => {
    service.ensureLoaded();
    httpMock.expectOne(url); // jamais flushé
    tick(environment.landing.registrationStatusTimeoutMs + 1);
    expect(service.loaded()).toBeTrue();
    expect(service.companyOpen()).toBeFalse();
    expect(service.firmOpen()).toBeFalse();
  }));

  it('firmOpen respecte le flag accountingFirmsEnabled et companyOpen ne dépend que de companyEnabled', () => {
    service.ensureLoaded();
    httpMock.expectOne(url).flush({ success: true, data: { companyEnabled: false, firmEnabled: true } });
    expect(service.companyOpen()).toBeFalse();
    expect(service.firmOpen()).toBe(environment.publicRegistration.firmEnabled && environment.accountingFirmsEnabled);
  });
});
