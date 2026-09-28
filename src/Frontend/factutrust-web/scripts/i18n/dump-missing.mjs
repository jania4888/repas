#!/usr/bin/env node
/**
 * Messages encore sans traduction arabe valide dans le catalogue, regroupés par texte français
 * (une traduction par texte, appliquée à tous ses ID), avec leurs fichiers pour le contexte.
 *
 * Usage : node scripts/i18n/dump-missing.mjs [--wave=v1] [--out=fichier.json]
 * Prérequis : npm run i18n:extract && npm run i18n:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const wave = arg('wave');
const out = arg('out');

const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(WEB, 'src/assets/i18n/messages.ar.json'), 'utf8')).translations;
const norm = s => s.replace(/\s+/g, ' ').trim();
// Textes à laisser tels quels (sigles, codes, noms propres) : jamais « manquants ».
const identical = new Set(
  JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values
);

const groups = new Map();
for (const [id, text] of Object.entries(fr)) {
  if (id.startsWith('@') || catalog[id]) continue;
  // Libellés internes de ng-bootstrap (hors ERP affiché) : exclus.
  if (id.startsWith('ngb.')) continue;
  const meta = fr[`@${id}`] ?? {};
  if (wave && meta['x-wave'] !== wave) continue;
  const key = norm(String(text));
  // Texte sans lettre (ponctuation, placeholders seuls) : rien à traduire.
  if (!/\p{L}/u.test(key.replace(/\{\$[^}]+\}/g, '')) || identical.has(key) || identical.has(key.replace(/\{\$[^}]+\}/g, '').trim())) continue;
  if (!groups.has(key)) groups.set(key, { text: key, ids: [], files: new Set(), waves: new Set() });
  const g = groups.get(key);
  g.ids.push(id);
  for (const f of meta['x-files'] ?? []) g.files.add(f.replace(/^src\/app\//, ''));
  if (meta['x-wave']) g.waves.add(meta['x-wave']);
}

const rows = [...groups.values()]
  .map(g => ({ text: g.text, ids: g.ids, files: [...g.files].slice(0, 3), waves: [...g.waves] }))
  .sort((a, b) => (a.files[0] ?? '').localeCompare(b.files[0] ?? '') || a.text.localeCompare(b.text));

const json = JSON.stringify(rows, null, 2);
if (out) fs.writeFileSync(out, json, 'utf8');
else process.stdout.write(json);
const ids = rows.reduce((n, r) => n + r.ids.length, 0);
console.error(`[dump-missing] ${rows.length} textes (${ids} ID)${wave ? ` — vague ${wave}` : ''}`);
