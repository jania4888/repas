import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { PlatformPermissionsService } from './platform-permissions.service';
import type { PlatformMePermissionsDto } from '@core/models/platform.models';

/**
 * `hasFeature` sert à ne pas proposer une action que le serveur refusera par un 404 nu — mais il ne
 * doit jamais masquer une action qui marche. D'où le défaut à `true` quand l'API ne renseigne pas
 * `features` (instance antérieure à son exposition) ou quand rien n'est encore chargé.
 */
describe('PlatformPermissionsService.hasFeature', () => {
  let service: PlatformPermissionsService;
  let httpMock: HttpTestingController;

  const url = `${environment.apiUrl}/platform/auth/me/permissions`;

  function load(features: PlatformMePermissionsDto['features']): void {
    service.load().subscribe();
    httpMock.expectOne(url).flush({
      success: true,
      data: {
        userId: '8f1a2b3c-0000-4000-8000-000000000001',
        email: 'ops@instafact.test',
        roles: ['PlatformAdmin'],
        permissions: ['platform.tenants:write'],
        features
      } satisfies PlatformMePermissionsDto
    });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PlatformPermissionsService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(PlatformPermissionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('vaut true tant que rien n’est chargé', () => {
    expect(service.hasFeature('accountingFirms')).toBeTrue();
  });

  it('vaut true quand l’API ne renvoie pas de drapeaux (compatibilité ascendante)', () => {
    load(undefined);
    expect(service.hasFeature('accountingFirms')).toBeTrue();
  });

  it('suit le drapeau quand l’API le renseigne', () => {
    load({ accountingFirms: false });
    expect(service.hasFeature('accountingFirms')).toBeFalse();
    expect(service.hasFeature('inconnu')).toBeTrue();
  });

  it('revient au défaut après clear()', () => {
    load({ accountingFirms: false });
    service.clear();
    expect(service.hasFeature('accountingFirms')).toBeTrue();
  });
});
