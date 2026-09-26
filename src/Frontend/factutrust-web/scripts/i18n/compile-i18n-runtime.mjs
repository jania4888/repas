#!/usr/bin/env node
/**
 * Extrait les @@id + texte FR depuis auth/core/shared et fusionne les traductions AR.
 * Usage: node scripts/i18n/compile-i18n-runtime.mjs [--merge scripts/i18n/translations-ar/*.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(WEB, 'src/assets/i18n/messages.ar.json');
const SCAN_SKIP = new Set([
  'home',
  'firm',
  'portal',
  'virtual-street',
  'platform'
]);

function collectScanDirs() {
  const dirs = [
    path.join(WEB, 'src/app/core'),
    path.join(WEB, 'src/app/shared')
  ];
  const features = path.join(WEB, 'src/app/features');
  if (fs.existsSync(features)) {
    for (const ent of fs.readdirSync(features, { withFileTypes: true })) {
      if (ent.isDirectory() && !SCAN_SKIP.has(ent.name)) {
        dirs.push(path.join(features, ent.name));
      }
    }
  }
  return dirs;
}

function slugIdFromText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return `auto.${(h >>> 0).toString(16)}`;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'i18n') continue;
      walk(p, out);
    } else if (/\.(html|ts)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function collectFromSource(src, frById) {
  const i18nBare = /i18n(?!=-)(?:="@@([^"]+)")?[^>]*>([^<]+)</g;
  let m2;
  while ((m2 = i18nBare.exec(src)) !== null) {
    const id = m2[1] ?? slugIdFromText(m2[2].trim());
    if (id) frById.set(id, m2[2].trim());
  }
  const i18nText = /i18n="@@([^"]+)"[^>]*>([^<]+)</g;
  let m;
  while ((m = i18nText.exec(src)) !== null) {
    frById.set(m[1], m[2].trim());
  }
  const ngContainer = /i18n="@@([^"]+)"[^>]*>([^<]+)<\/ng-container>/g;
  while ((m = ngContainer.exec(src)) !== null) {
    frById.set(m[1], m[2].trim());
  }
  const localize = /\$localize`(?:[^`]*?)@@([^:]+):([^`]+)`/g;
  while ((m = localize.exec(src)) !== null) {
    let text = m[2].trim();
    text = text.replace(/\$\{[^}]+\}:[^:]+/g, match => {
      const ph = match.match(/\$\{([^}]+)\}/);
      return ph ? `{$${ph[1]}}` : match;
    });
    frById.set(m[1], text);
  }
  const attrRe = /i18n-(label|placeholder|aria-label|title|text)="@@([^"]+)"[^>]*\s(?:label|placeholder|aria-label|title|text)="([^"]+)"/g;
  while ((m = attrRe.exec(src)) !== null) {
    frById.set(m[2], m[3].trim());
  }
  const attrRe2 = /(label|placeholder|aria-label|title|text)="([^"]+)"\s+i18n-(?:label|placeholder|aria-label|title|text)="@@([^"]+)"/g;
  while ((m = attrRe2.exec(src)) !== null) {
    frById.set(m[3], m[2].trim());
  }
}

export function loadArabicMerged() {
  const arDir = path.join(WEB, 'scripts/i18n/translations-ar');
  const arMerged = {};
  if (fs.existsSync(arDir)) {
    for (const f of fs.readdirSync(arDir).filter(x => x.endsWith('.json'))) {
      Object.assign(arMerged, JSON.parse(fs.readFileSync(path.join(arDir, f), 'utf8')));
    }
  }
  return arMerged;
}

/** @returns {{ frById: Map<string, string>, arMerged: Record<string, string> }} */
export function buildCatalog() {
  const frById = new Map();
  for (const dir of collectScanDirs()) {
    for (const file of walk(dir)) {
      collectFromSource(fs.readFileSync(file, 'utf8'), frById);
    }
  }
  return { frById, arMerged: loadArabicMerged() };
}

function writeRuntimeJson() {
  const { frById, arMerged } = buildCatalog();
  const translations = {};
  for (const [id, fr] of frById) {
    translations[id] = arMerged[id] ?? arMerged[`@@${id}`] ?? null;
  }

  const missing = Object.entries(translations).filter(([, v]) => !v);
  if (missing.length) {
    console.warn(`[compile-i18n] ${missing.length} traductions AR manquantes (repli FR au runtime)`);
    for (const [id] of missing) {
      translations[id] = frById.get(id) ?? id;
    }
  }

  const body = { locale: 'ar', translations };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(body, null, 2), 'utf8');
  console.log(`Écrit ${OUT} — ${Object.keys(translations).length} clés`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  writeRuntimeJson();
}
