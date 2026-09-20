import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { approvalsAccessGuard } from './approvals-access.guard';

describe('approvalsAccessGuard', () => {
  let http: HttpTestingController;
  let router: Router;

  const COUNT_URL = `${environment.apiUrl}/studio/workflows/approvals/mine/count`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function activate(url = '/studio/approvals'): Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      approvalsAccessGuard({} as never, { url } as never)
    ) as Observable<boolean | UrlTree>;
  }

  it('laisse passer quand la sonde répond 200', async () => {
    const promise = firstValueFrom(activate());
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 2 }, message: null, error: null });
    expect(await promise).toBe(true);
  });

  it('redirige vers /dashboard quand la sonde répond 404 (module coupé)', async () => {
    const promise = firstValueFrom(activate());
    http.expectOne(COUNT_URL).flush('introuvable', { status: 404, statusText: 'Not Found' });
    const result = await promise;
    expect(result).not.toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('redirige vers /access-denied avec returnUrl sur un 403', async () => {
    const promise = firstValueFrom(activate());
    http.expectOne(COUNT_URL).flush('interdit', { status: 403, statusText: 'Forbidden' });
    const result = await promise;
    expect(result).not.toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe(
      router.serializeUrl(router.createUrlTree(['/access-denied'], { queryParams: { returnUrl: '/studio/approvals' } }))
    );
  });
});
