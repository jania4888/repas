import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '@environments/environment';

export const publicRegistrationGuard =
  (kind: 'company' | 'firm'): CanActivateFn =>
  () => {
    const router = inject(Router);
    const flags = environment.publicRegistration;
    const enabled = kind === 'company' ? flags.companyEnabled : flags.firmEnabled;
    if (enabled) {
      return true;
    }
    return router.createUrlTree(['/auth/login'], { queryParams: { registration: 'closed' } });
  };
