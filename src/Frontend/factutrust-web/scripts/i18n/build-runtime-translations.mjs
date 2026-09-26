#!/usr/bin/env node
/**
 * Produit le catalogue runtime AR : messages.ar.json (dev) + messages.ar.<hash>.json + manifest.
 * Lit src/locale/messages.ar.arb si présent, sinon compile-i18n-runtime.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT_DIR = path.join(WEB, 'src/assets/i18n');
const DEV_OUT = path.join(OUT_DIR, 'messages.ar.json');
const ARB_AR = path.join(WEB, 'src/locale/messages.ar.arb');
const ARB_FR = path.join(WEB, 'src/locale/messages.fr.arb');
const MANIFEST = path.join(WEB, 'src/app/core/i18n/erp-i18n-manifest.generated.ts');
const FSI = '\u2068';
const PDI = '\u2069';

const compile = path.join(WEB, 'scripts/i18n/compile-i18n-runtime.mjs');

function messageKeys(arb) {
  return Object.keys(arb).filter(k => !k.startsWith('@') && k !== '@@locale');
}

function loadTranslationsFromArb() {
  if (!fs.existsSync(ARB_AR)) {
    return null;
  }
  const arArb = JSON.parse(fs.readFileSync(ARB_AR, 'utf8'));
  const frArb = fs.existsSync(ARB_FR) ? JSON.parse(fs.readFileSync(ARB_FR, 'utf8')) : {};
  const translations = {};
  for (const id of messageKeys(arArb)) {
    const ar = arArb[id];
    if (ar != null && String(ar).trim()) {
      translations[id.replace(/^@@/, '')] = String(ar);
    }
  }
  for (const id of messageKeys(frArb)) {
    const bare = id.replace(/^@@/, '');
    if (translations[bare] == null || !String(translations[bare]).trim()) {
      translations[bare] = String(frArb[id]);
    }
  }
  return translations;
}

function runCompilePath() {
  const result = spawnSync(process.execPath, [compile], { stdio: 'inherit', cwd: WEB });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  const body = JSON.parse(fs.readFileSync(DEV_OUT, 'utf8'));
  return body.translations ?? {};
}

let translations = loadTranslationsFromArb();
if (!translations) {
  translations = runCompilePath();
} else {
  console.log('[build-runtime-translations] source ARB messages.ar.arb');
}

for (const [id, value] of Object.entries(translations)) {
  if (typeof value !== 'string') continue;
  translations[id] = value.replace(/\{\$[^}]+\}/g, m => `${FSI}${m}${PDI}`);
}

const body = { locale: 'ar', translations };
const serialized = JSON.stringify(body, null, 2);
const hash = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 12);
const hashedName = `messages.ar.${hash}.json`;
const hashedPath = path.join(OUT_DIR, hashedName);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(DEV_OUT, serialized, 'utf8');
fs.writeFileSync(hashedPath, serialized, 'utf8');

const manifestTs = `/** Généré par scripts/i18n/build-runtime-translations.mjs — ne pas modifier. */
export const ERP_I18N_MANIFEST = {
  locale: 'ar' as const,
  sha256: '${hash}',
  messagesFile: '${hashedName}',
  messagesUrl: 'assets/i18n/${hashedName}'
} as const;
`;
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, manifestTs, 'utf8');

console.log(
  `[build-runtime-translations] ${Object.keys(translations).length} clés → ${hashedName} + manifest`
);
