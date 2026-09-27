#!/usr/bin/env node
/**
 * Valide les paires ARB FR/AR (ou repli messages.ar.json).
 * Rejette le jeton filler « مسمّى », l'identité AR=FR (hors liste blanche), les placeholders.
 *
 * Usage: node scripts/i18n/check-translations.mjs [--scope=auth]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, loadArabicMerged } from './compile-i18n-runtime.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const localeDir = path.join(WEB, 'src/locale');
const frArbPath = path.join(localeDir, 'messages.fr.arb');
const arArbPath = path.join(localeDir, 'messages.ar.arb');
const legacyJson = path.join(WEB, 'src/assets/i18n/messages.ar.json');
const whitelistPath = path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json');

const scope = process.argv.find(a => a.startsWith('--scope='))?.split('=')[1];
const wave = process.argv.find(a => a.startsWith('--wave='))?.split('=')[1];
const legacyOnly = process.argv.includes('--legacy-only');
const allowFrFallback = process.argv.includes('--allow-fr-fallback');
const FILLER = 'مسمّى';

const whitelist = fs.existsSync(whitelistPath)
  ? JSON.parse(fs.readFileSync(whitelistPath, 'utf8'))
  : { ids: [], values: [] };

function loadArb(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function messageKeys(arb) {
  return Object.keys(arb).filter(k => !k.startsWith('@') && k !== '@@locale');
}

function placeholdersIn(text) {
  const set = new Set();
  const re = /\{\$[^}]+\}|\{[a-zA-Z][^}]*\}/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    set.add(m[0]);
  }
  return set;
}

function checkArbPair(frArb, arArb) {
  let errors = 0;
  const frKeys = messageKeys(frArb);
  const ids = scope ? frKeys.filter(id => id.startsWith(`${scope}.`) || id.startsWith(`@@${scope}.`)) : frKeys;

  for (const id of ids) {
    const fr = frArb[id];
    const bare = id.replace(/^@@/, '');
    const ar = arArb[id] ?? arArb[bare];
    if (ar == null || !String(ar).trim()) {
      if (allowFrFallback) {
        continue;
      }
      console.error(`[missing-ar] ${id}`);
      errors++;
      continue;
    }
    if (String(ar).includes(FILLER)) {
      console.error(`[filler] ${id} contient ${FILLER}`);
      errors++;
    }
    const bareId = id.replace(/^@@/, '');
    const allowSame =
      whitelist.ids.includes(id) ||
      whitelist.ids.includes(bareId) ||
      whitelist.values.includes(String(ar).trim());
    if (!allowSame && !allowFrFallback && String(ar).trim() === String(fr).trim()) {
      console.error(`[identical-fr] ${id}`);
      errors++;
    }
    if (!allowFrFallback) {
      const frPh = placeholdersIn(fr);
      for (const ph of frPh) {
        if (!String(ar).includes(ph)) {
          console.error(`[placeholder] ${id} manque ${ph}`);
          errors++;
        }
      }
    }
  }
  console.log(`ARB — ${ids.length} clés vérifiées (${scope ? `scope=${scope}` : 'toutes'})`);
  return errors;
}

function checkLegacyJson() {
  if (!fs.existsSync(legacyJson)) {
    console.error('Aucun messages.fr.arb / messages.ar.arb ni messages.ar.json');
    process.exit(1);
  }
  const body = JSON.parse(fs.readFileSync(legacyJson, 'utf8'));
  const translations = body.translations ?? {};
  let errors = 0;
  const ids = Object.keys(translations).filter(id => !scope || id.startsWith(`${scope}.`));
  for (const id of ids) {
    const value = translations[id];
    if (value == null || !String(value).trim()) {
      if (id.startsWith('auto.')) continue;
      console.error(`[empty] ${id}`);
      errors++;
      continue;
    }
    if (String(value).includes(FILLER)) {
      console.error(`[filler] ${id}`);
      errors++;
    }
    const frPh = placeholdersIn(id);
    for (const ph of frPh) {
      if (!String(value).includes(ph)) {
        console.error(`[placeholder] ${id} manque ${ph}`);
        errors++;
      }
    }
  }
  console.log(`Legacy JSON — ${ids.length} clés (sans contrôle identical-fr)`);
  return errors;
}

function wavePrefixes(waveId) {
  const scopes = JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/scopes.json'), 'utf8'));
  const spec = scopes.waves[waveId];
  if (!spec) {
    console.error(`[wave] vague inconnue ${waveId}`);
    process.exit(1);
  }
  return spec.globs.map(g => g.replace(/\/\*\*$/, '/'));
}

function checkWaveSourceFiles() {
  const prefixes = wavePrefixes(wave);
  const { frById } = buildCatalog();
  const manual = loadArabicMerged();
  const arArb = loadArb(arArbPath) ?? {};
  const hasArabic = s => /[\u0600-\u06FF]/.test(String(s ?? ''));
  const idFile = new Map();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(html|ts)$/.test(ent.name)) {
        const rel = path.relative(WEB, full).replace(/\\/g, '/');
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/@@([A-Za-z0-9_.-]+)/g)) {
          if (!idFile.has(m[1])) idFile.set(m[1], rel);
        }
      }
    }
  }
  walk(path.join(WEB, 'src/app'));
  let checked = 0;
  let fallback = 0;
  let errors = 0;
  for (const [id, fr] of frById) {
    const file = idFile.get(id);
    if (!file || !prefixes.some(p => file.startsWith(p))) continue;
    checked++;
    const ar = manual[id] ?? manual[`@@${id}`] ?? arArb[id] ?? arArb[`@@${id}`];
    const same = !ar || String(ar).trim() === String(fr).trim() || !hasArabic(ar);
    const allowSame = whitelist.ids.includes(id) || whitelist.values.includes(String(fr).trim());
    if (!same || allowSame) continue;
    fallback++;
    if (!allowFrFallback) {
      console.error(`[wave-fr-fallback] ${id} (${file})`);
      errors++;
    }
  }
  console.log(`Wave ${wave} — ${checked} clés de fichiers source, ${fallback} replis FR hors liste blanche`);
  return errors;
}

const frArb = loadArb(frArbPath);
const arArb = loadArb(arArbPath);

let errors = 0;
if (frArb && arArb && !legacyOnly) {
  errors = checkArbPair(frArb, arArb);
} else if (frArb && !arArb) {
  console.warn('[check-translations] messages.ar.arb absent — validation partielle FR seule');
  errors = checkLegacyJson();
} else {
  errors = checkLegacyJson();
}

if (wave) errors += checkWaveSourceFiles();

process.exit(errors ? 1 : 0);
