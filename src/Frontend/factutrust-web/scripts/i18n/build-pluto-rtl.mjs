#!/usr/bin/env node
/**
 * Génère src/styles/rtl/pluto-rtl.generated.css : surcharges RTL (préfixe [dir='rtl']) des feuilles
 * globales du thème Pluto / Bootstrap 4 chargées par angular.json. Ces fichiers tiers ne sont jamais
 * modifiés ; la surcharge n'est chargée qu'en arabe (bundle erp-rtl, injecté par ErpLocaleService).
 *
 * Pour chaque règle qui porte du CSS directionnel, une règle miroir est émise :
 *  - côtés gauche/droit échangés (marges, retraits, bordures, positions, coins arrondis) ; un côté
 *    laissé vide est remis à sa valeur initiale ;
 *  - text-align / float / clear / background-position : left ↔ right ;
 *  - raccourcis à 4 valeurs asymétriques : 2e et 4e valeurs échangées.
 * Le centrage `left: 50%` (avec translateX(-50%)) est identique dans les deux sens : ignoré.
 *
 * Usage : node scripts/i18n/build-pluto-rtl.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
/** Même ordre que « styles » dans angular.json (la cascade des surcharges le suit). */
const SOURCES = [
  'src/assets/theme/pluto/css/bootstrap.min.css',
  'src/assets/theme/pluto/style.css',
  'src/assets/theme/pluto/css/custom.css',
  'src/assets/theme/pluto/css/responsive.css'
];
const OUT = path.join(WEB, 'src/styles/rtl/pluto-rtl.generated.css');

const SIDE_PAIRS = [
  ['margin-left', 'margin-right'],
  ['padding-left', 'padding-right'],
  ['left', 'right'],
  ['border-left', 'border-right'],
  ['border-left-width', 'border-right-width'],
  ['border-left-color', 'border-right-color'],
  ['border-left-style', 'border-right-style'],
  ['border-top-left-radius', 'border-top-right-radius'],
  ['border-bottom-left-radius', 'border-bottom-right-radius']
];
const MIRROR = new Map(SIDE_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));

function initialValue(prop) {
  if (prop === 'left' || prop === 'right') return 'auto';
  if (/-color$/.test(prop)) return 'currentcolor';
  if (/-style$/.test(prop)) return 'none';
  return '0';
}

const flipKeyword = v => v.replace(/\b(left|right)\b/g, k => (k === 'left' ? 'right' : 'left'));

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

/**
 * Déclarations miroir d'une règle (tableau vide si rien de directionnel).
 * @param elsewhere côté opposé posé par une AUTRE règle sur le même sélecteur et le même contexte
 *   `@media` (`.mr-2,.mx-2` / `.ml-2,.mx-2` de Bootstrap) : sert de vraie contrepartie au lieu d'une
 *   remise à la valeur initiale — `.mx-2` reste symétrique, deux règles complémentaires se croisent.
 */
export function mirrorDeclarations(decls, elsewhere = () => undefined) {
  const out = [];
  const byProp = new Map();
  for (const d of decls) byProp.set(d.prop, d);
  const done = new Set();
  for (const d of decls) {
    const { prop, value, important } = d;
    if (MIRROR.has(prop)) {
      if (done.has(prop)) continue;
      const other = MIRROR.get(prop);
      if ((prop === 'left' || prop === 'right') && /50%/.test(value)) continue;
      const counterpart = byProp.get(other) ?? elsewhere(other);
      // Côtés égaux (padding-left = padding-right) : rien à retourner.
      if (counterpart && counterpart.value === value && counterpart.important === important) continue;
      done.add(prop);
      done.add(other);
      out.push({ prop: other, value, important });
      out.push(counterpart ? { prop, value: counterpart.value, important: counterpart.important } : { prop, value: initialValue(prop), important });
      continue;
    }
    if (/^(text-align|float|clear)$/.test(prop) && /^(left|right)$/.test(value)) {
      out.push({ prop, value: flipKeyword(value), important });
    } else if (prop === 'background-position' && /\b(left|right)\b/.test(value)) {
      out.push({ prop, value: flipKeyword(value), important });
    } else if (/^(margin|padding|border-width|border-style|border-color)$/.test(prop)) {
      const t = tokens(value);
      if (t.length === 4 && t[1] !== t[3]) out.push({ prop, value: [t[0], t[3], t[2], t[1]].join(' '), important });
    } else if (prop === 'border-radius' && !value.includes('/')) {
      const t = tokens(value);
      const [tl, tr = tl, br = tl, bl = tr] = t;
      if (t.length >= 2 && !(tl === tr && br === bl)) out.push({ prop, value: [tr, tl, bl, br].join(' '), important });
    }
  }
  return out;
}

const prefix = sel => {
  const s = sel.trim();
  if (/^html\b/.test(s)) return s.replace(/^html/, "html[dir='rtl']");
  if (/^:root\b/.test(s)) return s.replace(/^:root/, ":root[dir='rtl']");
  return `[dir='rtl'] ${s}`;
};

export function buildOverrides(css, from) {
  const root = postcss.parse(css, { from });
  root.walkAtRules(at => {
    if (!/^(media|supports)$/.test(at.name)) at.remove();
  });
  root.walkComments(c => c.remove());
  const context = rule => {
    const chain = [];
    for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) chain.unshift(`@${p.name} ${p.params}`);
    return chain.join(' ');
  };
  const declsOf = rule =>
    rule.nodes.filter(n => n.type === 'decl').map(n => ({ prop: n.prop.toLowerCase(), value: n.value, important: n.important }));
  // Index : côtés gauche/droit posés par sélecteur et contexte, toutes règles confondues (dernière gagne).
  const sides = new Map();
  root.walkRules(rule => {
    const ctx = context(rule);
    for (const sel of rule.selectors) for (const d of declsOf(rule)) if (MIRROR.has(d.prop)) sides.set(`${ctx}|${sel.trim()}|${d.prop}`, d);
  });
  root.walkRules(rule => {
    const ctx = context(rule);
    const decls = declsOf(rule);
    // Sélecteurs regroupés par sortie identique (un même bloc Bootstrap sert souvent plusieurs classes).
    const groups = new Map();
    for (const sel of rule.selectors) {
      const mirrored = mirrorDeclarations(decls, prop => sides.get(`${ctx}|${sel.trim()}|${prop}`));
      if (!mirrored.length) continue;
      const key = JSON.stringify(mirrored);
      if (!groups.has(key)) groups.set(key, { mirrored, selectors: [] });
      groups.get(key).selectors.push(prefix(sel));
    }
    if (!groups.size) {
      rule.remove();
      return;
    }
    for (const { mirrored, selectors } of groups.values()) {
      const copy = postcss.rule({ selectors });
      for (const d of mirrored) copy.append(postcss.decl(d));
      rule.before(copy);
    }
    rule.remove();
  });
  let removed = true;
  while (removed) {
    removed = false;
    root.walkAtRules(at => {
      if (!at.nodes || at.nodes.length === 0) {
        at.remove();
        removed = true;
      }
    });
  }
  root.raws.after = '\n';
  return root.toString().trim();
}

async function main() {
  const parts = [];
  for (const rel of SOURCES) {
    const file = path.join(WEB, rel);
    const body = buildOverrides(fs.readFileSync(file, 'utf8'), file);
    if (body) parts.push(`/* ${rel} */\n${body}`);
  }
  // Fins de ligne normalisées : style.css est en CRLF, la sortie ne doit pas dépendre du checkout.
  const css = `/* Généré par scripts/i18n/build-pluto-rtl.mjs — ne pas modifier. */\n${parts.join('\n\n')}\n`.replace(/\r\n/g, '\n');
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== css) {
      console.error('[build-pluto-rtl] surcharges RTL périmées → npm run i18n:pluto-rtl');
      process.exit(1);
    }
    console.log('[build-pluto-rtl] à jour');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, css, 'utf8');
  console.log(`[build-pluto-rtl] ${path.relative(WEB, OUT)} (${Math.round(css.length / 1024)} Kio)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
