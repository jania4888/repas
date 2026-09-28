#!/usr/bin/env node
/**
 * Réimport d'un CSV de relecture native (format de export-review).
 *  - `correction` renseignée : validée comme au build (placeholders, ICU, HTML, bidi…) puis écrite
 *    sur tous les ID de la vague qui portent ce texte français ET cette traduction proposée
 *    (les homonymes traduits autrement ne sont pas touchés) ;
 *  - `statut` = relu / validé / ok : la ligne est comptée comme relue (scripts/i18n/review-status.json).
 * Une correction refusée est signalée, jamais écrite. Rien n'est écrit avec --dry-run.
 *
 * Usage : node scripts/i18n/import-review.mjs --file=scripts/i18n/review/relecture-v3.csv [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripIsolates, validateTranslation } from './translation-rules.mjs';
import { COLUMNS, keyOf, parseCsv, STATUS_DONE } from './review-csv.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = arg('file');
const dryRun = process.argv.includes('--dry-run');
if (!file) {
  console.error('Usage : import-review.mjs --file=<relecture-vX.csv> [--dry-run]');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(path.resolve(WEB, file), 'utf8'));
const missing = COLUMNS.filter(c => rows.length && !(c in rows[0]));
if (missing.length) {
  console.error(`[import-review] colonnes manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(WEB, 'src/assets/i18n/messages.ar.json'), 'utf8')).translations;
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const idsFor = (wave, french, proposed) =>
  Object.keys(fr).filter(
    id =>
      !id.startsWith('@') &&
      (fr[`@${id}`]?.['x-wave'] ?? 'autres') === wave &&
      norm(fr[id]) === french &&
      catalog[id] &&
      norm(stripIsolates(catalog[id])) === proposed
  );

const statusPath = path.join(WEB, 'scripts/i18n/review-status.json');
const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};
const writes = new Map(); // vague → { id: traduction }
const problems = [];
let corrected = 0;
let reviewedRows = 0;

for (const r of rows) {
  const french = norm(r.francais);
  const correction = norm(r.correction);
  if (r.cle !== keyOf(r.vague, french)) {
    problems.push(`[clé] ${r.cle} : le texte français a été modifié dans le fichier, ligne ignorée`);
    continue;
  }
  if (correction) {
    const ids = idsFor(r.vague, french, norm(r.arabe_propose));
    if (!ids.length) {
      problems.push(`[introuvable] ${r.cle} « ${french.slice(0, 60)} » (catalogue modifié depuis l'export ?)`);
      continue;
    }
    const reason = validateTranslation(fr[ids[0]], correction);
    if (reason) {
      problems.push(`[${reason}] ${r.cle} « ${french.slice(0, 50)} » → « ${correction.slice(0, 50)} »`);
      continue;
    }
    if (!writes.has(r.vague)) writes.set(r.vague, {});
    for (const id of ids) writes.get(r.vague)[id] = correction;
    corrected++;
  }
  if (STATUS_DONE.test(norm(r.statut))) {
    status[r.cle] = correction ? 'corrigé' : 'relu';
    reviewedRows++;
  }
}

if (!dryRun) {
  for (const [wave, entries] of writes) {
    const target = path.join(WEB, 'scripts/i18n/translations-ar', `wave-${wave}.json`);
    const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    const merged = Object.fromEntries(Object.entries({ ...current, ...entries }).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  }
  const sorted = Object.fromEntries(Object.entries(status).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(statusPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

for (const p of problems) console.warn(`  ${p}`);
console.log(
  `[import-review] ${rows.length} ligne(s) : ${corrected} correction(s), ${reviewedRows} relue(s), ` +
    `${problems.length} refus${dryRun ? ' — simulation' : ''}`
);
process.exit(problems.length ? 1 : 0);
