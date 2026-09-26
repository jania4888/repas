#!/usr/bin/env node
/**
 * Valide un CSV de relecture (colonnes id, french, arabic, status).
 * Usage: node scripts/i18n/import-review.mjs [--file=scripts/i18n/review-auth.csv]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REQUIRED = ['id', 'french', 'arabic', 'status'];
const fileArg = process.argv.find(a => a.startsWith('--file='));
const csvPath = fileArg
  ? path.resolve(WEB, fileArg.split('=')[1])
  : path.join(WEB, 'scripts/i18n/review.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`Fichier introuvable: ${csvPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.trim());
if (lines.length < 1) {
  console.error('[import-review] CSV vide');
  process.exit(1);
}

const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
const missing = REQUIRED.filter(c => !header.includes(c));
if (missing.length) {
  console.error(`[import-review] colonnes manquantes: ${missing.join(', ')}`);
  console.error(`  attendu: ${REQUIRED.join(', ')}`);
  console.error(`  trouvé: ${header.join(', ')}`);
  process.exit(1);
}

console.log(`[import-review] OK — ${lines.length - 1} ligne(s), colonnes ${REQUIRED.join(', ')}`);
