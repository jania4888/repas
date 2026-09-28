#!/usr/bin/env node
/**
 * Garde i18n ERP : features verrouillées sans texte visible en dur.
 * Étendre LOCKED_SCOPES au fil de la migration.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(fileURLToPath(new URL('../src/app/', import.meta.url)));

/** Chemins relatifs à src/app (sans extension). */
const LOCKED_SCOPES = [
  'core/layout/erp-language-switcher',
  'features/auth/auth-shell/auth-shell.component.ts'
];

const ALLOW_BRANDS = /^\s*(InstaFact|TEJ|NCT|PDF|XML|API|TND)\s*$/i;

function* filesUnder(rel) {
  const root = join(APP, rel);
  if (!statSync(root, { throwIfNoEntry: false })?.isFile()) {
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const f of walkDir(root)) yield f;
    return;
  }
  yield root;
}

function* walkDir(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'i18n' || e === 'home') continue;
      yield* walkDir(p);
    } else if (e.endsWith('.component.ts') && !e.endsWith('.spec.ts')) {
      yield p;
    } else if (e.endsWith('.html')) {
      yield p;
    }
  }
}

const violations = [];
for (const scope of LOCKED_SCOPES) {
  for (const file of filesUnder(scope)) {
    const src = readFileSync(file, 'utf8');
    if (src.includes('erp-i18n:ignore')) continue;
    const attrRe = /\s(aria-label|alt|title|placeholder)\s*=\s*"([^"{}]{4,})"/g;
    let m;
    while ((m = attrRe.exec(src)) !== null) {
      if (!ALLOW_BRANDS.test(m[2])) {
        violations.push(`${relative(APP, file)}: ${m[1]}="${m[2].slice(0, 50)}"`);
      }
    }
  }
}

if (violations.length) {
  console.error(`check-erp-hardcoded-text: ${violations.length} violation(s)`);
  violations.forEach(v => console.error(' ', v));
  process.exit(1);
}
console.log('check-erp-hardcoded-text: OK');
