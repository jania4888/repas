#!/usr/bin/env node
/**
 * Codemod RTL : remplace le CSS directionnel physique par ses équivalents logiques dans les styles
 * de l'ERP société (SCSS/CSS des composants, `styles:` en ligne des composants, styles globaux).
 *
 * En français (LTR, écriture horizontale), une propriété logique a exactement la même valeur
 * calculée que la physique qu'elle remplace : le rendu FR est inchangé par construction. En arabe
 * (`dir="rtl"`), elle se retourne toute seule — sans surcharge globale, qu'un style de composant
 * encapsulé l'emporterait de toute façon.
 *
 *  margin/padding/border-left|right      → *-inline-start|end
 *  border-{top|bottom}-{left|right}-radius → border-{start|end}-{start|end}-radius
 *  left / right                          → inset-inline-start / end (sauf centrage à 50 %)
 *  text-align: left / right              → start / end
 *  margin/padding/inset a b c d (b ≠ d)  → *-block: a c; *-inline: d b
 *  border-radius asymétrique             → border-{start|end}-{start|end}-radius
 *
 * Laissés tels quels : centrage `left: 50%` (identique dans les deux sens). Signalés : float/clear,
 * raccourcis asymétriques non décomposables (expressions SCSS), `border-width`/`-color` asymétriques.
 * Une ligne marquée `rtl-ok` n'est jamais touchée (positionnement calculé en JS, graphique…).
 *
 * Usage : node scripts/i18n/rtl/logicalize-css.mjs [--dry-run] [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const LONGHANDS = [
  ['border-top-left-radius', 'border-start-start-radius'],
  ['border-top-right-radius', 'border-start-end-radius'],
  ['border-bottom-left-radius', 'border-end-start-radius'],
  ['border-bottom-right-radius', 'border-end-end-radius'],
  ['border-left-width', 'border-inline-start-width'],
  ['border-right-width', 'border-inline-end-width'],
  ['border-left-color', 'border-inline-start-color'],
  ['border-right-color', 'border-inline-end-color'],
  ['border-left-style', 'border-inline-start-style'],
  ['border-right-style', 'border-inline-end-style'],
  ['border-left', 'border-inline-start'],
  ['border-right', 'border-inline-end'],
  ['margin-left', 'margin-inline-start'],
  ['margin-right', 'margin-inline-end'],
  ['padding-left', 'padding-inline-start'],
  ['padding-right', 'padding-inline-end']
];
const LONGHAND = new Map(LONGHANDS);

/** Début de déclaration : début de ligne, blanc, `{` ou `;` (jamais `$var`, `--custom`, `.left:`). */
const DECL = /(^|[\s{;])([a-z-]+)(\s*:\s*)([^;{}\n]*)/g;

/** Découpe une valeur en jetons de premier niveau (les parenthèses de calc()/var() restent entières). */
function tokens(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const SCSS_EXPR = /[$#]|\s[*+/]\s|\s-\s/;
/** Valeur sans le contenu des parenthèses (`calc(a * -1)` n'est pas une expression SCSS). */
const outsideParens = value => {
  let depth = 0;
  let out = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
};

/**
 * @returns {{ out: string, changes: number, manual: { line: number, text: string, why: string }[] }}
 */
export function logicalizeCss(css) {
  const manual = [];
  let changes = 0;
  const lines = css.split('\n');
  const out = lines.map((line, i) => {
    if (/rtl-ok/.test(line)) return line;
    return line.replace(DECL, (all, pre, prop, colon, rawValue) => {
      const important = /!important\s*$/.test(rawValue) ? ' !important' : '';
      const value = rawValue.replace(/\s*!important\s*$/, '');
      const note = why => {
        manual.push({ line: i + 1, text: line.trim().slice(0, 120), why });
        return all;
      };
      if (LONGHAND.has(prop)) {
        changes++;
        return pre + LONGHAND.get(prop) + colon + rawValue;
      }
      if (prop === 'left' || prop === 'right') {
        // Centrage (`left: 50%` + translateX(-50%)) : identique dans les deux sens.
        if (/50%/.test(value)) return all;
        changes++;
        return pre + (prop === 'left' ? 'inset-inline-start' : 'inset-inline-end') + colon + rawValue;
      }
      if (prop === 'text-align' && /^(left|right)$/.test(value.trim())) {
        changes++;
        return pre + prop + colon + (value.trim() === 'left' ? 'start' : 'end') + important;
      }
      if ((prop === 'float' || prop === 'clear') && /^(left|right)$/.test(value.trim())) return note(prop);
      if (prop === 'margin' || prop === 'padding' || prop === 'inset') {
        const t = tokens(value);
        // Expression SCSS (`$gap * 2`) : impossible de savoir quels jetons font gauche et droite.
        if (SCSS_EXPR.test(outsideParens(value)) && t.length > 3) return note(`${prop} asymétrique (expression)`);
        if (t.length !== 4 || t[1] === t[3]) return all;
        changes++;
        const block = t[0] === t[2] ? t[0] : `${t[0]} ${t[2]}`;
        const inline = t[3] === t[1] ? t[3] : `${t[3]} ${t[1]}`;
        return `${pre}${prop}-block${colon}${block}${important}; ${prop}-inline${colon}${inline}${important}`;
      }
      if (prop === 'border-radius' && !value.includes('/') && !SCSS_EXPR.test(outsideParens(value))) {
        // Coins : haut-gauche, haut-droit, bas-droit, bas-gauche (valeurs 1 à 4).
        const t = tokens(value);
        const [tl, tr = tl, br = tl, bl = tr] = t;
        if (t.length < 2 || t.length > 4 || (tl === tr && br === bl)) return all;
        changes++;
        return (
          `${pre}border-start-start-radius${colon}${tl}${important}; border-start-end-radius${colon}${tr}${important}; ` +
          `border-end-end-radius${colon}${br}${important}; border-end-start-radius${colon}${bl}${important}`
        );
      }
      if (/^border-(radius|width|color|style)$/.test(prop)) {
        const t = tokens(value.split('/')[0]);
        const asym = prop === 'border-radius' ? t.length >= 2 && (t[0] !== t[1] || (t[2] ?? t[0]) !== (t[3] ?? t[1])) : t.length === 4 && t[1] !== t[3];
        if (asym) return note(`${prop} asymétrique`);
      }
      return all;
    });
  });
  return { out: out.join('\n'), changes, manual };
}

/** Styles en ligne d'un composant : contenu des gabarits de `styles: [`…`]` ou `styles: `…``. */
export function logicalizeComponentStyles(ts) {
  let changes = 0;
  const manual = [];
  const out = ts.replace(/(styles\s*:\s*\[?\s*)`([^`]*)`/g, (all, head, body) => {
    if (body.includes('${')) return all;
    const offset = ts.slice(0, ts.indexOf(all)).split('\n').length - 1;
    const r = logicalizeCss(body);
    changes += r.changes;
    manual.push(...r.manual.map(m => ({ ...m, line: m.line + offset })));
    return head + '`' + r.out + '`';
  });
  return { out, changes, manual };
}

/** Fichiers de l'ERP société (les espaces forcés en français sont hors périmètre). */
export const OUT_OF_SCOPE = /src\/app\/features\/(firm|portal|platform|home|legal|virtual-street)\//;

export function listStyleFiles() {
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(WEB, p).replace(/\\/g, '/'));
    }
  };
  walk(path.join(WEB, 'src/app'));
  walk(path.join(WEB, 'src/styles'));
  files.push('src/styles.scss', 'src/pluto-menu-theme.scss');
  return files.filter(
    f =>
      !OUT_OF_SCOPE.test(f) &&
      !/\/rtl\//.test(f) &&
      (/\.s?css$/.test(f) || (/\.ts$/.test(f) && !/\.spec\.ts$/.test(f)))
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const check = process.argv.includes('--check');
  let total = 0;
  let files = 0;
  const manual = [];
  const pending = [];
  for (const rel of listStyleFiles()) {
    const abs = path.join(WEB, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const r = rel.endsWith('.ts') ? logicalizeComponentStyles(text) : logicalizeCss(text);
    manual.push(...r.manual.map(m => `${rel}:${m.line} [${m.why}] ${m.text}`));
    if (!r.changes) continue;
    files++;
    total += r.changes;
    pending.push(rel);
    if (!dryRun && !check) fs.writeFileSync(abs, r.out, 'utf8');
  }
  if (check) {
    if (pending.length) {
      console.error(`[rtl:logical] ${total} déclaration(s) physique(s) dans ${files} fichier(s) :`);
      for (const f of pending) console.error(`  ${f}`);
      console.error('  → npm run i18n:rtl:logical (ou marquer la ligne « rtl-ok » si le physique est voulu)');
      process.exit(1);
    }
    console.log('[rtl:logical] 0 déclaration physique convertible');
    return;
  }
  for (const m of manual) console.warn(`  [à la main] ${m}`);
  console.log(`[rtl:logical] ${total} déclaration(s) dans ${files} fichier(s)${dryRun ? ' — simulation' : ''} ; ${manual.length} à la main`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
