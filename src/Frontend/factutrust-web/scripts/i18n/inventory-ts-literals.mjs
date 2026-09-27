#!/usr/bin/env node
/**
 * Inventaire des littéraux français hors `$localize` dans le TS de l'ERP société, classés
 * DISPLAY / NEVER / REVIEW (voir codemod/_ts-literals.mjs).
 *
 * Usage : node scripts/i18n/inventory-ts-literals.mjs [--list=DISPLAY|REVIEW|NEVER] [--only=chemin] [--json=fichier]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setIdenticalWords } from './codemod/_untagged.mjs';
import { rel, scanFile } from './codemod/_ts-literals.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const list = process.argv.find(a => a.startsWith('--list='))?.slice(7);
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
const jsonOut = process.argv.find(a => a.startsWith('--json='))?.slice(7);
setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);

/** Hors périmètre (espaces forcés en français) et code chargé avant les traductions. */
export const OUT_OF_SCOPE = /src\/app\/(features\/(firm|portal|platform|home|legal|virtual-street)\/|core\/i18n\/)|src\/(environments|main\.ts)|\.spec\.ts$|\.d\.ts$/;

export function listTsFiles(root = path.join(WEB, 'src')) {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) {
        const r = rel(WEB, p);
        if (!OUT_OF_SCOPE.test(r)) out.push(r);
      }
    }
  };
  walk(root);
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const counts = {};
  const reasons = {};
  const rows = [];
  for (const r of listTsFiles()) {
    if (only && !r.includes(only)) continue;
    const { found } = scanFile(r, fs.readFileSync(path.join(WEB, r), 'utf8'));
    for (const f of found) {
      counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      const key = `${f.kind} ${f.reason.replace(/ [^ ]+$/, m => (/\.|\(/.test(m) ? m : ''))}`;
      reasons[key] = (reasons[key] ?? 0) + 1;
      rows.push({ file: f.file, line: f.line, kind: f.kind, reason: f.reason, text: f.text });
      if (list && f.kind === list) console.log(`${f.file}:${f.line}  [${f.reason}]  ${JSON.stringify(f.text).slice(0, 110)}`);
    }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
  console.log('[inventory-ts]', JSON.stringify(counts));
  if (!list) {
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${v}\t${k}`);
  }
}
