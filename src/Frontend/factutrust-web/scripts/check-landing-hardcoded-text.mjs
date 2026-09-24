#!/usr/bin/env node
/**
 * Garde « un seul texte source » (plan lot D, TD10) : tout le texte visible de la landing
 * vit dans les dictionnaires typés `features/home/content/` ; les templates des composants
 * ne doivent contenir aucune chaîne en dur.
 *
 * Vérifié sur `src/app/features/home/**\/*.component.ts` (hors `content/` et `*.spec.ts`) :
 *  - nœud texte du `template:` contenant une lettre Unicode (hors interpolations `{{ … }}`,
 *    balises, micro-syntaxe `@if/@for`, entités) ;
 *  - attribut littéral `aria-label|alt|title|placeholder="…"` (la forme liée
 *    `[attr.aria-label]="…"` est la seule permise).
 *
 * Liste blanche de nœuds texte : `&copy;`, `•`, `|`, flèches/icônes purement décoratives,
 * et marques INTENTIONNELLEMENT jamais traduites : « InstaFact », « TEJ ».
 *
 * Usage : node scripts/check-landing-hardcoded-text.mjs  (exit 1 + liste des violations)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/app/features/home/', import.meta.url).pathname;
const ALLOW_TEXT = /^[\s\d&;#©•|→←·•.,:;!?()\/«»\-–—%+×"'’*≤≥=\\]*$/;
const ALLOW_BRANDS = /^\s*(InstaFact|TEJ)\s*$/;
const ATTR_RE = /\s(aria-label|alt|title|placeholder)\s*=\s*"([^"{}]*)"/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'content') yield* walk(path);
    } else if (entry.endsWith('.component.ts') && !entry.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

/** Extrait les gabarits inline `template: \`…\`` (couvre les backticks échappés simples). */
function extractTemplates(source) {
  const templates = [];
  const re = /template:\s*`/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let i = m.index + m[0].length;
    let out = '';
    while (i < source.length) {
      const c = source[i];
      if (c === '\\' && source[i + 1] === '`') {
        out += '`';
        i += 2;
        continue;
      }
      if (c === '`') break;
      out += c;
      i += 1;
    }
    templates.push(out);
    re.lastIndex = i + 1;
  }
  return templates;
}

const violations = [];
for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  for (const template of extractTemplates(source)) {
    // Retire interpolations, commentaires HTML, micro-syntaxe et balises.
    const stripped = template
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/@(if|for|switch|case|else|empty|defer|placeholder|loading|error)\b[^>{)]*(\([^)]*\))?/g, ' ')
      .replace(/<\/?[A-Za-z][^>]*>?/g, ' ');
    for (const chunk of stripped.split(/\n|>/)) {
      const text = chunk.replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
      if (!text) continue;
      if (ALLOW_TEXT.test(text) || ALLOW_BRANDS.test(text)) continue;
      if (/\p{L}/u.test(text)) {
        violations.push(`${relative(process.cwd(), file)}: texte en dur « ${text.slice(0, 80)} »`);
      }
    }
    for (const m of template.matchAll(ATTR_RE)) {
      const [, attr, value] = m;
      if (value.trim() && !value.includes('{{') && /\p{L}/u.test(value) && !ALLOW_BRANDS.test(value)) {
        violations.push(`${relative(process.cwd(), file)}: attribut littéral ${attr}="…${value.slice(0, 60)}…" (utiliser [attr.${attr}])`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`check-landing-hardcoded-text: ${violations.length} violation(s) — le texte visible vit dans content/landing-copy.* :`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('check-landing-hardcoded-text: OK (aucune chaîne en dur).');
