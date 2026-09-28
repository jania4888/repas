#!/usr/bin/env node
/**
 * Mémoire de traduction : paires FR (source réelle) → AR (catalogue) contenant un terme.
 * Sert à garder la terminologie déjà validée avant de traduire de nouveaux messages.
 *
 * Usage : node scripts/i18n/tm-lookup.mjs "bon de réception" [--limit=20]
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectMessages } from './gate/_messages.mjs';
import { getWebRoot } from './verify/_lib.mjs';

const term = process.argv[2];
if (!term) {
  console.error('Usage: tm-lookup.mjs "<terme FR>" [--limit=N]');
  process.exit(1);
}
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 20);
const catalog = JSON.parse(fs.readFileSync(path.join(getWebRoot(), 'src/assets/i18n/messages.ar.json'), 'utf8')).translations;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const needle = norm(term);
const seen = new Set();
let shown = 0;
for (const m of collectMessages()) {
  if (!m.id || seen.has(m.text) || !norm(m.text).includes(needle)) continue;
  const ar = catalog[m.id];
  if (!ar || !/[؀-ۿ]/.test(ar)) continue;
  seen.add(m.text);
  console.log(`${m.text}\n    → ${ar}`);
  if (++shown >= limit) break;
}
if (!shown) console.log('(aucune traduction existante)');
