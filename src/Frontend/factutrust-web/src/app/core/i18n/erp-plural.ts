import { erpBootEffectiveLocale } from './erp-boot-locale';

/** Plural labels keyed by CLDR category (see Intl.PluralRules). */
export type ErpPluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

const COUNT_PLACEHOLDER = /\{count\}|\{n\}/g;

/**
 * Picks the localized plural form for `count` using Intl.PluralRules.
 * Pass `$localize`-backed strings per category; French source strings stay unchanged in templates.
 */
export function erpPlural(count: number, forms: ErpPluralForms, locale = 'fr'): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = forms[category] ?? forms.other;
  return template.replace(COUNT_PLACEHOLDER, String(count));
}

/** Locale CLDR de la session : ar-TN quand le catalogue arabe est chargé, sinon fr-TN. */
export function erpPluralLocale(): string {
  return erpBootEffectiveLocale === 'ar' ? 'ar-TN' : 'fr-TN';
}
