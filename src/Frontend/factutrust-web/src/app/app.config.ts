import { APP_INITIALIZER, ApplicationConfig, LOCALE_ID, importProvidersFrom, DOCUMENT } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { PrimeNG } from 'primeng/config';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { MarkdownModule } from 'ngx-markdown';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { localeInterceptor } from './core/interceptors/locale.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { environment } from '../environments/environment';
import { erpBootEffectiveLocale } from './core/i18n/erp-boot-locale';
import { AuthService } from './core/services/auth.service';
import { ErpLocaleService } from './core/i18n/erp-locale.service';
import { PRIMENG_AR_TRANSLATION } from './core/i18n/primeng-ar.translations';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: DOCUMENT, useFactory: () => document },
    {
      provide: LOCALE_ID,
      useFactory: () =>
        !environment.erp?.arabicEnabled || erpBootEffectiveLocale !== 'ar' ? 'fr-TN' : 'ar-TN'
    },
    provideRouter(routes, withViewTransitions()),
    provideHttpClient(
      withFetch(),
      withInterceptors([localeInterceptor, authInterceptor, errorInterceptor])
    ),
    provideAnimations(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.dark-mode'
        }
      }
    }),
    importProvidersFrom(MarkdownModule.forRoot()),
    MessageService,
    {
      provide: APP_INITIALIZER,
      useFactory: (auth: AuthService, locale: ErpLocaleService, prime: PrimeNG) => async () => {
        await auth.bootstrapRefresh();
        const user = auth.user();
        locale.resolve({
          userPreferredLanguage: user?.preferredLanguage ?? null
        });
        if (locale.effectiveLocale() === 'ar') {
          prime.setTranslation(PRIMENG_AR_TRANSLATION);
        }
      },
      deps: [AuthService, ErpLocaleService, PrimeNG],
      multi: true
    }
  ]
};
