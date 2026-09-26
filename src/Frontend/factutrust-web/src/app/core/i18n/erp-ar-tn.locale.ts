import { registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeArTN from '@angular/common/locales/ar-TN';

type LocaleArray = readonly unknown[];

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
  if (ar[3] !== undefined) fr[3] = cloneLocaleData(ar[3] as LocaleArray);
  if (ar[5] !== undefined) fr[5] = cloneLocaleData(ar[5] as LocaleArray);
  if (ar[7] !== undefined) fr[7] = cloneLocaleData(ar[7] as LocaleArray);
  if (ar[9] !== undefined) fr[9] = cloneLocaleData(ar[9] as LocaleArray);
  fr[19] = 'rtl';
  registerLocaleData(fr as Parameters<typeof registerLocaleData>[0], 'ar-TN', extraArTn);
}
