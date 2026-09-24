#!/usr/bin/env node
/**
 * Export de relecture du dictionnaire arabe (plan lot D, TD7) :
 * génère `docs/landing/ar-copy-review.md` — tableau « Clé | FR | AR | Statut | Commentaire »
 * (une ligne par chaîne, groupées par zone). La relecture client passe chaque ligne à
 * « Validé » ; 100 % de validation est la porte d'activation de `landing.arabicEnabled`.
 *
 * Usage :
 *   node scripts/export-landing-copy-review.mjs            # régénère docs/landing/ar-copy-review.md
 *   node scripts/export-landing-copy-review.mjs --check    # échoue si des lignes restent « À relire »
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '../../../docs/landing/ar-copy-review.md');
const ZONES = ['shared', 'home', 'cabinets', 'contact', 'seo'];
const CHECK = process.argv.includes('--check');

/** Extrait les paires clé/valeur d'un fichier de dictionnaire (littéraux simples FR/AR). */
function extractStrings(file) {
  const source = readFileSync(file, 'utf8').replace(/^\/\/ TODO-AR.*$/m, '');
  const entries = new Map();
  const re = /(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const key = m[1];
    const raw = m[2] ?? m[3];
    if (key === undefined || raw === undefined) continue;
    const value = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    // Ignore les valeurs techniques (icônes, classes) — on ne garde que du texte avec une lettre.
    if (!/[\p{L}]/u.test(value)) continue;
    if (/^(pi\s|pi-|fa\s|fa-|wow\s|fadeIn|chain-|landing-)/.test(value)) continue;
    entries.set(`${key}:${value}`, value);
  }
  return entries;
}

function parseExistingReview() {
  try {
    const md = readFileSync(OUT, 'utf8');
    const validated = new Set();
    for (const line of md.split('\n')) {
      const cells = line.split('|').map(c => c.trim());
      if (cells.length >= 5 && cells[3] === 'Validé') {
        validated.add(cells[1]);
      }
    }
    return validated;
  } catch {
    return new Set();
  }
}

const validated = parseExistingReview();
const lines = [
  '# Relecture du dictionnaire arabe de la landing',
  '',
  `Régénéré le ${new Date().toISOString().slice(0, 10)} par \`scripts/export-landing-copy-review.mjs\`.`,
  'Passer « À relire » → « Validé » (colonne Statut) ; commenter à droite. 100 % « Validé » =',
  'porte d\'activation de `landing.arabicEnabled` en production.',
  ''
];

let total = 0;
let remaining = 0;
for (const zone of ZONES) {
  const frFile = join(ROOT, 'src/app/features/home/content/fr', `${zone}.ts`);
  const arFile = join(ROOT, 'src/app/features/home/content/ar', `${zone}.ts`);
  const fr = extractStrings(frFile);
  const ar = extractStrings(arFile);
  lines.push(`## ${zone}`);
  lines.push('');
  lines.push('| Clé | FR | AR | Statut | Commentaire |');
  lines.push('| --- | --- | --- | --- | --- |');
  const frValues = [...fr.values()];
  const arValues = [...ar.values()];
  for (let i = 0; i < frValues.length; i += 1) {
    const frValue = frValues[i].replaceAll('|', '\\|');
    const arValue = (arValues[i] ?? '').replaceAll('|', '\\|');
    const key = `${zone}#${i}`;
    const status = validated.has(key) && arValues[i] !== undefined ? 'Validé' : 'À relire';
    if (status !== 'Validé') remaining += 1;
    total += 1;
    lines.push(`| ${key} | ${frValue} | ${arValue} | ${status} |  |`);
  }
  lines.push('');
}

lines.push(`**Progression : ${total - remaining}/${total} validées.**`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'));
console.log(`export-landing-copy-review: ${total} chaînes exportées (${remaining} à relire) → ${OUT}`);

if (CHECK && remaining > 0) {
  console.error(`--check : ${remaining} chaîne(s) non validées.`);
  process.exit(1);
}
