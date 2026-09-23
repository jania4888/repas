import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService, User } from '../services/auth.service';
import { SKIP_AUTH_HEADER, createHttpContextPublicAnonymous } from '../http-context';

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
  twoFactorEnabled: false
};

describe('authInterceptor', () => {
  it('adds Authorization when getAccessToken returns a value', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('test-access-token');
    authService.getRefreshToken.and.returnValue(null);
    authService.isAuthenticated.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.get('/api/inventory').subscribe();
    const req = httpMock.expectOne('/api/inventory');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-access-token');
    req.flush({});
    httpMock.verify();
  });

  it("n'attache jamais le Bearer aux URLs hors API (isOurApi)", () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('tok');
    authService.isAuthenticated.and.returnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.get('https://api.tierce.example.com/data').subscribe();
    const req = httpMock.expectOne('https://api.tierce.example.com/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    httpMock.verify();
  });

  it('does not add Authorization for auth/login', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('tok');
    authService.isAuthenticated.and.returnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.post('/api/auth/login', {}).subscribe();
    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    httpMock.verify();
  });

  it('does not call refreshToken when POST /auth/refresh returns 401 (avoids infinite refresh loop)', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('access');
    authService.getRefreshToken.and.returnValue('stored-refresh');
    authService.isAuthenticated.and.returnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.post('/api/auth/refresh', { refreshToken: 'x' }).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/refresh');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).not.toHaveBeenCalled();
    httpMock.verify();
  });

  it('calls refreshToken once when another endpoint returns 401 and a refresh token exists', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('access');
    authService.getRefreshToken.and.returnValue('stored-refresh');
    authService.isAuthenticated.and.returnValue(true);
    authService.refreshToken.and.returnValue(
      of({
        success: true,
        data: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresAt: '',
          user: minimalUser,
          requires2Fa: false
        },
        message: null,
        errors: []
      })
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.get('/api/inventory').subscribe();

    const req1 = httpMock.expectOne('/api/inventory');
    req1.flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);

    const req2 = httpMock.expectOne('/api/inventory');
    expect(req2.request.headers.get('Authorization')).toBe('Bearer new-access');
    req2.flush({});
    httpMock.verify();
  });

  it('calls invalidateSession when API returns 401, no refresh token, and session appears authenticated', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('expired-access');
    authService.getRefreshToken.and.returnValue(null);
    authService.isAuthenticated.and.returnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.get('/api/inventory').subscribe({ error: () => {} });

    const req1 = httpMock.expectOne('/api/inventory');
    req1.flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.invalidateSession).toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    httpMock.verify();
  });

  it('calls invalidateSession when refreshToken fails after a 401', () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('access');
    authService.getRefreshToken.and.returnValue('stored-refresh');
    authService.isAuthenticated.and.returnValue(true);
    authService.refreshToken.and.returnValue(throwError(() => ({ status: 401 })));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    http.get('/api/inventory').subscribe({ error: () => {} });

    const req1 = httpMock.expectOne('/api/inventory');
    req1.flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(authService.invalidateSession).toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    httpMock.verify();
  });

  it("n'attache jamais le Bearer ni ne rafraîchit quand SKIP_AUTH_HEADER est posé (endpoints publics de la landing)", () => {
    const authService = jasmine.createSpyObj('AuthService', [
      'getAccessToken',
      'getRefreshToken',
      'refreshToken',
      'logout',
      'invalidateSession',
      'isAuthenticated'
    ]);
    authService.getAccessToken.and.returnValue('tok');
    authService.getRefreshToken.and.returnValue('refresh');
    authService.isAuthenticated.and.returnValue(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);

    let status = 0;
    http
      .get('/api/public/registration-status', { context: createHttpContextPublicAnonymous() })
      .subscribe({ error: (e) => (status = e.status) });
    const req = httpMock.expectOne('/api/public/registration-status');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.context.get(SKIP_AUTH_HEADER)).toBeTrue();
    expect(authService.getAccessToken).not.toHaveBeenCalled();

    // Un 401 sur un appel public ne déclenche ni refresh ni invalidation de session.
    req.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.invalidateSession).not.toHaveBeenCalled();
    httpMock.verify();
  });
});
