import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { capabilityGuard } from './capability.guard';
import { STUDIO_AI_CAPABILITIES_FALLBACK } from '../ai/studio-ai.models';
import { StudioAiCapabilitiesService } from '../ai/studio-ai-capabilities.service';

describe('capabilityGuard', () => {
  let http: HttpTestingController;
  let router: Router;

  const capabilitiesUrl = `${environment.apiUrl}/ai/studio/capabilities`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  function activate(flag: 'recordViewsEnabled' | 'manyToManyEnabled' | 'workflowsEnabled', redirectTo: () => string): Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      capabilityGuard(flag, redirectTo)({ paramMap: { get: () => 'interventions' } } as never, {} as never)
    ) as Observable<boolean | UrlTree>;
  }

  it('autorise quand la capacité est vraie', async () => {
    const result$ = activate('recordViewsEnabled', () => '/studio/d/interventions');
    const promise = firstValueFrom(result$);
    http.expectOne(capabilitiesUrl).flush({
      success: true,
      data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, recordViewsEnabled: true },
      message: null,
      errors: []
    });
    expect(await promise).toBe(true);
  });

  it('redirige vers redirectTo quand la capacité est fausse', async () => {
    const result$ = activate('recordViewsEnabled', () => '/studio/d/interventions');
    const promise = firstValueFrom(result$);
    http.expectOne(capabilitiesUrl).flush({
      success: true,
      data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, recordViewsEnabled: false },
      message: null,
      errors: []
    });
    const result = await promise;
    expect(result).not.toBe(true);
    expect((result as UrlTree).toString()).toBe(router.parseUrl('/studio/d/interventions').toString());
  });

  it('redirige quand la capacité est indisponible (unavailable, V3/E3)', async () => {
    const result$ = activate('manyToManyEnabled', () => '/studio');
    const promise = firstValueFrom(result$);
    http.expectOne(capabilitiesUrl).flush('erreur', { status: 500, statusText: 'Server Error' });
    const result = await promise;
    expect(result).not.toBe(true);
    expect((result as UrlTree).toString()).toBe(router.parseUrl('/studio').toString());
  });

  it('redirige vers /studio quand workflowsEnabled est faux et laisse passer quand vrai', async () => {
    const deniedPromise = firstValueFrom(activate('workflowsEnabled', () => '/studio'));
    http.expectOne(capabilitiesUrl).flush({
      success: true,
      data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, workflowsEnabled: false },
      message: null,
      errors: []
    });
    const denied = await deniedPromise;
    expect(denied).not.toBe(true);
    expect((denied as UrlTree).toString()).toBe(router.parseUrl('/studio').toString());

    // Le service met les capacités en cache : `reset()` force une nouvelle lecture.
    TestBed.inject(StudioAiCapabilitiesService).reset();
    const allowedPromise = firstValueFrom(activate('workflowsEnabled', () => '/studio'));
    http.expectOne(capabilitiesUrl).flush({
      success: true,
      data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, workflowsEnabled: true },
      message: null,
      errors: []
    });
    expect(await allowedPromise).toBe(true);
  });
});
