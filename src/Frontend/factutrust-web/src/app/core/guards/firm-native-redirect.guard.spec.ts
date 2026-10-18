import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { firmNativeRedirectGuard } from './firm-native-redirect.guard';

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
  twoFactorEnabled: false
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('firmNativeRedirectGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()]
    });
  });

  it('allows company user on /dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, role: 'Administrator', tenantKind: 'Company' });
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/dashboard' } as never)
    );
    expect(result).toBe(true);
  });

  it('redirects firm native user from /dashboard to /firm/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/dashboard' } as never)
    );
    expect(result).not.toBe(true);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('redirects firm native user from /return-notes', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/return-notes' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('redirects firm native user from /invoices/unpaid', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/invoices/unpaid' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('allows firm user on /firm/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/firm/dashboard' } as never)
    );
    expect(result).toBe(true);
  });

  it('redirects firm native user from /documentation to /firm/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/documentation' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('allows delegated firm user on /accounting/chart', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, accessMode: 'delegated', contextTenantId: '00000000-0000-0000-0000-000000000003' });
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/accounting/chart' } as never)
    );
    expect(result).toBe(true);
  });

  it('allows delegated firm user on /accounting/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, accessMode: 'delegated', contextTenantId: '00000000-0000-0000-0000-000000000003' });
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/accounting/dashboard' } as never)
    );
    expect(result).toBe(true);
  });

  it('redirects firm native user from /accounting/dashboard to /firm/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/accounting/dashboard' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('redirects firm native user from /ai-assistant to /firm/dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/ai-assistant/comptabilite' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/firm/dashboard');
  });

  it('redirects delegated firm user from /ai-assistant root to comptabilite', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, accessMode: 'delegated', contextTenantId: '00000000-0000-0000-0000-000000000003' });
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/ai-assistant' } as never)
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as never)).toContain('/ai-assistant/comptabilite');
  });

  it('allows delegated firm user on /ai-assistant/comptabilite', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, accessMode: 'delegated', contextTenantId: '00000000-0000-0000-0000-000000000003' });
    const result = await TestBed.runInInjectionContext(() =>
      firmNativeRedirectGuard({} as never, { url: '/ai-assistant/comptabilite' } as never)
    );
    expect(result).toBe(true);
  });
});
