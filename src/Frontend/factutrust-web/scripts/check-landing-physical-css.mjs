#!/usr/bin/env node
/**
 * Garde RTL (plan lot D, TD5) : interdit les propriétés CSS physiques directionnelles
 * dans les composants de la landing. Utiliser les propriétés logiques à la place
 * (`margin-inline-start`, `inset-inline-end`, `text-align: start`, `border-start-start-radius`…).
 *
 * Exceptions :
 *  - `src/landing-rtl.scss` (contre-carré le vendeur Chain, écrit en physique LTR) ;
 *  - le honeypot hors écran `#cr-website` / `.cr-website` (left: -9999px) ;
 *  - les centages de centrage (`left: 50%` + transform translate) ;
 *  - les lignes portant le commentaire `rtl-ok` (justifié à la revue).
 *
 * Usage : node scripts/check-landing-physical-css.mjs  (exit 1 + liste des violations)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/app/features/home/', import.meta.url).pathname;

/** Propriétés physiques directionnelles interdites. */
const PATTERNS = [
  { re: /(^|[^\w-])margin-left\s*:/, prop: 'margin-left' },
  { re: /(^|[^\w-])margin-right\s*:/, prop: 'margin-right' },
  { re: /(^|[^\w-])padding-left\s*:/, prop: 'padding-left' },
  { re: /(^|[^\w-])padding-right\s*:/, prop: 'padding-right' },
  { re: /(^|[^\w-])text-align\s*:\s*(left|right)\b/, prop: 'text-align: left|right' },
  { re: /(^|[^\w-])(border-(top|bottom)-left-radius)\s*:/, prop: 'border-*-left-radius' },
  { re: /(^|[^\w-])(border-(top|bottom)-right-radius)\s*:/, prop: 'border-*-right-radius' },
  { re: /^\s*left\s*:/, prop: 'left' },
  { re: /^\s*right\s*:/, prop: 'right' },
  { re: /(^|[^\w-])inset\s*:[^;]*\d/, prop: 'inset (raccourci, ambigu en RTL)' }
];

const ALLOW_LINE = /rtl-ok|translate\(-50%|left:\s*50%|right:\s*50%|-9999px/;
const ALLOW_FILE = /landing-rtl\.scss$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (/\.(ts|scss|css|html)$/.test(entry)) {
      yield path;
    }
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  if (ALLOW_FILE.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const { re, prop } of PATTERNS) {
      if (re.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${i + 1}: « ${prop} » → propriété logique attendue (${line.trim().slice(0, 100)})`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`check-landing-physical-css: ${violations.length} violation(s) — utilisez les propriétés logiques (ou « rtl-ok » justifié) :`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('check-landing-physical-css: OK (aucune propriété physique directionnelle).');
