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

/** Catégories CLDR acceptées dans un ICU plural (l'arabe les emploie toutes). */
const PLURAL_KEYS = /^(=\d+|zero|one|two|few|many|other)$/;

/**
 * Vérifie la syntaxe des ICU `{VAR, plural|select, clé {texte} …}` : accolades équilibrées,
 * clés de pluriel valides et cas `other` présent.
 * @returns {string|null} motif de rejet
 */
function icuProblem(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return 'icu-accolades';
  }
  if (depth !== 0) return 'icu-accolades';
  for (const m of text.matchAll(/\{VAR_[A-Z0-9_]+,\s*(plural|select)\s*,/g)) {
    let i = m.index + m[0].length;
    const keys = [];
    for (;;) {
      while (/\s/.test(text[i] ?? '')) i++;
      if (text[i] === '}' || i >= text.length) break;
      const start = i;
      while (i < text.length && !/[\s{]/.test(text[i])) i++;
      keys.push(text.slice(start, i));
      while (/\s/.test(text[i] ?? '')) i++;
      if (text[i] !== '{') return 'icu-syntaxe';
      let d = 0;
      do {
        if (text[i] === '{') d++;
        else if (text[i] === '}') d--;
        i++;
      } while (d > 0 && i < text.length);
    }
    if (!keys.includes('other')) return 'icu-other';
    if (m[1] === 'plural' && keys.some(k => !PLURAL_KEYS.test(k))) return 'icu-cle';
  }
  return null;
}

/** @returns {string|null} motif de rejet, ou null si la traduction est valide. */
export function validateTranslation(fr, ar) {
  const value = String(ar ?? '');
  if (!value.trim()) return 'vide';
  if (value.includes(FILLER)) return 'remplissage';
  if (BIDI_CONTROLS.test(value)) return 'bidi';
  // Dans un ICU, « }} » ferme un cas et « {{$X} » l'ouvre : seules les interpolations Angular sont du code.
  const isIcu = /\{VAR_[A-Z0-9_]+,\s*(plural|select)\s*,/.test(String(fr));
  if ((isIcu ? /\$\{|\{\{(?!\$)/ : /\$\{|\{\{|\}\}/).test(value)) return 'code';
  if (isIcu) {
    const problem = icuProblem(value);
    if (problem) return problem;
  }
  if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(value)) return 'html';
  if (multiset(fr, PLACEHOLDER) !== multiset(value, PLACEHOLDER)) return 'placeholders';
  if (multiset(fr, ICU_VAR) !== multiset(value, ICU_VAR)) return 'icu';
  return null;
}

/** Isole les valeurs interpolées (nombres, codes latins) dans le texte arabe. */
export function wrapIsolates(ar) {
  return String(ar).replace(PLACEHOLDER, (m, name) => (STRUCTURAL.test(name) ? m : `${FSI}${m}${PDI}`));
}
