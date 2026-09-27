#!/usr/bin/env node
/**
 * Catalogue runtime AR : messages.ar.json (dev) + messages.ar.<hash>.json + manifest.
 *
 * Clés : les ID extraits par le compilateur Angular (src/locale/messages.fr.arb, `npm run i18n:extract`).
 * Valeur : la traduction arabe *valide*. Sinon l'ID est omis : `$localize` et les templates retombent
 * alors sur la source française, avec les bonnes substitutions. Aucun texte français n'est injecté.
 *
 * Sources de l'arabe, par priorité :
 *   1. scripts/i18n/translations-ar/*.json   (par ID)
 *   2. src/locale/messages.ar.arb            (par ID)
 *   3. scripts/i18n/phrase-map-*.json        (par texte français exact : mémoire de traduction)
 *
 * Usage : node scripts/i18n/build-runtime-translations.mjs [--strict]
 *   --strict : échec si une traduction est rejetée ou si le catalogue dépasse la taille cible.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripIsolates, validateTranslation, wrapIsolates } from './translation-rules.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT_DIR = path.join(WEB, 'src/assets/i18n');
const DEV_OUT = path.join(OUT_DIR, 'messages.ar.json');
const ARB_FR = path.join(WEB, 'src/locale/messages.fr.arb');
const ARB_AR = path.join(WEB, 'src/locale/messages.ar.arb');
const MANUAL_DIR = path.join(WEB, 'scripts/i18n/translations-ar');
const PHRASE_MAPS = ['phrase-map-ar.json', 'phrase-map-wave.json', 'phrase-map-backend.json'].map(f =>
  path.join(WEB, 'scripts/i18n', f)
);
const MANIFEST = path.join(WEB, 'src/app/core/i18n/erp-i18n-manifest.generated.ts');
const REPORT = path.join(WEB, 'scripts/i18n/reports/runtime-build.json');

/** Plafond dur du chargeur (erp-boot-locale.ts MAX_CATALOG_BYTES) et cible de confort. */
const HARD_LIMIT_BYTES = 2 * 1024 * 1024;
const TARGET_BYTES = 1.5 * 1024 * 1024;

const strict = process.argv.includes('--strict');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const bare = id => id.replace(/^@@/, '');
const messageEntries = obj => Object.entries(obj).filter(([k]) => !k.startsWith('@'));

if (!fs.existsSync(ARB_FR)) {
  console.error('[i18n:build] src/locale/messages.fr.arb absent : lancer `npm run i18n:extract`.');
  process.exit(1);
}

const frById = new Map(messageEntries(readJson(ARB_FR)).map(([id, text]) => [bare(id), String(text)]));

const byId = new Map();
if (fs.existsSync(ARB_AR)) {
  for (const [id, ar] of messageEntries(readJson(ARB_AR))) {
    if (ar != null && String(ar).trim()) byId.set(bare(id), { ar: String(ar), source: 'messages.ar.arb' });
  }
}
if (fs.existsSync(MANUAL_DIR)) {
  for (const f of fs.readdirSync(MANUAL_DIR).filter(x => x.endsWith('.json')).sort()) {
    for (const [id, ar] of messageEntries(readJson(path.join(MANUAL_DIR, f)))) {
      if (ar != null && String(ar).trim()) byId.set(bare(id), { ar: String(ar), source: `translations-ar/${f}` });
    }
  }
}
const byText = new Map();
for (const file of PHRASE_MAPS) {
  if (!fs.existsSync(file)) continue;
  for (const [fr, ar] of Object.entries(readJson(file))) {
    if (!byText.has(fr) && ar != null && String(ar).trim()) byText.set(fr, { ar: String(ar), source: path.basename(file) });
  }
}

const translations = {};
const rejected = [];
const counts = { source: frById.size, byId: 0, byText: 0, identical: 0, missing: 0, rejected: 0, orphans: 0 };

for (const [id, fr] of frById) {
  const candidates = [
    byId.has(id) && { ...byId.get(id), kind: 'byId' },
    byText.has(fr.trim()) && { ...byText.get(fr.trim()), kind: 'byText' }
  ].filter(Boolean);
  let outcome = 'missing';
  for (const cand of candidates) {
    const ar = stripIsolates(cand.ar).trim();
    if (ar === fr.trim()) {
      outcome = 'identical';
      break;
    }
    const reason = validateTranslation(fr, ar);
    if (reason) {
      rejected.push({ id, reason, source: cand.source, fr, ar });
      continue;
    }
    translations[id] = wrapIsolates(ar);
    outcome = cand.kind;
    break;
  }
  counts[outcome]++;
}
counts.rejected = rejected.length;
counts.orphans = [...byId.keys()].filter(id => !frById.has(id)).length;

const body = { locale: 'ar', translations };
const serialized = JSON.stringify(body, null, 2);
const bytes = Buffer.byteLength(serialized, 'utf8');
const hash = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 12);
const hashedName = `messages.ar.${hash}.json`;

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) {
  if (/^messages\.ar\.[0-9a-f]{12}\.json$/.test(f) && f !== hashedName) fs.unlinkSync(path.join(OUT_DIR, f));
}
fs.writeFileSync(DEV_OUT, serialized, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, hashedName), serialized, 'utf8');
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(
  MANIFEST,
  `/** Généré par scripts/i18n/build-runtime-translations.mjs — ne pas modifier. */
export const ERP_I18N_MANIFEST = {
  locale: 'ar' as const,
  sha256: '${hash}',
  messagesFile: '${hashedName}',
  messagesUrl: 'assets/i18n/${hashedName}'
} as const;
`,
  'utf8'
);

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify({ counts, bytes, rejected }, null, 2), 'utf8');

const kib = Math.round(bytes / 1024);
console.log(
  `[i18n:build] ${Object.keys(translations).length}/${counts.source} messages traduits ` +
    `(ID ${counts.byId}, mémoire ${counts.byText}) · identiques ${counts.identical} · manquants ${counts.missing} · ` +
    `rejetés ${counts.rejected} · orphelins ${counts.orphans} · ${kib} Kio → ${hashedName}`
);
for (const r of rejected.slice(0, 15)) console.warn(`  [rejet:${r.reason}] ${r.id} (${r.source})`);
if (rejected.length > 15) console.warn(`  … ${rejected.length - 15} autres rejets dans ${path.relative(WEB, REPORT)}`);

if (bytes > HARD_LIMIT_BYTES) {
  console.error(`[i18n:build] ${kib} Kio > plafond du chargeur (2 Mio) : le catalogue serait refusé au démarrage.`);
  process.exit(1);
}
if (strict && (rejected.length || bytes > TARGET_BYTES)) {
  console.error(`[i18n:build] --strict : ${rejected.length} rejet(s), ${kib} Kio (cible ${TARGET_BYTES / 1024} Kio).`);
  process.exit(1);
}
