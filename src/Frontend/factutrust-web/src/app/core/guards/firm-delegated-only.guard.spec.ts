import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { firmDelegatedOnlyGuard } from './firm-delegated-only.guard';

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

const companyUser: User = {
  ...firmUser,
  role: 'Administrator',
  tenantKind: 'Company'
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('firmDelegatedOnlyGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()]
    });
  });

  it('lets a delegated firm user through', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    const result = TestBed.runInInjectionContext(() => firmDelegatedOnlyGuard({} as never, {} as never));
    expect(result).toBe(true);
  });

  it('redirects a native firm user to the firm dashboard', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    const result = TestBed.runInInjectionContext(() => firmDelegatedOnlyGuard({} as never, {} as never));
    expect(result).not.toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/firm/dashboard');
  });

  it('redirects a company user to the accounting hub', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    const result = TestBed.runInInjectionContext(() => firmDelegatedOnlyGuard({} as never, {} as never));
    expect(result).not.toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/accounting');
  });
});
