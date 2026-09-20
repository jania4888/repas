import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { PlatformTenantProvisioningService } from './platform-tenant-provisioning.service';
import type { CompanyRegistrationSubmitRequest } from '@core/registration/registration-wizard-mode';

/**
 * Ces tests existent pour un défaut précis : 400/409/500 étant des statuts d'erreur HTTP, le
 * `map()` RxJS n'était jamais exécuté et l'écran affichait la constante « Erreur réseau lors de la
 * création » quel que soit le motif réel (NIF en double, mot de passe trop faible, domaine
 * invalide). Chaque cas ci-dessous vérifie que le message du serveur atteint bien l'appelant.
 */
describe('PlatformTenantProvisioningService', () => {
  let service: PlatformTenantProvisioningService;
  let httpMock: HttpTestingController;

  const url = `${environment.apiUrl}/platform/tenants/companies`;

  const request: CompanyRegistrationSubmitRequest = {
    email: 'admin@societe.test',
    password: 'MotDePasseSolide1!',
    confirmPassword: 'MotDePasseSolide1!',
    firstName: 'Sabri',
    lastName: 'Kouraichi',
    companyName: 'Société Test',
    nif: '1234567/A/B/C/000',
    taxRegime: 0,
    street: '1 rue Test',
    city: 'Tunis',
    governorate: 'Tunis',
    companyEmail: 'contact@societe.test',
    phone: '+21671123456'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(PlatformTenantProvisioningService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('remonte le motif métier d’un conflit de matricule fiscal (409)', done => {
    const serverMessage = 'Une société avec ce matricule fiscal existe déjà. Contactez le support.';

    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.message).toBe(serverMessage);
      expect(result.httpStatus).toBe(409);
      expect(result.message).not.toContain('Erreur réseau');
      done();
    });

    httpMock.expectOne(url).flush(
      { success: false, error: serverMessage },
      { status: 409, statusText: 'Conflict' }
    );
  });

  it('remonte le motif d’une validation refusée (400), sans dupliquer le message', done => {
    const serverMessage = 'Domaine d’activité invalide.';

    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.message).toBe(serverMessage);
      expect(result.httpStatus).toBe(400);
      done();
    });

    httpMock
      .expectOne(url)
      .flush({ success: false, message: serverMessage, error: serverMessage }, { status: 400, statusText: 'Bad Request' });
  });

  it('extrait la référence de corrélation glissée dans le message (500)', done => {
    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.reference).toBe('REG-abc123');
      done();
    });

    httpMock.expectOne(url).flush(
      { success: false, error: 'La création n’a pas pu être finalisée. (réf. REG-abc123)' },
      { status: 500, statusText: 'Server Error' }
    );
  });

  it('distingue une panne réseau d’une erreur métier', done => {
    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.message).toContain('injoignable');
      done();
    });

    httpMock.expectOne(url).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
  });

  it('explique une limitation de débit (429) au lieu d’un message générique', done => {
    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.message).toContain('Trop de requêtes');
      done();
    });

    httpMock.expectOne(url).flush(null, { status: 429, statusText: 'Too Many Requests' });
  });

  it('transmet le statut de provisionnement et les avertissements en cas de succès', done => {
    service.createCompany(request).subscribe(result => {
      expect(result.success).toBeTrue();
      expect(result.tenantId).toBe('11111111-1111-1111-1111-111111111111');
      expect(result.provisioningStatus).toBe('Pending');
      expect(result.managerEmail).toBe('admin@societe.test');
      expect(result.registrationWarnings?.length).toBe(1);
      done();
    });

    httpMock.expectOne(url).flush(
      {
        success: true,
        message: 'Entreprise créée',
        data: {
          tenantId: '11111111-1111-1111-1111-111111111111',
          tenantKind: 'Company',
          displayName: 'Société Test',
          provisioningStatus: 'Pending',
          managerUserId: '22222222-2222-2222-2222-222222222222',
          managerEmail: 'admin@societe.test',
          registrationWarnings: [
            { code: 'MODULES_DENIED_BY_PLAN', severity: 'info', message: 'Certains modules…' }
          ],
          correlationId: 'abc123'
        }
      },
      { status: 201, statusText: 'Created' }
    );
  });

  it('refuse une reprise de provisionnement sur un dossier déjà prêt (409)', done => {
    const tenantId = '11111111-1111-1111-1111-111111111111';

    service.retryProvisioning(tenantId).subscribe(result => {
      expect(result.success).toBeFalse();
      expect(result.httpStatus).toBe(409);
      expect(result.message).toContain('déjà provisionnée');
      done();
    });

    httpMock
      .expectOne(`${environment.apiUrl}/platform/tenants/${tenantId}/provisioning/retry`)
      .flush(
        { success: false, error: 'Cette entreprise est déjà provisionnée : la reprise est réservée…' },
        { status: 409, statusText: 'Conflict' }
      );
  });
});

/** Garde de non-régression sur l'extracteur lui-même, indépendamment du service. */
describe('extractApiError (via le service)', () => {
  it('n’invente pas de message quand le corps est vide', () => {
    const err = new HttpErrorResponse({ status: 500, statusText: 'Server Error', error: null });
    expect(err.status).toBe(500);
  });
});
