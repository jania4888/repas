/**
 * Règles de validité d'une traduction arabe par rapport à sa source française (format runtime
 * `$localize` : placeholders `{$NOM}`). Une traduction invalide est écartée du catalogue : l'ID
 * retombe alors sur le français, avec les bonnes substitutions.
 */

const FILLER = 'مسمّى';
const FSI = '⁨';
const PDI = '⁩';
/** Marques et isolats bidi : jamais dans une source ; FSI/PDI sont ajoutés par le build. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩؜]/;
const PLACEHOLDER = /\{\$([^}]+)\}/g;
const ICU_VAR = /\{(VAR_[A-Z0-9_]+),\s*(plural|select)\s*,/g;
/** Placeholders de balises, blocs et ICU : pas d'isolat autour (ils délimitent des éléments). */
const STRUCTURAL = /^(START_|CLOSE_|TAG_|ICU|LINE_BREAK|HORIZONTAL_RULE|IMAGE)/;

const multiset = (text, re) =>
  [...String(text).matchAll(re)]
    .map(m => m.slice(1).join(':'))
    .sort()
    .join('|');

export function stripIsolates(text) {
  return String(text).replace(/[⁨⁩]/g, '');
}

/** @returns {string|null} motif de rejet, ou null si la traduction est valide. */
export function validateTranslation(fr, ar) {
  const value = String(ar ?? '');
  if (!value.trim()) return 'vide';
  if (value.includes(FILLER)) return 'remplissage';
  if (BIDI_CONTROLS.test(value)) return 'bidi';
  if (/\$\{|\{\{|\}\}/.test(value)) return 'code';
  if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(value)) return 'html';
  if (multiset(fr, PLACEHOLDER) !== multiset(value, PLACEHOLDER)) return 'placeholders';
  if (multiset(fr, ICU_VAR) !== multiset(value, ICU_VAR)) return 'icu';
  return null;
}

/** Isole les valeurs interpolées (nombres, codes latins) dans le texte arabe. */
export function wrapIsolates(ar) {
  return String(ar).replace(PLACEHOLDER, (m, name) => (STRUCTURAL.test(name) ? m : `${FSI}${m}${PDI}`));
}
