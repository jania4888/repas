#!/usr/bin/env node
/**
 * Inventaire AST des textes et attributs d'affichage non balisés pour i18n (périmètre société).
 *
 * Usage : node scripts/i18n/inventory-untagged.mjs [--list=kind] [--json=out.json]
 */
import fs from 'node:fs';
import { collectTemplates, isTemplateSource, listWorkFiles, readWorkFile } from './verify/_lib.mjs';
import path from 'node:path';
import { findUntagged, setIdenticalWords, staticText } from './codemod/_untagged.mjs';
import { getWebRoot } from './verify/_lib.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const listKind = arg('list');
const jsonOut = arg('json');

setIdenticalWords(JSON.parse(fs.readFileSync(path.join(getWebRoot(), 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);
const files = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
const counts = {};
const rows = [];
let errors = 0;
for (const t of collectTemplates(files)) {
  if (t.template == null) continue;
  const { out, errors: errs } = findUntagged(t.template, t.label);
  if (errs.length) {
    errors++;
    continue;
  }
  for (const f of out) {
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    const text =
      f.kind === 'attr' ? `${f.attr.name}="${f.attr.value}"`
        : f.kind === 'bound-literal' ? `[${f.input.name}]="'${f.value}'"`
          : f.run.map(staticText).join(' ').replace(/\s+/g, ' ').trim();
    rows.push({ kind: f.kind, file: t.label.replace(/^src\/app\//, ''), el: f.node?.name ?? '(bloc)', text });
  }
}
if (listKind) for (const r of rows.filter(r => r.kind === listKind)) console.log(`${r.file} <${r.el}> ${r.text.slice(0, 120)}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
console.log(`[inventory-untagged] ${JSON.stringify(counts)} ; templates non analysables : ${errors}`);
