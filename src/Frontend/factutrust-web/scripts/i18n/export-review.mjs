#!/usr/bin/env node
/**
 * Export des traductions arabes pour la relecture native, un CSV par vague (v1 à v7).
 * Une ligne par couple (texte français, traduction) : les occurrences identiques d'une vague sont
 * regroupées. Le relecteur remplit `correction` (vide = traduction acceptée), passe `statut` à
 * « relu » et peut laisser un `commentaire`. Réimport : npm run i18n:import-review.
 *
 * Usage : node scripts/i18n/export-review.mjs [--wave=v3] [--out-dir=scripts/i18n/review]
 * Prérequis : npm run i18n:extract && npm run i18n:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripIsolates } from './translation-rules.mjs';
import { keyOf, STATUS_TODO, toCsv } from './review-csv.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const onlyWave = arg('wave');
const outDir = path.resolve(WEB, arg('out-dir') ?? 'scripts/i18n/review');

const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(WEB, 'src/assets/i18n/messages.ar.json'), 'utf8')).translations;
const statusPath = path.join(WEB, 'scripts/i18n/review-status.json');
const reviewed = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};

const byWave = new Map();
for (const [id, text] of Object.entries(fr)) {
  if (id.startsWith('@') || !catalog[id]) continue;
  const meta = fr[`@${id}`] ?? {};
  const wave = meta['x-wave'] ?? 'autres';
  if (onlyWave && wave !== onlyWave) continue;
  const french = String(text).replace(/\s+/g, ' ').trim();
  const arabic = stripIsolates(catalog[id]).replace(/\s+/g, ' ').trim();
  const key = keyOf(wave, french);
  if (!byWave.has(wave)) byWave.set(wave, new Map());
  const rows = byWave.get(wave);
  // Un même texte peut avoir des traductions différentes selon l'écran (homonymes) : une ligne chacune.
  const rowKey = `${key}|${arabic}`;
  if (!rows.has(rowKey)) {
    rows.set(rowKey, {
      cle: key,
      vague: wave,
      occurrences: 0,
      files: new Set(),
      francais: french,
      arabe_propose: arabic,
      correction: '',
      statut: reviewed[key] ? 'relu' : STATUS_TODO,
      commentaire: ''
    });
  }
  const row = rows.get(rowKey);
  row.occurrences++;
  for (const f of meta['x-files'] ?? []) row.files.add(f.replace(/^src\/app\//, ''));
}

fs.mkdirSync(outDir, { recursive: true });
for (const [wave, rows] of [...byWave].sort(([a], [b]) => a.localeCompare(b))) {
  const list = [...rows.values()]
    .map(r => ({ ...r, contexte: [...r.files].slice(0, 2).join(' | ') }))
    .sort((a, b) => a.contexte.localeCompare(b.contexte) || a.francais.localeCompare(b.francais));
  const file = path.join(outDir, `relecture-${wave}.csv`);
  fs.writeFileSync(file, toCsv(list), 'utf8');
  const done = list.filter(r => r.statut === 'relu').length;
  console.log(`[export-review] ${path.relative(WEB, file)} : ${list.length} ligne(s), ${done} déjà relue(s)`);
}
