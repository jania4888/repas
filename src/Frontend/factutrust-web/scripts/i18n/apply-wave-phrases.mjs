#!/usr/bin/env node
/**
 * Applique phrase-map-wave.json (correspondance exacte du français)
 * au catalogue ARB, à l'overlay runtime et aux messages API déjà extraits.
 * Ne remplace pas une traduction arabe existante.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './compile-i18n-runtime.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const phrases = {
  ...JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/phrase-map-wave.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/phrase-map-backend.json'), 'utf8')),
};
const hasArabic = s => /[\u0600-\u06FF]/.test(String(s ?? ''));

const arArbPath = path.join(WEB, 'src/locale/messages.ar.arb');
const frArb = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const arArb = JSON.parse(fs.readFileSync(arArbPath, 'utf8'));
const alreadyArabic = new Set(
  Object.entries(arArb)
    .filter(([, value]) => hasArabic(value))
    .map(([id]) => id)
);
let arbFilled = 0;
for (const [id, fr] of Object.entries(frArb)) {
  if (id.startsWith('@')) continue;
  const ar = phrases[String(fr)];
  if (!ar) continue;
  if (alreadyArabic.has(id)) continue;
  arArb[id] = ar;
  arbFilled++;
}
fs.writeFileSync(arArbPath, JSON.stringify(arArb, null, 2));

const { frById } = buildCatalog();
const overlay = {};
for (const [id, fr] of frById) {
  const ar = phrases[fr];
  if (!ar || alreadyArabic.has(id)) continue;
  overlay[id] = ar;
}
const overlayPath = path.join(WEB, 'scripts/i18n/translations-ar/wave-phrases.json');
fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 2));

const catalogPath = path.resolve(WEB, '../../Backend/FactuTrust.API/Localization/messages.catalog.json');
const messagesPath = path.resolve(WEB, '../../Backend/FactuTrust.API/Localization/messages.ar.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
messages.translations ??= {};
let api = 0;
for (const msg of catalog.messages) {
  const ar = phrases[msg];
  if (!ar || hasArabic(messages.translations[msg])) continue;
  if (/^[A-Za-z0-9_.:]+$/.test(msg)) continue;
  messages.translations[msg] = ar;
  api++;
}
fs.writeFileSync(messagesPath, `${JSON.stringify(messages, null, 2)}\n`);
console.log(`[phrases] arb=${arbFilled} overlay=${Object.keys(overlay).length} api=${api}`);
