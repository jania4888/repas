import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Administrateur ou Superviseur d'une société, hors cabinet et hors mode délégué. */
export const companyAssistanceGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const allowed =
    auth.isAuthenticated() &&
    auth.canAccessPlatformSettings() &&
    !auth.isAccountingFirm() &&
    !auth.isDelegatedMode() &&
    !auth.isClientPortal();
  return allowed || router.createUrlTree(['/dashboard']);
};
