#!/usr/bin/env node
/**
 * Applique un lot de traductions indexé par texte français (blancs normalisés) à tous les ID
 * du catalogue qui portent ce texte, et les range dans scripts/i18n/translations-ar/<vague>.json.
 * Chaque traduction est validée (placeholders, ICU, HTML, bidi…) ; une traduction invalide est
 * refusée et signalée, jamais écrite.
 *
 * Usage : node scripts/i18n/apply-translation-batch.mjs <lot.json> [--dry-run]
 *   lot.json : { "Texte français exact": "النص العربي", … }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTranslation } from './translation-rules.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const batchPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!batchPath) {
  console.error('Usage: apply-translation-batch.mjs <lot.json> [--dry-run]');
  process.exit(1);
}

const norm = s => String(s).replace(/\s+/g, ' ').trim();
const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const batch = JSON.parse(fs.readFileSync(path.resolve(batchPath), 'utf8'));

const idsByText = new Map();
for (const [id, text] of Object.entries(fr)) {
  if (id.startsWith('@')) continue;
  const key = norm(text);
  if (!idsByText.has(key)) idsByText.set(key, []);
  idsByText.get(key).push(id);
}

const byWave = new Map();
const problems = [];
let applied = 0;
for (const [text, ar] of Object.entries(batch)) {
  const key = norm(text);
  const ids = idsByText.get(key);
  if (!ids) {
    problems.push(`[inconnu] « ${key.slice(0, 70)} »`);
    continue;
  }
  const value = String(ar).trim();
  const reason = validateTranslation(fr[ids[0]], value);
  if (reason) {
    problems.push(`[${reason}] « ${key.slice(0, 70)} » → « ${value.slice(0, 60)} »`);
    continue;
  }
  for (const id of ids) {
    const wave = fr[`@${id}`]?.['x-wave'] ?? 'misc';
    if (!byWave.has(wave)) byWave.set(wave, {});
    byWave.get(wave)[id] = value;
    applied++;
  }
}

for (const [wave, entries] of byWave) {
  const file = path.join(WEB, 'scripts/i18n/translations-ar', `wave-${wave}.json`);
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const merged = { ...current, ...entries };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

for (const p of problems) console.warn(p);
console.log(
  `[apply-translation-batch] ${Object.keys(batch).length} textes → ${applied} ID` +
    ` (${[...byWave.keys()].join(', ') || 'aucune vague'}) ; ${problems.length} refus${dryRun ? ' — simulation' : ''}`
);
process.exit(problems.length ? 1 : 0);
