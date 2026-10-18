import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FIRM_NATIVE_HOME_ROUTE } from '@core/config/firm-area-access';
import { AuthService } from '@core/services/auth.service';

/**
 * Seconde ligne de défense pour `/accounting/dashboard` : l'écran n'a de sens qu'ouvert sur un
 * dossier client délégué par un cabinet. Les guards du layout parent (`app.routes.ts`) renvoient
 * déjà un cabinet natif vers `/firm/dashboard` et une société vers `/access-denied` avant d'y
 * parvenir ; ce garde reste une vérification testable unitairement, sans boucle possible (aucune
 * de ses cibles ne renvoie vers `/accounting/dashboard`).
 */
export const firmDelegatedOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAccountingFirm() && auth.isDelegatedMode()) {
    return true;
  }

  return router.createUrlTree([auth.isAccountingFirm() ? FIRM_NATIVE_HOME_ROUTE : '/accounting']);
};
