import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { FirmAreaCoherenceService } from './firm-area-coherence.service';

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

/** Un `effect()` puis la microtâche de `enforceNow()`. */
async function settle(): Promise<void> {
  TestBed.flushEffects();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FirmAreaCoherenceService', () => {
  let router: Router;
  let auth: AuthService;
  let navigateByUrl: jasmine.Spy;

  function createService(url: string): FirmAreaCoherenceService {
    spyOnProperty(router, 'url', 'get').and.returnValue(url);
    return TestBed.inject(FirmAreaCoherenceService);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()]
    });
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
    navigateByUrl = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    spyOn(router, 'getCurrentNavigation').and.returnValue(null);
  });

  it('does nothing until start() is called', async () => {
    const service = createService('/firm/dashboard');
    setUser(auth, delegatedUser);
    await settle();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(service).toBeTruthy();
  });

  it('sends the user back to the dossier when the token turns delegated without navigation', async () => {
    const service = createService('/firm/dashboard');
    setUser(auth, firmUser);
    service.start();
    await settle();
    expect(navigateByUrl).not.toHaveBeenCalled();

    setUser(auth, delegatedUser);
    await settle();
    expect(navigateByUrl).toHaveBeenCalledOnceWith('/accounting/chart');
  });

  it('does not repeat the same redirection', async () => {
    const service = createService('/firm/dashboard');
    setUser(auth, delegatedUser);
    service.start();
    await settle();
    await settle();
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('stands aside while a navigation is in flight', async () => {
    (router.getCurrentNavigation as jasmine.Spy).and.returnValue({} as never);
    const service = createService('/firm/dashboard');
    setUser(auth, delegatedUser);
    service.start();
    await settle();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('returns a native firm user from a dossier-only route to the cabinet', async () => {
    const service = createService('/accounting/chart');
    setUser(auth, firmUser);
    service.start();
    await settle();
    expect(navigateByUrl).toHaveBeenCalledOnceWith('/firm/dashboard');
  });

  it('leaves a coherent state alone', async () => {
    const service = createService('/accounting/chart');
    setUser(auth, delegatedUser);
    service.start();
    await settle();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('never redirects a company user', async () => {
    const service = createService('/firm/dashboard');
    setUser(auth, { ...firmUser, role: 'Administrator', tenantKind: 'Company' });
    service.start();
    await settle();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
