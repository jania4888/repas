import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { AuthService, AuthResponse, User } from './auth.service';
import { FirmContextService } from './firm-context.service';
import { ToastService } from './toast.service';

function makeJwt(expOffsetSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  return `e.${btoa(JSON.stringify({ exp }))}.s`;
}

const firmUser: User = {
  id: 'u1',
  email: 'firm@test.c',
  firstName: 'O',
  lastName: 'G',
  fullName: 'O G',
  role: 'FirmManager',
  roleDisplay: 'Responsable cabinet',
  tenantId: '00000000-0000-0000-0000-000000000002',
  companyName: 'Cabinet Test',
  tenantKind: 'AccountingFirm',
  twoFactorEnabled: false,
  enabledModuleIds: [0],
  effectivePermissions: []
};

const dossierId = '00000000-0000-0000-0000-000000000003';

const delegatedUser: User = {
  ...firmUser,
  accessMode: 'delegated',
  contextTenantId: dossierId,
  contextCompanyName: 'Ste Texto'
};

function response(user: User): AuthResponse {
  return {
    accessToken: makeJwt(),
    refreshToken: 'new-refresh',
    expiresAt: '',
    user,
    requires2Fa: false
  };
}

function setUser(auth: AuthService, u: User): void {
  (auth as unknown as { userSignal: { set: (x: User) => void } }).userSignal.set(u);
}

/**
 * Le dossier ouvert par un cabinet doit survivre au renouvellement du jeton — et, s'il ne survit
 * pas, la session ne doit pas rester sur un écran de dossier en interrogeant la base du cabinet.
 */
describe('AuthService — contexte dossier au rafraîchissement', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('garde le contexte dossier quand le serveur le rejoue', () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    setUser(auth, delegatedUser);

    auth.refreshToken().subscribe();
    httpMock
      .expectOne(r => r.url === `${environment.apiUrl}/auth/refresh` && r.method === 'POST')
      .flush({ success: true, data: response(delegatedUser), message: null, errors: [] });

    expect(auth.user()?.accessMode).toBe('delegated');
    expect(auth.user()?.contextTenantId).toBe(dossierId);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ramène au cabinet quand le contexte dossier est perdu', () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const toast = TestBed.inject(ToastService);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const added = spyOn(toast, 'add');
    setUser(auth, delegatedUser);

    auth.refreshToken().subscribe();
    httpMock
      .expectOne(r => r.url === `${environment.apiUrl}/auth/refresh` && r.method === 'POST')
      .flush({ success: true, data: response({ ...firmUser, accessMode: 'native' }), message: null, errors: [] });

    expect(navigate).toHaveBeenCalledWith(['/firm/dashboard']);
    expect(added).toHaveBeenCalled();
  });

  it("ne redirige pas une session qui n'était pas déléguée", () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    setUser(auth, firmUser);

    auth.refreshToken().subscribe();
    httpMock
      .expectOne(r => r.url === `${environment.apiUrl}/auth/refresh` && r.method === 'POST')
      .flush({ success: true, data: response(firmUser), message: null, errors: [] });

    expect(navigate).not.toHaveBeenCalled();
  });

  it('la pastille dossier suit le jeton sans appel explicite à syncFromUser', () => {
    const auth = TestBed.inject(AuthService);
    const firmContext = TestBed.inject(FirmContextService);
    setUser(auth, delegatedUser);

    expect(firmContext.activeClient()?.tenantId).toBe(dossierId);

    setUser(auth, { ...firmUser, accessMode: 'native' });

    // Avant, l'état n'était recopié qu'au switch/clear : la pastille « Dossier : X » restait
    // affichée après un renouvellement silencieux de jeton.
    expect(firmContext.activeClient()).toBeNull();
    expect(firmContext.context().accessMode).toBe('native');
  });
});
