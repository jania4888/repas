#!/usr/bin/env node
/**
 * Donne un ID personnalisé à chaque message i18n de template qui n'en a pas (`i18n`, `i18n-x`),
 * via le parseur HTML d'Angular (positions exactes, templates .html et inline).
 *
 *   i18n-title="Remplacement de compte"  →  i18n-title="@@accounting.account-replacement.remplacement.de.compte.1a2b3c4d"
 *   i18n-label (sans valeur)             →  i18n-label="@@…"
 *   i18n="Une vraie description"         →  i18n="Une vraie description@@…"
 *
 * Une valeur identique au texte est un artefact de codemod (le texte pris pour *meaning*) : elle est
 * remplacée. Le texte affiché n'est jamais modifié : rendu français identique.
 *
 * Usage : node scripts/i18n/codemod/assign-custom-ids.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ng from '@angular/compiler';
import { collectTemplates, cookedToRawOffsets, getWebRoot, isTemplateSource, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';
import { i18nSlug } from './id-slug.mjs';

const checkOnly = process.argv.includes('--check');
const WEB = getWebRoot();
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function prefixFromFile(rel) {
  const stripComponent = s => s.replace(/\.component$/, '').replace(/\.(html|ts)$/, '').replace(/\.component$/, '');
  const m = rel.match(/features\/([^/]+)\/([^/]+)/);
  if (m) return `${m[1]}.${stripComponent(m[2])}`;
  const core = rel.match(/core\/(.+?)(?:\.component)?\.(html|ts)$/);
  if (core) return `core.${core[1].replace(/\//g, '.')}`;
  const shared = rel.match(/shared\/(.+?)(?:\.component)?\.(html|ts)$/);
  if (shared) return `shared.${shared[1].replace(/\//g, '.')}`;
  return 'ui';
}

/** Modifications { start, end, text } sur le template (positions du texte évalué). */
function editsFor(template, url, prefix, report) {
  const parsed = new ng.HtmlParser().parse(template, url, { tokenizeExpansionForms: true });
  if (parsed.errors?.length) {
    report.skipped.push(`${url} : ${parsed.errors[0].msg}`);
    return [];
  }
  const edits = [];
  const visit = nodes => {
    for (const node of nodes ?? []) {
      for (const attr of node.attrs ?? []) {
        if (attr.name !== 'i18n' && !attr.name.startsWith('i18n-')) continue;
        if (attr.value.includes('@@')) continue;
        let text;
        if (attr.name === 'i18n') {
          if (!node.endSourceSpan || !node.startSourceSpan) continue;
          text = norm(template.slice(node.startSourceSpan.end.offset, node.endSourceSpan.start.offset));
        } else {
          const target = (node.attrs ?? []).find(a => a.name === attr.name.slice('i18n-'.length));
          if (!target) {
            report.skipped.push(`${url} : ${attr.name} sans attribut statique ${attr.name.slice(5)}`);
            continue;
          }
          text = norm(target.value);
        }
        if (!text) continue;
        const id = `${prefix}.${i18nSlug(text)}`;
        const current = norm(attr.value);
        const keep = current && current !== text ? `${attr.value.trim()}` : '';
        const value = `${keep}@@${id}`;
        if (attr.valueSpan) {
          edits.push({ start: attr.valueSpan.start.offset, end: attr.valueSpan.end.offset, text: value });
        } else {
          edits.push({ start: attr.keySpan.end.offset, end: attr.keySpan.end.offset, text: `="${value}"` });
        }
        report.count++;
        if (keep) report.keptDescriptions++;
      }
      if (node.children) visit(node.children);
      if (node.cases) for (const c of node.cases) visit(c.expression);
    }
  };
  visit(parsed.rootNodes);
  return edits;
}

const files = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
const report = { count: 0, keptDescriptions: 0, files: 0, skipped: [] };
const fileEdits = new Map();

for (const t of collectTemplates(files)) {
  if (t.template == null) continue;
  const rel = t.label.split('#')[0];
  const edits = editsFor(t.template, t.label, prefixFromFile(rel), report);
  if (!edits.length) continue;
  let toFile = offset => offset;
  if (!rel.endsWith('.html')) {
    const map = cookedToRawOffsets(files.get(rel).slice(t.rawStart, t.rawEnd), t.template);
    if (!map) {
      report.skipped.push(`${t.label} : séquence d'échappement non reconnue`);
      continue;
    }
    toFile = offset => t.rawStart + map[offset];
  }
  const list = fileEdits.get(rel) ?? [];
  for (const e of edits) list.push({ start: toFile(e.start), end: toFile(e.end), text: e.text });
  fileEdits.set(rel, list);
}

for (const [rel, edits] of fileEdits) {
  let out = files.get(rel);
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  report.files++;
  if (!checkOnly) fs.writeFileSync(path.join(WEB, rel), out, 'utf8');
}

for (const s of report.skipped) console.warn(`[ignoré] ${s}`);
console.log(
  `[assign-custom-ids] ${report.count} message(s) dans ${report.files} fichier(s)` +
    ` (${report.keptDescriptions} description(s) conservée(s))${checkOnly ? ' — simulation' : ''}`
);
process.exit(checkOnly && report.count ? 1 : 0);
