import { inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { StudioWorkflowsService } from '../workflows/studio-workflows.service';

/**
 * Garde d'accès à `/studio/approvals` (4.4g1, D7) : sonde `countMyApprovals()`
 * avant d'ouvrir la page. 404 ⇒ le module workflows est coupé côté serveur
 * (fail-closed) ⇒ repli `/dashboard` (4.5d1 : `/studio` exige `studio:design_entities`,
 * un lecteur y serait renvoyé vers `/access-denied`) ; 403 ⇒ droit absent ⇒ `/access-denied` avec
 * `returnUrl` (D11). En cas de panne réseau ou de timeout, la garde laisse
 * passer : la page affiche alors son propre état d'erreur (D-44-52) au lieu
 * d'un « accès refusé » trompeur.
 * S'ajoute APRÈS `permissionGuard` sur la route (déclarée en 4.4g2).
 */
export const approvalsAccessGuard: CanActivateFn = (route, state) => {
  const workflows = inject(StudioWorkflowsService);
  const router = inject(Router);
  return workflows.countMyApprovals().pipe(
    timeout(5_000),
    map(() => true),
    catchError((err: unknown) => {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status === 404) return of(router.createUrlTree(['/dashboard'])); // module coupé (fail-closed serveur)
      if (status === 403) return of(router.createUrlTree(['/access-denied'], { queryParams: { returnUrl: state.url } }));
      return of(true); // panne / timeout : la page affiche son propre état d'erreur
    })
  );
};
