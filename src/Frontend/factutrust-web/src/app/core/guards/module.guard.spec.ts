import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService, User } from '@core/services/auth.service';
import { moduleGuard } from './module.guard';
import { AppModule } from '@core/models/app-module';

/**
 * plan v1-configuration-dynamique §6.2 ("Sécurité / anti-escalade" scenario): once a segment
 * (e.g. btp-construction) has been provisioned WITHOUT the CRM module, the sidebar never links to
 * `/crm` (see `app-nav.service.spec.ts`) — but the second, independent line of defense is this
 * guard: even a user who types the URL directly, or a stale bookmark/cached link, must be bounced
 * to `/access-denied`. No existing spec covered `moduleGuard` itself before this file.
 */
describe('moduleGuard', () => {
  const baseUser: User = {
    id: 'u1',
    email: 'a@b.c',
    firstName: 'A',
    lastName: 'B',
    fullName: 'A B',
    role: 'Accountant',
    roleDisplay: 'Propriétaire',
    tenantId: '00000000-0000-0000-0000-000000000001',
    companyName: 'Co',
    twoFactorEnabled: false,
    // Sector-provisioned BTP & Construction company: core modules + BTP's recommended set
    // (Purchases, Stock, Projects, Fiscal) — CRM deliberately absent (not in BTP's matrix).
    enabledModuleIds: [
      AppModule.Administration,
      AppModule.Clients,
      AppModule.Products,
      AppModule.Sales,
      AppModule.Treasury,
      AppModule.Reports,
      AppModule.Purchases,
      AppModule.Stock,
      AppModule.Projects,
      AppModule.Fiscal
    ]
  };

  function setUser(auth: AuthService, u: User | null): void {
    (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
  });

  it('redirects to /access-denied when the CRM module is not enabled for the user', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, baseUser);
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigate');

    const result = await TestBed.runInInjectionContext(() => moduleGuard({} as never, { url: '/crm' } as never));

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/access-denied'], { queryParams: { returnUrl: '/crm' } });
  });

  it('redirects to /access-denied for a nested CRM sub-route (e.g. /crm/leads)', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, baseUser);
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigate');

    const result = await TestBed.runInInjectionContext(() =>
      moduleGuard({} as never, { url: '/crm/leads' } as never)
    );

    expect(result).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/access-denied'], { queryParams: { returnUrl: '/crm/leads' } });
  });

  it('allows /crm once the CRM module AND the crm:read permission are granted', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...baseUser,
      enabledModuleIds: [...baseUser.enabledModuleIds!, AppModule.CRM],
      effectivePermissions: ['crm:read']
    });

    const result = await TestBed.runInInjectionContext(() => moduleGuard({} as never, { url: '/crm' } as never));

    expect(result).toBe(true);
  });

  it('allows /studio/approvals for a custom_records:read user without studio:design_entities', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...baseUser,
      enabledModuleIds: [...baseUser.enabledModuleIds!, AppModule.Studio],
      effectivePermissions: ['custom_records:read']
    });

    const result = await TestBed.runInInjectionContext(() =>
      moduleGuard({} as never, { url: '/studio/approvals' } as never)
    );

    expect(result).toBe(true);
  });

  it('never blocks /settings/profile regardless of module grants (own-profile carve-out)', async () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, baseUser);

    const result = await TestBed.runInInjectionContext(() =>
      moduleGuard({} as never, { url: '/settings/profile' } as never)
    );

    expect(result).toBe(true);
  });
});
