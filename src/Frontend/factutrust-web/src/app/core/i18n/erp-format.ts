import { inject, Injectable, LOCALE_ID } from '@angular/core';
import { erpBootEffectiveLocale } from './erp-boot-locale';

/**
 * Locale Intl des dates écrites en toutes lettres (mois, jour de semaine) : la locale française
 * d'origine en français (rendu inchangé), `ar-TN` en arabe (mois tunisiens, chiffres latins).
 * Réservé aux formats textuels : une date purement numérique reste au format français.
 */
export function erpDateLocale(frLocale = 'fr-FR'): string {
  return erpBootEffectiveLocale === 'ar' ? 'ar-TN' : frLocale;
}

const collatorCache = new Map<string, Intl.Collator>();

function collatorForLang(lang: 'fr' | 'ar'): Intl.Collator {
  const key = lang;
  let c = collatorCache.get(key);
  if (!c) {
    c = lang === 'ar' ? new Intl.Collator('ar') : new Intl.Collator('fr');
    collatorCache.set(key, c);
  }
  return c;
}

/** Tri / recherche selon la locale document (ar ou fr). */
export function erpCollatorCompare(a: string, b: string): number {
  const lang =
    typeof document !== 'undefined' ? document.documentElement.getAttribute('lang') ?? 'fr' : 'fr';
  const collator = lang.startsWith('ar') ? collatorForLang('ar') : collatorForLang('fr');
  return collator.compare(a, b);
}

/** Formats d'affichage UI (dates texte, mois, temps relatif) selon la locale active. */
@Injectable({ providedIn: 'root' })
export class ErpFormatService {
  private readonly localeId = inject(LOCALE_ID);

  collator(): Intl.Collator {
    return this.localeId.startsWith('ar') ? collatorForLang('ar') : collatorForLang('fr');
  }

  monthNames(): string[] {
    const fmt = new Intl.DateTimeFormat(this.localeId, { month: 'long' });
    return Array.from({ length: 12 }, (_, i) =>
      fmt.format(new Date(2020, i, 15))
    );
  }

  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return new Intl.RelativeTimeFormat(this.localeId, { numeric: 'auto' }).format(value, unit);
  }
}
