#!/usr/bin/env node
/**
 * Fusionne un lot de traductions { "message français": "الترجمة" } dans
 * src/Backend/FactuTrust.API/Localization/messages.ar.json, après validation :
 * mêmes gabarits {0}, {1}… que le français, aucun contrôle bidi, aucune valeur vide.
 *
 * Usage : node tools/i18n-backend-extract/apply-backend-batch.mjs <lot.json> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TARGET = path.join(ROOT, 'src/Backend/FactuTrust.API/Localization/messages.ar.json');
const batchPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!batchPath) {
  console.error('Usage: apply-backend-batch.mjs <lot.json> [--dry-run]');
  process.exit(1);
}

const placeholders = s => [...String(s).matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort().join(',');
const BIDI = /[‎‏‪-‮⁦-⁩؜]/;

const raw = fs.readFileSync(TARGET, 'utf8');
const catalog = JSON.parse(raw);
const batch = JSON.parse(fs.readFileSync(path.resolve(batchPath), 'utf8'));
const problems = [];
let added = 0;
for (const [fr, arValue] of Object.entries(batch)) {
  const ar = String(arValue ?? '').trim();
  if (!ar) problems.push(`[vide] ${fr.slice(0, 70)}`);
  else if (BIDI.test(ar)) problems.push(`[bidi] ${fr.slice(0, 70)}`);
  else if (placeholders(fr) !== placeholders(ar)) problems.push(`[gabarits] ${fr.slice(0, 70)} → ${ar.slice(0, 50)}`);
  else if (!/[؀-ۿ]/.test(ar)) problems.push(`[non arabe] ${fr.slice(0, 70)}`);
  else {
    catalog.translations[fr] = ar;
    added++;
  }
}
if (!dryRun) {
  const sorted = Object.fromEntries(Object.entries(catalog.translations).sort(([a], [b]) => a.localeCompare(b, 'fr')));
  fs.writeFileSync(TARGET, `${JSON.stringify({ ...catalog, translations: sorted }, null, 2)}\n`, 'utf8');
}
for (const p of problems) console.warn(p);
console.log(`[apply-backend-batch] ${added} traduction(s) ajoutée(s), ${problems.length} refus${dryRun ? ' — simulation' : ''}`);
process.exit(problems.length ? 1 : 0);
