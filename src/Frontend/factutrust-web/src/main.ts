import { isDevMode } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeFrTNExtra from '@angular/common/locales/extra/fr-TN';
import localeArTN from '@angular/common/locales/ar-TN';
import localeArTNExtra from '@angular/common/locales/extra/ar-TN';
import { environment } from './environments/environment';
import { installDevConsoleNoiseFilter } from './app/core/utils/dev-console-noise-filter';
import { prepareBootLocale, resolveBootLocale } from './app/core/i18n/erp-boot-locale';
import { registerHybridArTnLocale } from './app/core/i18n/erp-ar-tn.locale';

if (isDevMode()) {
  installDevConsoleNoiseFilter();
}

registerLocaleData(localeFrTN, 'fr-TN', localeFrTNExtra);
registerHybridArTnLocale(localeArTN, localeArTNExtra);

const requestedBootLocale = resolveBootLocale(Boolean(environment.erp?.arabicEnabled));

void prepareBootLocale(requestedBootLocale)
  .then(() => import('./bootstrap').then(m => m.bootstrap()))
  .catch(err => {
    console.error('[boot] échec critique, repli FR', err);
    return import('./bootstrap').then(m => m.bootstrap());
  });
