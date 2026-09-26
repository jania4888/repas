import { inject, Injectable, LOCALE_ID } from '@angular/core';

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
