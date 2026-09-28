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

/** Vague d'après le fichier source (globs de scopes.json), à défaut d'après le préfixe de l'ID. */
function waveForFiles(files, id) {
  for (const file of files) {
    for (const [wave, cfg] of Object.entries(SCOPES.waves ?? {})) {
      if ((cfg.globs ?? []).some(glob => file.startsWith(glob.replace(/\*\*$/, '')))) return wave;
    }
  }
  return waveForIdByPrefix(id);
}

/**
 * Normalise la sortie de `ng extract-i18n` : locale source `fr`, emplacements réduits aux fichiers
 * (sans ligne ni colonne, pour que le diff ne bouge pas à chaque édition), vague de livraison.
 */
function normalizeArb(raw) {
  const out = { '@@locale': 'fr' };
  for (const key of Object.keys(raw)) {
    if (key.startsWith('@')) continue;
    out[key] = raw[key];
    const meta = raw[`@${key}`] && typeof raw[`@${key}`] === 'object' ? raw[`@${key}`] : {};
    const files = [
      ...new Set((meta['x-locations'] ?? []).map(l => String(l.file ?? '').replace(/\\/g, '/')).filter(Boolean))
    ].sort();
    const next = {};
    if (meta.description) next.description = meta.description;
    if (meta['x-meaning'] ?? meta.meaning) next['x-meaning'] = meta['x-meaning'] ?? meta.meaning;
    if (files.length) next['x-files'] = files;
    const wave = waveForFiles(files, key);
    if (wave) next['x-wave'] = wave;
    out[`@${key}`] = next;
  }
  return out;
}

fs.mkdirSync(LOCALE_DIR, { recursive: true });

const fromArg = process.argv.find(a => a.startsWith('--from='))?.slice('--from='.length);
let source = fromArg ? path.resolve(fromArg) : null;
const tmpDir = path.join(WEB, '.angular', 'i18n-extract');
if (!source) {
  const ng = spawnSync('npm', ['exec', '--', 'ng', 'extract-i18n', '--format=arb', `--output-path=${tmpDir}`, '--out-file=messages.fr.arb'], {
    cwd: WEB,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (ng.status !== 0) {
    process.exit(ng.status ?? 1);
  }
  source = path.join(tmpDir, 'messages.fr.arb');
}
if (!fs.existsSync(source)) {
  console.error(`[extract] sortie extract-i18n introuvable : ${source}`);
  process.exit(1);
}

const arb = normalizeArb(JSON.parse(fs.readFileSync(source, 'utf8')));
fs.writeFileSync(OUT_ARB, `${JSON.stringify(arb, null, 2)}\n`, 'utf8');
if (!fromArg) fs.rmSync(tmpDir, { recursive: true, force: true });
const count = Object.keys(arb).filter(k => !k.startsWith('@')).length;
console.log(`[extract] ${count} messages → ${path.relative(WEB, OUT_ARB)}`);
