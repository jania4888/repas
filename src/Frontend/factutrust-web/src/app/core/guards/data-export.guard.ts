import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { canExportBusinessData } from '@core/data-export/data-export.catalog';

export const dataExportGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (canExportBusinessData(auth)) {
    return true;
  }
  const q = state.url.indexOf('?');
  const returnUrl = q >= 0 ? state.url.slice(0, q) : state.url;
  return router.createUrlTree(['/access-denied'], { queryParams: { returnUrl } });
};
