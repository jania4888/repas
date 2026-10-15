/// <reference types="@angular/localize" />
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { ToastService } from '@core/services/toast.service';
import { DeskLeaveRegistry } from '@core/desk/desk-leave.registry';

function stripPath(url: string): string {
  let path = url.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

function isFirmOpenClientRoute(path: string): boolean {
  return /^\/firm\/open\/[^/]+$/.test(path);
}

export const accountingFirmsFeatureGuard: CanActivateFn = () => {
  if (environment.accountingFirmsEnabled) {
    return true;
  }
  return inject(Router).createUrlTree(['/auth/login']);
};

export const firmNativeGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const firmContext = inject(FirmContextService);
  const toast = inject(ToastService);
  const deskLeave = inject(DeskLeaveRegistry);

  if (!environment.accountingFirmsEnabled) {
    return router.createUrlTree(['/dashboard']);
  }
  if (!auth.isAccountingFirm()) {
    return router.createUrlTree(['/dashboard']);
  }

  const path = stripPath(state.url);
  if (auth.isDelegatedMode() && !isFirmOpenClientRoute(path)) {
    const cleared = await firmContext.clearContext();
    if (!cleared) {
      if (!deskLeave.wasCancelled()) {
        toast.add({
          severity: 'error',
          summary: $localize`:@@accounting-firms.guard.summary.Erreur:Erreur`,
          detail: $localize`:@@accounting-firms.guard.detail.Impossible_de_qu:Impossible de quitter le dossier client. Veuillez réessayer.`
        });
      }
      return false;
    }
  }

  return true;
};
