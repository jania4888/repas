#!/usr/bin/env node
/**
 * Réparation : rétablit les espaces de bord rognés dans les nœuds texte, d'après l'alignement
 * exact avec la référence fr-static. N'ajoute que des espaces aux bords d'un nœud dont le texte
 * est par ailleurs identique ; tout autre écart est laissé à la revue manuelle.
 *
 *   node scripts/i18n/verify/restore-fr-whitespace.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalTemplate,
  collectTemplates,
  cookedToRawOffsets,
  diffOps,
  getWebRoot,
  isTemplateSource,
  listWorkFiles,
  readWorkFile,
  sha256
} from './_lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const web = getWebRoot();
const baselineDir = path.join(web, 'e2e/baselines/fr-static');
const manifest = JSON.parse(fs.readFileSync(path.join(baselineDir, 'manifest.json'), 'utf8'));

const textOf = line => {
  const m = /^\s*#(?:text|bound) (".*")$/.exec(line);
  return m ? JSON.parse(m[1]) : null;
};

/** Insertions { offset, text } à appliquer au template pour retrouver les espaces de la référence. */
function whitespaceEdits(refLines, work) {
  const ops = diffOps(refLines, work.lines);
  if (!ops) return { edits: [], skipped: 1 };
  const edits = [];
  let skipped = 0;
  for (let k = 0; k < ops.length; ) {
    if (ops[k].t === ' ') {
      k++;
      continue;
    }
    const minus = [];
    const plus = [];
    while (k < ops.length && ops[k].t !== ' ') {
      (ops[k].t === '-' ? minus : plus).push(ops[k]);
      k++;
    }
    const paired =
      minus.length === plus.length &&
      minus.every((m, idx) => {
        const a = textOf(m.s);
        const b = textOf(plus[idx].s);
        return a != null && b != null && a.trim() === b.trim() && a.trim() !== '';
      });
    if (!paired) {
      skipped++;
      continue;
    }
    minus.forEach((m, idx) => {
      const ref = textOf(m.s);
      const cur = textOf(plus[idx].s);
      const node = work.nodes.get(plus[idx].j);
      if (!node) {
        skipped++;
        return;
      }
      if (ref.startsWith(' ') && !cur.startsWith(' ')) {
        edits.push({ offset: node.sourceSpan.start.offset, text: ' ' });
      }
      if (ref.endsWith(' ') && !cur.endsWith(' ')) {
        edits.push({ offset: node.sourceSpan.end.offset, text: ' ' });
      }
      if ((!ref.startsWith(' ') && cur.startsWith(' ')) || (!ref.endsWith(' ') && cur.endsWith(' '))) {
        skipped++;
      }
    });
  }
  return { edits, skipped };
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, e.offset) + e.text + out.slice(e.offset);
  }
  return out;
}

const workFiles = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
const templates = collectTemplates(workFiles);
const fileEdits = new Map();
let fixedTemplates = 0;
let insertions = 0;
let skippedTotal = 0;

for (const t of templates) {
  if (t.unsupported || !manifest.templates[t.label]) continue;
  const work = canonicalTemplate(t.template, t.label, { withNodes: true });
  const text = work.lines.join('\n') + '\n';
  if (sha256(text) === manifest.templates[t.label]) continue;
  const refLines = fs
    .readFileSync(path.join(baselineDir, 'templates', `${t.label}.txt`), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n');
  const { edits, skipped } = whitespaceEdits(refLines, work);
  skippedTotal += skipped;
  if (!edits.length) continue;
  const rel = t.label.split('#')[0];
  let toFileOffset = offset => offset;
  if (!rel.endsWith('.html')) {
    const map = cookedToRawOffsets(workFiles.get(rel).slice(t.rawStart, t.rawEnd), t.template);
    if (!map) {
      console.warn(`[ignoré] ${t.label} : séquence d'échappement non reconnue, à corriger à la main`);
      continue;
    }
    toFileOffset = offset => t.rawStart + map[offset];
  }
  const list = fileEdits.get(rel) ?? [];
  for (const e of edits) list.push({ offset: toFileOffset(e.offset), text: e.text });
  fileEdits.set(rel, list);
  fixedTemplates++;
  insertions += edits.length;
}

if (!dryRun) {
  for (const [rel, edits] of fileEdits) {
    fs.writeFileSync(path.join(web, rel), applyEdits(workFiles.get(rel), edits), 'utf8');
  }
}
console.log(
  `[restore-fr-whitespace] ${fixedTemplates} template(s), ${insertions} espace(s) rétabli(s)` +
    `${dryRun ? ' (simulation)' : ''} ; ${skippedTotal} écart(s) laissé(s) à la revue`
);
