#!/usr/bin/env node
/**
 * Export CSV de relecture FR/AR par vague (préfixe d'id).
 * Usage: node scripts/i18n/export-review.mjs [--scope=auth] [--out=review-auth.csv]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const arPath = path.join(WEB, 'src/assets/i18n/messages.ar.json');
const scopeArg = process.argv.find(a => a.startsWith('--scope='));
const scope = scopeArg?.split('=')[1] ?? '';
const outArg = process.argv.find(a => a.startsWith('--out='));
const outFile = outArg
  ? path.resolve(WEB, outArg.split('=')[1])
  : path.join(WEB, `scripts/i18n/review${scope ? `-${scope}` : ''}.csv`);

if (!fs.existsSync(arPath)) {
  console.error('messages.ar.json introuvable — lancez npm run i18n:build');
  process.exit(1);
}

const { translations } = JSON.parse(fs.readFileSync(arPath, 'utf8'));
const ids = Object.keys(translations).filter(id => !scope || id.startsWith(`${scope}.`)).sort();

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lines = ['id,french,arabic,status'];
for (const id of ids) {
  const ar = translations[id] ?? '';
  const sameAsFr = ar === id;
  lines.push([esc(id), esc(id), esc(ar), ar && ar !== id ? 'translated' : 'fallback-fr'].join(','));
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(`Écrit ${outFile} (${ids.length} lignes)`);
