#!/usr/bin/env node
/**
 * Bootstrap ARB catalogues from source scan + translations-ar (+ optional messages.ar.json).
 * Usage: node scripts/i18n/bootstrap-arb-from-manual.mjs [--no-compile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './compile-i18n-runtime.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LOCALE_DIR = path.join(WEB, 'src/locale');
const FR_ARB = path.join(LOCALE_DIR, 'messages.fr.arb');
const AR_ARB = path.join(LOCALE_DIR, 'messages.ar.arb');
const RUNTIME_JSON = path.join(WEB, 'src/assets/i18n/messages.ar.json');
const compileScript = path.join(WEB, 'scripts/i18n/compile-i18n-runtime.mjs');

const skipCompile = process.argv.includes('--no-compile');

if (!skipCompile) {
  const result = spawnSync(process.execPath, [compileScript], { stdio: 'inherit', cwd: WEB });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const { frById, arMerged } = buildCatalog();

let runtimeTranslations = {};
if (fs.existsSync(RUNTIME_JSON)) {
  try {
    const body = JSON.parse(fs.readFileSync(RUNTIME_JSON, 'utf8'));
    runtimeTranslations = body.translations ?? {};
  } catch {
    console.warn('[bootstrap-arb] messages.ar.json illisible, ignoré');
  }
}

function resolveArabic(id) {
  const bare = id.replace(/^@@/, '');
  const fromDir =
    arMerged[bare] ??
    arMerged[`@@${bare}`] ??
    arMerged[id] ??
    runtimeTranslations[bare] ??
    runtimeTranslations[id];
  return fromDir != null && String(fromDir).trim() ? String(fromDir) : null;
}

const frArb = { '@@locale': 'fr' };
const arArb = { '@@locale': 'ar' };

for (const [id, fr] of frById) {
  const key = id.replace(/^@@/, '');
  frArb[key] = fr;
  const ar = resolveArabic(id);
  if (ar && ar.trim() !== String(fr).trim()) {
    arArb[key] = ar;
  }
}

fs.mkdirSync(LOCALE_DIR, { recursive: true });
fs.writeFileSync(FR_ARB, JSON.stringify(frArb, null, 2), 'utf8');
fs.writeFileSync(AR_ARB, JSON.stringify(arArb, null, 2), 'utf8');
console.log(
  `[bootstrap-arb] ${Object.keys(frArb).length - 1} clés → ${path.relative(WEB, FR_ARB)}, ${path.relative(WEB, AR_ARB)}`
);
