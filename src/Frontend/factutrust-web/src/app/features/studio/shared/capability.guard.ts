import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { StudioAiCapabilitiesService } from '../ai/studio-ai-capabilities.service';
import { StudioAiCapabilitiesDto } from '../ai/studio-ai.models';

/**
 * Garde de capacité runtime (`recordViewsEnabled`, `manyToManyEnabled`…) : attend la fin du
 * chargement du cache de capacités (`StudioAiCapabilitiesService`), déclenché ici avec
 * `ensureLoaded()`, puis autorise si `flag` est vrai. `unavailable` (erreur réseau, workbench
 * coupé…) retombe sur le repli `false` (V3/E3) ⇒ redirection, comme `flag=false`.
 */
export function capabilityGuard(
  flag: keyof StudioAiCapabilitiesDto,
  redirectTo: (route: ActivatedRouteSnapshot) => string
): CanActivateFn {
  return route => {
    const capabilities = inject(StudioAiCapabilitiesService);
    const router = inject(Router);

    capabilities.ensureLoaded();

    return toObservable(capabilities.state).pipe(
      filter(state => state !== 'unknown' && state !== 'loading'),
      take(1),
      map(() => (capabilities.capabilities()[flag] === true ? true : router.parseUrl(redirectTo(route))))
    );
  };
}
