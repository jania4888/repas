import { formatNumber, getLocalePluralCase, Plural, registerLocaleData } from '@angular/common';
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

  it('keeps the Arabic plural function used by ICU plural and I18nPluralPipe', () => {
    const plural = getLocalePluralCase('ar-TN');
    expect(typeof plural).toBe('function');
    expect(plural(2)).toBe(Plural.Two);
    expect(plural(5)).toBe(Plural.Few);
    expect(plural(11)).toBe(Plural.Many);
    expect(getLocalePluralCase('fr-TN')(0)).toBe(Plural.One);
  });
});
