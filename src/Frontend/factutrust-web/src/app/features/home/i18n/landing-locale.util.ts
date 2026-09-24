import type { LandingLocale } from '../content/landing-copy.types';

/** Segment de préfixe de la landing AR (`/ar`, `/ar/cabinets-comptables`). */
export const LANDING_PREFIX: Record<LandingLocale, string> = { fr: '', ar: '/ar' };
export const CABINETS_SEGMENT = 'cabinets-comptables';

/** Retire query et fragment : `'/x?y=1#z'` → `'/x'`. */
export function pathOnly(url: string): string {
  return url.split(/[?#]/)[0] ?? '';
}

/**
 * `'/ar/cabinets-comptables'` → `{ locale: 'ar', rest: '/cabinets-comptables' }` ;
 * `'/ar'` → `{ 'ar', '/' }` ; `'/arbre'` → `{ 'fr', '/arbre' }` (le préfixe n'est reconnu que comme segment entier).
 */
export function stripLocalePrefix(url: string): { locale: LandingLocale; rest: string } {
  let path = pathOnly(url);
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (path === '/ar' || path.startsWith('/ar/')) {
    const rest = path.slice('/ar'.length);
    return { locale: 'ar', rest: rest === '' ? '/' : rest };
  }
  return { locale: 'fr', rest: path === '' ? '/' : path };
}

/** `'/'`+`'ar'` → `'/ar'` ; `'/ar'`+`'fr'` → `'/'` ; `'/cabinets-comptables?x=1#c'`+`'ar'` → `'/ar/cabinets-comptables'`. */
export function localizedPath(path: string, locale: LandingLocale): string {
  const { rest } = stripLocalePrefix(path);
  const prefix = LANDING_PREFIX[locale];
  if (rest === '/') {
    return prefix === '' ? '/' : prefix;
  }
  return `${prefix}${rest}`;
}

/** Vrai pour `/`, `/ar` (avec ou sans query/fragment). */
export function isLandingHome(url: string): boolean {
  return stripLocalePrefix(url).rest === '/';
}

/** Vrai pour `/cabinets-comptables`, `/ar/cabinets-comptables`. */
export function isLandingCabinets(url: string): boolean {
  return stripLocalePrefix(url).rest === `/${CABINETS_SEGMENT}`;
}

export function homePath(locale: LandingLocale): string {
  return localizedPath('/', locale);
}

export function cabinetsPath(locale: LandingLocale): string {
  return localizedPath(`/${CABINETS_SEGMENT}`, locale);
}

/** Locale déduite de l'URL courante (préfixe `/ar` ou non). */
export function localeFromUrl(url: string): LandingLocale {
  return stripLocalePrefix(url).locale;
}
