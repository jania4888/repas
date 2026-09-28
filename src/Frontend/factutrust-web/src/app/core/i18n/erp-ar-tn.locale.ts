import { registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeArTN from '@angular/common/locales/ar-TN';

type LocaleArray = readonly unknown[];

/** Position de la fonction de pluriel dans les données de locale Angular (LocaleDataIndex.PluralCase). */
const PLURAL_CASE_INDEX = 20;

function cloneLocaleData(data: LocaleArray): unknown[] {
  return JSON.parse(JSON.stringify(data)) as unknown[];
}

/**
 * Locale hybride ar-TN : séparateurs et formats numériques comme fr-TN ;
 * jours, mois, ères et direction comme ar-TN (pluriel arabe via extra).
 */
export function registerHybridArTnLocale(
  _baseArTn: Parameters<typeof registerLocaleData>[0],
  extraArTn: Parameters<typeof registerLocaleData>[2]
): void {
  const fr = cloneLocaleData(localeFrTN as LocaleArray);
  const ar = localeArTN as LocaleArray;
  fr[0] = 'ar-TN';
  // Périodes du jour (1-2), jours et mois en forme de format ET autonome (3-6), ères (7), week-end (9)
  // et gabarit date + heure (12 : l'arabe n'a pas le « à » de « {1} 'à' {0} »).
  for (const index of [1, 2, 3, 4, 5, 6, 7, 9, 12]) {
    if (ar[index] !== undefined) fr[index] = cloneLocaleData(ar[index] as LocaleArray);
  }
  fr[19] = 'rtl';
  // La fonction de pluriel ne survit pas au clonage JSON (elle deviendrait null et ferait
  // planter les ICU `plural` et I18nPluralPipe) : on reprend celle de l'arabe, par référence.
  fr[PLURAL_CASE_INDEX] = ar[PLURAL_CASE_INDEX];
  registerLocaleData(fr as Parameters<typeof registerLocaleData>[0], 'ar-TN', extraArTn);
}
