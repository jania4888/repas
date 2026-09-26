#!/usr/bin/env node
/**
 * Lance ng extract-i18n (ARB) vers src/locale/messages.fr.arb et annote les métadonnées de vague.
 *
 * Usage: node scripts/i18n/extract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LOCALE_DIR = path.join(WEB, 'src/locale');
const OUT_ARB = path.join(LOCALE_DIR, 'messages.fr.arb');
const SCOPES = JSON.parse(
  fs.readFileSync(path.join(WEB, 'scripts/i18n/scopes.json'), 'utf8')
);

function waveForId(id) {
  const rel = id.replace(/^@@/, '').replace(/\./g, '/');
  for (const [wave, cfg] of Object.entries(SCOPES.waves ?? {})) {
    for (const glob of cfg.globs ?? []) {
      const prefix = glob.replace(/\*\*$/, '').replace(/\*\*/g, '');
      if (rel.startsWith(prefix.replace(/^src\/app\//, ''))) {
        return wave;
      }
      if (id.startsWith(prefix.split('/').pop() ?? '')) {
        return wave;
      }
    }
  }
  const head = id.split('.')[0]?.replace(/^@@/, '');
  for (const [wave, cfg] of Object.entries(SCOPES.waves ?? {})) {
    for (const glob of cfg.globs ?? []) {
      if (glob.includes(`/${head}/`) || glob.includes(`${head}.`)) {
        return wave;
      }
    }
  }
  return null;
}

function waveForIdByPrefix(id) {
  const bare = id.replace(/^@@/, '');
  const first = bare.split('.')[0];
  const map = {
    auth: 'v2',
    login: 'v2',
    core: 'v1',
    shared: 'v1',
    dashboard: 'v3',
    clients: 'v3',
    suppliers: 'v3',
    products: 'v3',
    settings: 'v3',
    invoices: 'v4',
    quotes: 'v4',
    stock: 'v5',
    treasury: 'v5',
    payroll: 'v6',
    projects: 'v6',
    accounting: 'v7',
    studio: 'v7'
  };
  if (map[first]) return map[first];
  return waveForId(id);
}

fs.mkdirSync(LOCALE_DIR, { recursive: true });

const ng = spawnSync('npm', ['exec', '--', 'ng', 'extract-i18n', '--format=arb'], {
  cwd: WEB,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (ng.status !== 0) {
  process.exit(ng.status ?? 1);
}

const defaultOut = path.join(LOCALE_DIR, 'messages.json');
const source = fs.existsSync(defaultOut) ? defaultOut : OUT_ARB;
if (!fs.existsSync(source)) {
  console.error('[extract] sortie extract-i18n introuvable');
  process.exit(1);
}

const arb = JSON.parse(fs.readFileSync(source, 'utf8'));
for (const key of Object.keys(arb)) {
  if (key.startsWith('@') || key === '@@locale') continue;
  const metaKey = `@${key}`;
  const wave = waveForIdByPrefix(key);
  if (!wave) continue;
  const meta = typeof arb[metaKey] === 'object' && arb[metaKey] ? { ...arb[metaKey] } : {};
  meta['x-wave'] = wave;
  arb[metaKey] = meta;
}

fs.writeFileSync(OUT_ARB, JSON.stringify(arb, null, 2), 'utf8');
if (source !== OUT_ARB && fs.existsSync(defaultOut)) {
  fs.unlinkSync(defaultOut);
}
console.log(`[extract] écrit ${OUT_ARB}`);
