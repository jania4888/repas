import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '@environments/environment';
import { ErpLocaleService } from '../i18n/erp-locale.service';

/** En-tête dédié InstaFact : n'utilise pas Accept-Language (évite les clients FR avec navigateur arabe). */
export const ERP_UI_LOCALE_HEADER = 'X-UI-Locale';

/** Envoie X-UI-Locale: ar sur les appels API ERP lorsque l'interface est en arabe. */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  const isOurApi = req.url.startsWith(environment.apiUrl) || req.url.startsWith('/api');
  if (!isOurApi) {
    return next(req);
  }
  const erpLocale = inject(ErpLocaleService);
  if (erpLocale.effectiveLocale() !== 'ar') {
    return next(req);
  }
  return next(
    req.clone({
      setHeaders: {
        [ERP_UI_LOCALE_HEADER]: 'ar'
      }
    })
  );
};
