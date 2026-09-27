#!/usr/bin/env node
/**
 * Applique scripts/i18n/phrase-map-ar.json sur messages.ar.arb
 * par égalité exacte du texte français (après trim).
 * N'écrit pas sur les extraits de code capturés par erreur (clés auto.* longues).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FR_ARB = path.join(WEB, 'src/locale/messages.fr.arb');
const AR_ARB = path.join(WEB, 'src/locale/messages.ar.arb');
const MAP_PATH = path.join(WEB, 'scripts/i18n/phrase-map-ar.json');

function norm(s) {
  return String(s).replace(/\r\n/g, '\n').trim();
}

function looksLikeCode(text) {
  if (text.length > 240 && /[{};]|readonly|export |function |=>/.test(text)) return true;
  if (text.includes('readonly ') || text.includes('export class') || text.includes('inject(')) return true;
  return false;
}

function placeholders(text) {
  return [...String(text).matchAll(/\{\$[^}]+\}/g)].map(m => m[0]).sort().join('|');
}

export function applyPhraseMap(frArb, arArb, phraseMap) {
  let applied = 0;
  for (const [id, fr] of Object.entries(frArb)) {
    if (id.startsWith('@') || typeof fr !== 'string') continue;
    const current = arArb[id];
    if (typeof current === 'string' && current.trim() && current.trim() !== fr.trim()) continue;
    if (looksLikeCode(fr)) continue;
    const ar = phraseMap[norm(fr)] ?? phraseMap[fr];
    if (!ar || ar.trim() === fr.trim()) continue;
    if (placeholders(fr) !== placeholders(ar)) continue;
    arArb[id] = ar;
    applied++;
  }
  return applied;
}

function main() {
  const frArb = JSON.parse(fs.readFileSync(FR_ARB, 'utf8'));
  const arArb = fs.existsSync(AR_ARB) ? JSON.parse(fs.readFileSync(AR_ARB, 'utf8')) : { '@@locale': 'ar' };
  const phraseMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const applied = applyPhraseMap(frArb, arArb, phraseMap);
  fs.writeFileSync(AR_ARB, JSON.stringify(arArb, null, 2), 'utf8');
  console.log(`[apply-phrase-map] ${applied} clés mises à jour`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
