#!/usr/bin/env node
/**
 * Codemod AST : les interpolations `{{ cond ? 'Texte A' : 'Texte B' }}` portant du texte français
 * deviennent des ICU `{!!(cond), select, true {Texte A} other {Texte B}}` : rendu français
 * identique (la branche vraie si la condition est truthy, sinon l'autre), mais traduisible.
 *
 *  - dans un message i18n existant : l'ICU devient un placeholder du message ; l'ID du message
 *    reçoit le suffixe `.sel` (sa structure change, l'ancienne traduction ne s'applique plus) ;
 *  - hors message : l'ICU est enveloppé dans `<ng-container i18n="@@id">`.
 *
 * Les littéraux sans mot à traduire (symboles, codes, sigles de la liste blanche) sont ignorés.
 * Usage : node scripts/i18n/codemod/ternary-to-select.mjs [--dry-run] [--only=chemin]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ng from '@angular/compiler';
import { collectTemplates, cookedToRawOffsets, getWebRoot, isTemplateSource, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';
import { hasTranslatableWords, setIdenticalWords } from './_untagged.mjs';

const isMessage = n => n?.i18n?.constructor?.name === 'Message';

/** Texte de cas ICU : les accolades y sont interdites (elles délimitent les cas). */
const icuSafe = s => typeof s === 'string' && !/[{}]/.test(s);

function literal(ast) {
  return ast instanceof ng.LiteralPrimitive && typeof ast.value === 'string' ? ast.value : null;
}

/** Trouve les ternaires littéraux convertibles d'un template. */
export function findTernaries(template, url = 'test.html') {
  const parsed = ng.parseTemplate(template, url, { preserveWhitespaces: true, enableLetSyntax: true });
  if (parsed.errors?.length) return { found: [], errors: parsed.errors };
  const found = [];
  const visit = (node, owner) => {
    if (!node) return;
    const nextOwner = isMessage(node) ? node : owner;
    if (node instanceof ng.TmplAstBoundText) {
      const interp = node.value?.ast;
      (interp?.expressions ?? []).forEach((expr, index) => {
        if (!(expr instanceof ng.Conditional)) return;
        const a = literal(expr.trueExp);
        const b = literal(expr.falseExp);
        if (a == null || b == null || !icuSafe(a) || !icuSafe(b)) return;
        if (!hasTranslatableWords(a) && !hasTranslatableWords(b)) return;
        found.push({ expr, index, a, b, owner, textNode: node });
      });
      return;
    }
    if (node instanceof ng.TmplAstElement && ['script', 'style', 'pre', 'textarea', 'code'].includes(node.name)) return;
    for (const key of ['children']) for (const c of node[key] ?? []) visit(c, nextOwner);
    for (const key of ['branches', 'cases']) for (const b of node[key] ?? []) for (const c of b.children ?? []) visit(c, nextOwner);
    for (const key of ['empty', 'placeholder', 'loading', 'error']) for (const c of node[key]?.children ?? []) visit(c, nextOwner);
  };
  for (const n of parsed.nodes) visit(n, null);
  return { found, errors: [] };
}

function makeId(prefix, a, b) {
  const hash = crypto.createHash('sha1').update(`${a}|${b}`).digest('hex').slice(0, 8);
  const slug = `${a} ${b}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
    .replace(/\.+$/, '');
  return `${prefix}.sel.${slug || 'texte'}.${hash}`;
}

/** Modifications (positions dans le template) pour convertir les ternaires. */
export function ternaryEdits(template, prefix = 'test') {
  const { found, errors } = findTernaries(template);
  if (errors.length) return { edits: [], errors };
  const edits = [];
  const renamed = new Set();
  for (const f of found) {
    // Positions absolues des expressions décalées par les CRLF (le lexer les replie) : on repère
    // l'interpolation `{{ … }}` dans le texte brut du nœud et on n'utilise que des positions relatives.
    const nodeStart = f.textNode.sourceSpan.start.offset;
    const raw = template.slice(nodeStart, f.textNode.sourceSpan.end.offset);
    const seg = [...raw.matchAll(/\{\{([\s\S]*?)\}\}/g)][f.index];
    if (!seg) continue;
    const inner = seg[1].trim();
    const exprLen = f.expr.sourceSpan.end - f.expr.sourceSpan.start;
    if (/[\r\n]/.test(inner) || inner.length !== exprLen) continue; // composite (pipe, concaténation…) ou multiligne
    const open = nodeStart + seg.index + 2;
    const close = open + seg[1].length;
    const rel = n => n - f.expr.sourceSpan.start;
    const cond = inner.slice(rel(f.expr.condition.sourceSpan.start), rel(f.expr.condition.sourceSpan.end)).trim();
    const icu = `{!!(${cond}), select, true {${f.a}} other {${f.b}}}`;
    if (f.owner) {
      edits.push({ start: open - 2, end: close + 2, text: icu });
      const tagStart = f.owner.startSourceSpan.start.offset;
      if (!renamed.has(tagStart)) {
        renamed.add(tagStart);
        const tag = template.slice(tagStart, f.owner.startSourceSpan.end.offset);
        const m = /\si18n="@@([^"]+)"/.exec(tag);
        if (m && !m[1].endsWith('.sel')) {
          const at = tagStart + m.index + m[0].length - 1; // avant le guillemet fermant
          edits.push({ start: at, end: at, text: '.sel' });
        }
      }
    } else {
      edits.push({ start: open - 2, end: close + 2, text: `<ng-container i18n="@@${makeId(prefix, f.a, f.b)}">${icu}</ng-container>` });
    }
  }
  return { edits, errors: [] };
}

export function applyEdits(text, edits) {
  const sorted = [...edits].sort((x, y) => y.start - x.start || y.end - x.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function prefixFromFile(rel) {
  const clean = s => s.replace(/\.component$/, '').replace(/\.(html|ts)$/, '').replace(/\.component$/, '');
  const m = rel.match(/features\/([^/]+)\/([^/]+)/);
  if (m) return `${m[1]}.${clean(m[2])}`;
  const other = rel.match(/(core|shared)\/(.+?)(?:\.component)?\.(html|ts)$/);
  return other ? `${other[1]}.${other[2].replace(/\//g, '.')}` : 'ui';
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const WEB = getWebRoot();
  setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);
  const OUT_OF_SCOPE = /features\/(firm|portal|platform|home|legal)\//;
  const files = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
  const byFile = new Map();
  let count = 0;
  for (const t of collectTemplates(files)) {
    if (t.template == null) continue;
    const rel = t.label.split('#')[0];
    if (OUT_OF_SCOPE.test(rel) || (only && !rel.includes(only))) continue;
    const { edits, errors } = ternaryEdits(t.template, prefixFromFile(rel));
    if (errors.length || !edits.length) continue;
    let fileEdits = edits;
    if (!rel.endsWith('.html')) {
      const map = cookedToRawOffsets(files.get(rel).slice(t.rawStart, t.rawEnd), t.template);
      if (!map) {
        console.warn(`[ignoré] ${t.label} : séquence d'échappement non reconnue`);
        continue;
      }
      fileEdits = edits.map(e => ({ ...e, start: t.rawStart + map[e.start], end: t.rawStart + map[e.end] }));
    }
    count += edits.filter(e => e.text.includes('select')).length;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(...fileEdits);
  }
  for (const [rel, edits] of byFile) {
    if (!dryRun) fs.writeFileSync(path.join(WEB, rel), applyEdits(files.get(rel), edits), 'utf8');
    console.log(`  ${rel}`);
  }
  console.log(`[ternary-to-select] ${count} ternaire(s) dans ${byFile.size} fichier(s)${dryRun ? ' — simulation' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
