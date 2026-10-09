import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { firmDelegatedAreaGuard } from './firm-delegated-area.guard';

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

const delegatedUser: User = {
  ...firmUser,
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Texto'
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('firmDelegatedAreaGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()]
    });
  });

  it('sends a delegated firm user back to the dossier instead of the cabinet dashboard', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmDelegatedAreaGuard({} as never, { url: '/firm/dashboard' } as never)
    );
    expect(result).not.toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/accounting/chart');
  });

  it('keeps the dossier switch route reachable in delegated mode', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmDelegatedAreaGuard(
        {} as never,
        { url: '/firm/open/00000000-0000-0000-0000-000000000004' } as never
      )
    );
    expect(result).toBe(true);
  });

  it('lets a native firm user through', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = await TestBed.runInInjectionContext(() =>
      firmDelegatedAreaGuard({} as never, { url: '/firm/dashboard' } as never)
    );
    expect(result).toBe(true);
  });

  it('never touches a company user', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, { ...firmUser, role: 'Administrator', tenantKind: 'Company' });
    const result = await TestBed.runInInjectionContext(() =>
      firmDelegatedAreaGuard({} as never, { url: '/firm/dashboard' } as never)
    );
    expect(result).toBe(true);
  });
});
