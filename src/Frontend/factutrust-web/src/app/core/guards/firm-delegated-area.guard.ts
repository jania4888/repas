import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { resolveFirmAreaRedirect } from '@core/config/firm-area-access';
import { AuthService } from '@core/services/auth.service';

/**
 * Tient l'invariant « zone <-> mode » au niveau de la route.
 *
 * Placé AVANT `firmNativeGuard` sur le wrapper `/firm` : en mode délégué il renvoie l'utilisateur
 * dans son dossier, si bien que la branche de nettoyage de `firmNativeGuard` (qui faisait de
 * l'URL cabinet une sortie implicite du dossier) n'est plus atteinte. Elle reste en place comme
 * filet pour les appelants qui nettoient volontairement le contexte avant de naviguer.
 */
export const firmDelegatedAreaGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const target = resolveFirmAreaRedirect(state.url, {
    isAccountingFirm: auth.isAccountingFirm(),
    isDelegated: auth.isDelegatedMode()
  });

  return target ? router.createUrlTree([target]) : true;
};
