import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '@environments/environment';
import {
  AuthService,
  AuthResponse,
  User,
  normalizeTenantRole,
  normalizeTenantKind,
  normalizeRegistrationWarning,
  toRegistrationWarnings
} from './auth.service';

function makeJwt(expOffsetSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  const payload = btoa(JSON.stringify({ exp }));
  return `e.${payload}.s`;
}

const minimalUser: User = {
  id: 'u1',
  email: 'a@b.c',
  firstName: 'A',
  lastName: 'B',
  fullName: 'A B',
  role: 'Administrator',
  roleDisplay: 'Admin',
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Co',
  twoFactorEnabled: false,
  // Champs requis depuis le passage en fail-closed : une session stockée sans
  // enabledModuleIds/effectivePermissions est purgée au chargement (re-login).
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: []
};

function configureAuthTestBed(): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
  });
}

describe('normalizeTenantKind', () => {
  it('maps PascalCase API string AccountingFirm to accountingFirm', () => {
    expect(normalizeTenantKind('AccountingFirm')).toBe('accountingFirm');
  });

  it('maps numeric enum 1 to accountingFirm', () => {
    expect(normalizeTenantKind(1)).toBe('accountingFirm');
  });

  it('falls back to accountingFirm for FirmManager without tenantKind', () => {
    expect(normalizeTenantKind(undefined, 'FirmManager')).toBe('accountingFirm');
  });

  it('maps Company + Administrator to company', () => {
    expect(normalizeTenantKind('Company', 'Administrator')).toBe('company');
  });
});

describe('normalizeTenantRole', () => {
  it('maps camelCase API strings to PascalCase', () => {
    expect(normalizeTenantRole('administrator')).toBe('Administrator');
    expect(normalizeTenantRole('supervisor')).toBe('Supervisor');
    expect(normalizeTenantRole('salesRep')).toBe('SalesRep');
    expect(normalizeTenantRole('salesManager')).toBe('SalesManager');
  });

  it('is idempotent for PascalCase', () => {
    expect(normalizeTenantRole('Administrator')).toBe('Administrator');
    expect(normalizeTenantRole('Supervisor')).toBe('Supervisor');
    expect(normalizeTenantRole('SalesRep')).toBe('SalesRep');
  });

  it('maps numeric enum indices from API', () => {
    expect(normalizeTenantRole(0)).toBe('Administrator');
    expect(normalizeTenantRole(9)).toBe('Supervisor');
  });

  it('defaults unknown strings to Accountant', () => {
    expect(normalizeTenantRole('not-a-role')).toBe('Accountant');
  });
});

describe('normalizeRegistrationWarning', () => {
  it('keeps a known code and severity untouched', () => {
    expect(normalizeRegistrationWarning({
      code: 'NIF_SEGMENT_MISMATCH',
      message: 'Vérifiez votre NIF.',
      severity: 'info'
    })).toEqual({ code: 'NIF_SEGMENT_MISMATCH', message: 'Vérifiez votre NIF.', severity: 'info' });
  });

  // Garde anti-dérive : ce code a été ajouté côté API (provisionnement plateforme) longtemps
  // avant d'exister dans l'union front, et tombait donc silencieusement en dehors du type.
  it('keeps SUBSCRIPTION_PLAN_NOT_APPLIED, the platform provisioning code', () => {
    expect(normalizeRegistrationWarning({
      code: 'SUBSCRIPTION_PLAN_NOT_APPLIED',
      message: 'Offre non appliquée.',
      severity: 'warning'
    })?.code).toBe('SUBSCRIPTION_PLAN_NOT_APPLIED');
  });

  it('degrades an unknown code to UNKNOWN but keeps the message', () => {
    const warning = normalizeRegistrationWarning({
      code: 'SOME_FUTURE_SERVER_CODE',
      message: 'Message à afficher quand même.',
      severity: 'warning'
    });

    expect(warning).toEqual({ code: 'UNKNOWN', message: 'Message à afficher quand même.', severity: 'warning' });
  });

  it('does not mistake an Object.prototype key for a known code', () => {
    expect(normalizeRegistrationWarning({ code: 'constructor', message: 'x' })?.code).toBe('UNKNOWN');
  });

  // `warning` et non `info` : on ne dégrade jamais un avis en simple information par accident.
  it('falls back to warning for an unknown severity', () => {
    expect(normalizeRegistrationWarning({
      code: 'NIF_SEGMENT_MISMATCH',
      message: 'x',
      severity: 'error'
    })?.severity).toBe('warning');
  });

  it('maps a bare legacy message to UNKNOWN / warning', () => {
    expect(normalizeRegistrationWarning({ message: 'Module refusé par votre plan' }))
      .toEqual({ code: 'UNKNOWN', message: 'Module refusé par votre plan', severity: 'warning' });
  });

  it('drops entries with no displayable message', () => {
    expect(normalizeRegistrationWarning({ code: 'NIF_SEGMENT_MISMATCH', message: '   ' })).toBeNull();
    expect(normalizeRegistrationWarning({ code: 'NIF_SEGMENT_MISMATCH' })).toBeNull();
    expect(normalizeRegistrationWarning(null)).toBeNull();
  });
});

describe('toRegistrationWarnings', () => {
  it('prefers warningDetails and narrows every entry', () => {
    const response = {
      warnings: ['ignoré'],
      warningDetails: [
        { code: 'SOME_FUTURE_SERVER_CODE', message: 'Nouveau', severity: 'error' },
        { code: 'NIF_SEGMENT_MISMATCH', message: 'NIF', severity: 'info' }
      ]
    } as unknown as AuthResponse;

    expect(toRegistrationWarnings(response)).toEqual([
      { code: 'UNKNOWN', message: 'Nouveau', severity: 'warning' },
      { code: 'NIF_SEGMENT_MISMATCH', message: 'NIF', severity: 'info' }
    ]);
  });

  // Compatibilité descendante : API antérieure aux avertissements typés.
  it('falls back to plain warnings and skips blank ones', () => {
    const response = { warnings: ['Module refusé', '  '] } as unknown as AuthResponse;

    expect(toRegistrationWarnings(response)).toEqual([
      { code: 'UNKNOWN', message: 'Module refusé', severity: 'warning' }
    ]);
  });

  it('returns an empty list for a missing response', () => {
    expect(toRegistrationWarnings(null)).toEqual([]);
    expect(toRegistrationWarnings({} as AuthResponse)).toEqual([]);
  });
});

describe('AuthService', () => {
  let httpMock: HttpTestingController;

  afterEach(() => {
    // Le warm-up post-login est un fire-and-forget non testé ici : on draine
    // silencieusement toute requête /ai/warm-up restante avant verify().
    httpMock?.match(r => r.url.endsWith('/ai/warm-up')).forEach(r => r.flush({ warmed: true }));
    httpMock?.verify();
  });

  describe('legacy migration', () => {
    it('copies auth keys from localStorage to sessionStorage and clears local', () => {
      localStorage.clear();
      sessionStorage.clear();
      const access = makeJwt();
      localStorage.setItem('ft_access_token', access);
      localStorage.setItem('ft_refresh_token', 'refresh-legacy');
      localStorage.setItem('ft_user', JSON.stringify(minimalUser));

      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.inject(AuthService);

      expect(sessionStorage.getItem('ft_access_token')).toBe(access);
      expect(sessionStorage.getItem('ft_refresh_token')).toBe('refresh-legacy');
      expect(localStorage.getItem('ft_access_token')).toBeNull();
      expect(localStorage.getItem('ft_refresh_token')).toBeNull();
    });

    it('does not migrate when ft_auth_remember_me is set', () => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('ft_auth_remember_me', '1');
      localStorage.setItem('ft_access_token', makeJwt());
      localStorage.setItem('ft_refresh_token', 'r');
      localStorage.setItem('ft_user', JSON.stringify(minimalUser));

      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
      const service = TestBed.inject(AuthService);

      expect(sessionStorage.getItem('ft_access_token')).toBeNull();
      expect(localStorage.getItem('ft_access_token')).toBeTruthy();
      expect(service.getAccessToken()).toBe(localStorage.getItem('ft_access_token'));
    });
  });

  describe('login', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    it('stores tokens in sessionStorage when rememberMe is false', () => {
      const service = TestBed.inject(AuthService);
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: minimalUser,
        requires2Fa: false
      };

      service
        .login({ email: 'a@b.c', password: 'x', rememberMe: false })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(sessionStorage.getItem('ft_access_token')).toBe(authData.accessToken);
      expect(localStorage.getItem('ft_auth_remember_me')).toBeNull();
      expect(localStorage.getItem('ft_access_token')).toBeNull();
    });

    it('stores tokens in localStorage when rememberMe is true', () => {
      const service = TestBed.inject(AuthService);
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: minimalUser,
        requires2Fa: false
      };

      service
        .login({ email: 'a@b.c', password: 'x', rememberMe: true })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(localStorage.getItem('ft_auth_remember_me')).toBe('1');
      expect(localStorage.getItem('ft_access_token')).toBe(authData.accessToken);
      expect(sessionStorage.getItem('ft_access_token')).toBeNull();
    });

    it('normalizes camelCase role from API and exposes platform settings for administrator', () => {
      const service = TestBed.inject(AuthService);
      const apiUser: User = {
        ...minimalUser,
        role: 'administrator'
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: apiUser,
        requires2Fa: false
      };

      service
        .login({ email: 'a@b.c', password: 'x', rememberMe: false })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(service.user()?.role).toBe('Administrator');
      expect(service.isAdmin()).toBe(true);
      expect(service.canAccessPlatformSettings()).toBe(true);
      const stored = JSON.parse(sessionStorage.getItem('ft_user')!) as User;
      expect(stored.role).toBe('Administrator');
    });

    it('normalizes supervisor camelCase for platform settings', () => {
      const service = TestBed.inject(AuthService);
      const apiUser: User = {
        ...minimalUser,
        role: 'supervisor'
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: apiUser,
        requires2Fa: false
      };

      service
        .login({ email: 'a@b.c', password: 'x', rememberMe: false })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(service.user()?.role).toBe('Supervisor');
      expect(service.isAdmin()).toBe(false);
      expect(service.canAccessPlatformSettings()).toBe(true);
    });

    it('does not grant platform settings to accountant (camelCase from API)', () => {
      const service = TestBed.inject(AuthService);
      const apiUser: User = {
        ...minimalUser,
        role: 'accountant'
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: apiUser,
        requires2Fa: false
      };

      service
        .login({ email: 'a@b.c', password: 'x', rememberMe: false })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(service.user()?.role).toBe('Accountant');
      expect(service.isAdmin()).toBe(false);
      expect(service.canAccessPlatformSettings()).toBe(false);
    });

    it('does not warm up AI after FirmManager login', () => {
      const service = TestBed.inject(AuthService);
      const firmUser: User = {
        ...minimalUser,
        role: 'FirmManager',
        tenantKind: 'AccountingFirm',
        effectivePermissions: ['firm:manage']
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: firmUser,
        requires2Fa: false
      };

      service.login({ email: 'a@b.c', password: 'x', rememberMe: false }).subscribe();

      const loginReq = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      loginReq.flush({ success: true, data: authData, message: null, errors: [] });

      httpMock.expectNone(r => r.url.endsWith('/ai/warm-up'));
    });

    it('warms up AI after login when user has ai:chat permission', () => {
      const service = TestBed.inject(AuthService);
      const adminUser: User = {
        ...minimalUser,
        role: 'Administrator',
        effectivePermissions: ['ai:chat']
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: adminUser,
        requires2Fa: false
      };

      service.login({ email: 'a@b.c', password: 'x', rememberMe: false }).subscribe();

      const loginReq = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/login` && r.method === 'POST'
      );
      loginReq.flush({ success: true, data: authData, message: null, errors: [] });

      const warmReq = httpMock.expectOne(
        r => r.url.endsWith('/ai/warm-up') && r.method === 'POST'
      );
      warmReq.flush({ warmed: true });
    });
  });

  describe('register', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    it('stores the full user profile (enabledModuleIds, companySegment, businessDomain) from the response', () => {
      const service = TestBed.inject(AuthService);
      const registeredUser: User = {
        ...minimalUser,
        enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 10],
        companySegment: 'commerce',
        businessDomain: 'textile-habillement'
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'new-refresh',
        expiresAt: '',
        user: registeredUser,
        requires2Fa: false
      };

      service.register({
        email: 'a@b.c',
        password: 'x',
        confirmPassword: 'x',
        firstName: 'A',
        lastName: 'B',
        companyName: 'Co',
        nif: '1234567',
        taxRegime: 0,
        street: 'Rue 1',
        city: 'Tunis',
        governorate: 'Tunis',
        companyEmail: 'co@b.c',
        phone: '20000000'
      }).subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/register` && r.method === 'POST'
      );
      req.flush({ success: true, data: authData, message: null, errors: [] });

      expect(service.user()?.enabledModuleIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10]);
      expect(service.user()?.companySegment).toBe('commerce');
      expect(service.user()?.businessDomain).toBe('textile-habillement');
    });

    // Garde anti-régression (fuite de secrets) : la réponse d'inscription transporte
    // accessToken/refreshToken et le profil complet. Un `console.log` de cette réponse a
    // existé dans `register()` et affichait les jetons en clair dans la console du
    // navigateur (visibles sur toute capture d'écran de support).
    it('never writes the registration response to the console (tokens must not leak)', () => {
      const logSpy = spyOn(console, 'log');
      const errorSpy = spyOn(console, 'error');
      const service = TestBed.inject(AuthService);
      const payload = {
        email: 'a@b.c',
        password: 'x',
        confirmPassword: 'x',
        firstName: 'A',
        lastName: 'B',
        companyName: 'Co',
        nif: '1234567/A/B/C/000',
        taxRegime: 0,
        street: 'Rue 1',
        city: 'Tunis',
        governorate: 'Tunis',
        companyEmail: 'co@b.c',
        phone: '20000000'
      };
      const authData: AuthResponse = {
        accessToken: makeJwt(),
        refreshToken: 'super-secret-refresh',
        expiresAt: '',
        user: minimalUser,
        requires2Fa: false
      };

      service.register(payload).subscribe();
      httpMock
        .expectOne(r => r.url === `${environment.apiUrl}/auth/register` && r.method === 'POST')
        .flush({ success: true, data: authData, message: null, errors: [] });

      service.register(payload).subscribe({ error: () => undefined });
      httpMock
        .expectOne(r => r.url === `${environment.apiUrl}/auth/register` && r.method === 'POST')
        .flush({ success: false, message: 'boom', errors: [] }, { status: 400, statusText: 'Bad Request' });

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('refreshUserProfile', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    it('calls GET /auth/me and updates the user signal', () => {
      const service = TestBed.inject(AuthService);
      const refreshed: User = {
        ...minimalUser,
        enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 10]
      };

      service.refreshUserProfile().subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/me` && r.method === 'GET'
      );
      req.flush({ success: true, data: refreshed, message: null, errors: [] });

      expect(service.user()?.enabledModuleIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10]);
    });
  });

  describe('bootstrap from storage', () => {
    it('normalizes camelCase role when loading ft_user from sessionStorage', () => {
      localStorage.clear();
      sessionStorage.clear();
      const raw = { ...minimalUser, role: 'administrator' };
      sessionStorage.setItem('ft_access_token', makeJwt());
      sessionStorage.setItem('ft_refresh_token', 'r');
      sessionStorage.setItem('ft_user', JSON.stringify(raw));
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
      const service = TestBed.inject(AuthService);
      expect(service.user()?.role).toBe('Administrator');
      expect(service.canAccessPlatformSettings()).toBe(true);
    });
  });

  describe('permission helpers', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    function setEffectivePermissions(service: AuthService, perms: string[] | undefined): void {
      const u = { ...minimalUser, effectivePermissions: perms };
      (service as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
    }

    it('hasPermission refuse quand effectivePermissions est absent (fail-closed)', () => {
      // Le backend renvoie toujours effectivePermissions ; une absence ne peut être
      // qu'un état anormal (storage édité) => refus, plus de fail-open legacy.
      const service = TestBed.inject(AuthService);
      setEffectivePermissions(service, undefined);
      expect(service.hasPermission('products:create')).toBe(false);
    });

    it('hasPermission reflects effectivePermissions when set', () => {
      const service = TestBed.inject(AuthService);
      setEffectivePermissions(service, ['products:read']);
      expect(service.hasPermission('products:read')).toBe(true);
      expect(service.hasPermission('products:create')).toBe(false);
    });

    it('hasAnyPermission returns true if one matches', () => {
      const service = TestBed.inject(AuthService);
      setEffectivePermissions(service, ['products:read']);
      expect(service.hasAnyPermission(['products:create', 'products:read'])).toBe(true);
    });

    it('hasAnyPermission returns false when none match', () => {
      const service = TestBed.inject(AuthService);
      setEffectivePermissions(service, ['products:read']);
      expect(service.hasAnyPermission(['products:create', 'products:delete'])).toBe(false);
    });
  });

  describe('invalidateSession / logout redirect', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    function seedSession(): AuthService {
      sessionStorage.setItem('ft_access_token', makeJwt());
      sessionStorage.setItem('ft_refresh_token', 'r');
      sessionStorage.setItem('ft_user', JSON.stringify(minimalUser));
      return TestBed.inject(AuthService);
    }

    it('invalidateSession clears tokens without POST /logout and skips navigate on /auth/login', () => {
      const service = seedSession();
      const router = TestBed.inject(Router);
      spyOnProperty(router, 'url', 'get').and.returnValue('/auth/login');
      const navigateSpy = spyOn(router, 'navigate');

      service.invalidateSession();

      expect(sessionStorage.getItem('ft_access_token')).toBeNull();
      expect(service.user()).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
      httpMock.expectNone(r => r.url.includes('/auth/logout'));
    });

    it('invalidateSession redirects to login when not on an auth route', () => {
      const service = seedSession();
      const router = TestBed.inject(Router);
      spyOnProperty(router, 'url', 'get').and.returnValue('/dashboard');
      const navigateSpy = spyOn(router, 'navigate').and.resolveTo(true);

      service.invalidateSession();

      expect(sessionStorage.getItem('ft_access_token')).toBeNull();
      expect(navigateSpy).toHaveBeenCalledWith(['/auth/login']);
    });

    it('logout clears session and skips navigate when already on /auth/register', () => {
      const service = seedSession();
      const router = TestBed.inject(Router);
      spyOnProperty(router, 'url', 'get').and.returnValue('/auth/register');
      const navigateSpy = spyOn(router, 'navigate');

      service.logout();
      const req = httpMock.expectOne(r => r.url === `${environment.apiUrl}/auth/logout`);
      req.flush({});

      expect(sessionStorage.getItem('ft_access_token')).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('password reset', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      configureAuthTestBed();
      httpMock = TestBed.inject(HttpTestingController);
    });

    it('forgotPassword posts email to /auth/forgot-password', () => {
      const service = TestBed.inject(AuthService);
      service.forgotPassword('user@example.com').subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/forgot-password` && r.method === 'POST'
      );
      expect(req.request.body).toEqual({ email: 'user@example.com' });
      req.flush({ success: true, data: null, message: 'ok', errors: [] });
    });

    it('resetPassword posts dto to /auth/reset-password', () => {
      const service = TestBed.inject(AuthService);
      const dto = {
        email: 'user@example.com',
        token: 'tok',
        newPassword: 'SecurePass123!',
        confirmNewPassword: 'SecurePass123!',
      };
      service.resetPassword(dto).subscribe();

      const req = httpMock.expectOne(
        r => r.url === `${environment.apiUrl}/auth/reset-password` && r.method === 'POST'
      );
      expect(req.request.body).toEqual(dto);
      req.flush({ success: true, data: null, message: 'ok', errors: [] });
    });
  });
});
