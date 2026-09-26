import { formatNumber, registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeFrTNExtra from '@angular/common/locales/extra/fr-TN';
import localeArTN from '@angular/common/locales/ar-TN';
import localeArTNExtra from '@angular/common/locales/extra/ar-TN';
import { registerHybridArTnLocale } from './erp-ar-tn.locale';

describe('erp-ar-tn hybrid locale', () => {
  beforeAll(() => {
    registerLocaleData(localeFrTN, 'fr-TN', localeFrTNExtra);
    registerHybridArTnLocale(localeArTN, localeArTNExtra);
  });

  it('formatNumber matches fr-TN for TND amounts', () => {
    const n = 1234.5;
    const fr = formatNumber(n, 'fr-TN', '1.3-3');
    const ar = formatNumber(n, 'ar-TN', '1.3-3');
    expect(ar).toBe(fr);
  });

  it('uses Arabic plural rules for count 2', () => {
    const rules = new Intl.PluralRules('ar-TN');
    expect(rules.select(2)).toBe('two');
  });
});
