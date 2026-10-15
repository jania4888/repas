import { APP_INITIALIZER, ApplicationConfig, LOCALE_ID, importProvidersFrom, DOCUMENT, inject } from '@angular/core';
import { RouteReuseStrategy, provideRouter, withViewTransitions } from '@angular/router';
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
import { DeskRouteReuseStrategy } from './core/desk/desk-route-reuse.strategy';
import { DeskWindowService } from './core/desk/desk-window.service';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: DOCUMENT, useFactory: () => document },
    {
      provide: LOCALE_ID,
      useFactory: () =>
        !environment.erp?.arabicEnabled || erpBootEffectiveLocale !== 'ar' ? 'fr-TN' : 'ar-TN'
    },
    provideRouter(
      routes,
      withViewTransitions({
        onViewTransitionCreated: ({ transition }) => {
          const auth = inject(AuthService);
          if (auth.isAccountingFirm() && auth.isDelegatedMode()) {
            transition.skipTransition();
          }
        }
      })
    ),
    { provide: RouteReuseStrategy, useClass: DeskRouteReuseStrategy },
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
      useFactory: (auth: AuthService, locale: ErpLocaleService, prime: PrimeNG, desk: DeskWindowService) => async () => {
        await auth.bootstrapRefresh();
        desk.syncMode();
        const user = auth.user();
        locale.resolve({
          userPreferredLanguage: user?.preferredLanguage ?? null
        });
        if (locale.effectiveLocale() === 'ar') {
          prime.setTranslation(PRIMENG_AR_TRANSLATION);
        }
      },
      deps: [AuthService, ErpLocaleService, PrimeNG, DeskWindowService],
      multi: true
    }
  ]
};
