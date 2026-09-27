#!/usr/bin/env node
/**
 * Codemod AST : enveloppe en `$localize` les littéraux français classés DISPLAY par
 * _ts-literals.mjs (toasts, libellés de menu, en-têtes et messages de dialogue, signaux
 * d'erreur, replis d'extractErrorMessage…). Le texte français rendu est inchangé.
 *
 *  'Texte'                → $localize`:@@préfixe.ts.slug.hash8:Texte`
 *  `Texte ${n} suite`     → $localize`:@@…:Texte ${n}:n: suite`
 *
 * Avec `--approve=fichier.json`, enveloppe à la place les littéraux REVIEW relus fichier par
 * fichier ({ "src/app/…/x.ts": "*" | "**" | { "only": [...] } | { "base": "*", "exclude": [...] } }).
 *
 * Usage : node scripts/i18n/codemod/localize-ts-ast.mjs [--dry-run [--verbose]] [--only=chemin] [--approve=fichier.json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { setIdenticalWords } from './_untagged.mjs';
import { frenchLooking, scanFile } from './_ts-literals.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
    .replace(/\.+$/, '') || 'texte';
}

export function prefixFromFile(rel) {
  const clean = s => s.replace(/\.(component|service|config|page|tab|dialog|vm|utils?|model|models|store|facade)$/, '').replace(/\.ts$/, '');
  const m = rel.match(/features\/([^/]+)\/(?:.*\/)?([^/]+)\.ts$/);
  if (m) return `${m[1]}.${clean(clean(m[2]))}`;
  const other = rel.match(/(core|shared)\/(?:.*\/)?([^/]+)\.ts$/);
  return other ? `${other[1]}.${clean(clean(other[2]))}` : 'ui';
}

/** Échappe un texte pour le corps d'un gabarit `$localize`. */
const escapeCooked = s =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

function placeholderName(expr, used) {
  let base = 'p';
  if (ts.isIdentifier(expr)) base = expr.text;
  else if (ts.isPropertyAccessExpression(expr)) base = expr.name.text;
  else if (ts.isCallExpression(expr)) {
    const c = expr.expression;
    base = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : 'p';
  }
  base = base.replace(/[^A-Za-z0-9_]/g, '') || 'p';
  let name = base;
  let i = 1;
  while (used.has(name)) name = `${base}${i++}`;
  used.add(name);
  return name;
}

/** Remplacement `$localize` d'un littéral (chaîne simple ou gabarit avec ${}). */
export function localizeReplacement(node, prefix) {
  let body;
  let idSource;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    idSource = node.text;
    body = ts.isNoSubstitutionTemplateLiteral(node) ? node.rawText ?? escapeCooked(node.text) : escapeCooked(node.text);
  } else {
    const used = new Set();
    let s = node.head.rawText ?? escapeCooked(node.head.text);
    idSource = node.head.text;
    for (const span of node.templateSpans) {
      const name = placeholderName(span.expression, used);
      s += '${' + span.expression.getText() + '}:' + name + ':' + (span.literal.rawText ?? escapeCooked(span.literal.text));
      idSource += `{${name}}` + span.literal.text;
    }
    body = s;
  }
  const hash = crypto.createHash('sha1').update(idSource).digest('hex').slice(0, 8);
  const id = `${prefix}.ts.${slug(idSource)}.${hash}`;
  // Un message qui commence par « : » serait lu comme un bloc de métadonnées : il y en a déjà un.
  return '$localize`:@@' + id + ':' + body + '`';
}

export function localizeSource(rel, text) {
  const { found } = scanFile(rel, text);
  const edits = found
    .filter(f => f.kind === 'DISPLAY')
    .map(f => ({ start: f.start, end: f.end, text: localizeReplacement(f.node, prefixFromFile(rel)) }));
  return { out: applyEdits(text, edits), count: edits.length };
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** `${n > 1 ? 's' : ''}` : pluriel fabriqué en français, que l'arabe hériterait tel quel. */
function hasFrenchPluralSuffix(node) {
  if (!ts.isTemplateExpression(node)) return false;
  const short = e => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text.length <= 3;
  return node.templateSpans.some(({ expression: e }) => {
    const c = ts.isParenthesizedExpression(e) ? e.expression : e;
    return ts.isConditionalExpression(c) && short(c.whenTrue) && short(c.whenFalse) && (!c.whenTrue.text || !c.whenFalse.text);
  });
}

/**
 * Littéraux REVIEW relus et approuvés pour un fichier. Règle :
 *  - `"*"` : ceux d'aspect français ; `"**"` : tous (dictionnaires de libellés sans accent) ;
 *  - `{ only: [textes] }` : exactement ces textes ;
 *  - `{ base: "*" | "**", exclude: [textes] }` : la base, moins ces textes (`texte@ligne` pour
 *    un seul homonyme, ex. une valeur d'intention identique à un libellé), plus `also: [textes]`
 *    (libellés sans accent que « * » ne retient pas).
 * Les textes sont ceux qu'inventory-ts-literals rend.
 * @returns édits à appliquer, et littéraux laissés à la main (pluriel fabriqué, imbrication).
 */
export function approvedEdits(rel, text, rule) {
  const { found } = scanFile(rel, text);
  const spec = typeof rule === 'string' ? { base: rule } : rule;
  const inBase = f => (spec.base === '**' ? true : frenchLooking(f.text));
  const picked = found.filter(
    f =>
      f.kind === 'REVIEW' &&
      (spec.only
        ? spec.only.includes(f.text)
        : (inBase(f) && !spec.exclude?.includes(f.text) && !spec.exclude?.includes(`${f.text}@${f.line}`)) ||
          spec.also?.includes(f.text))
  );
  const nested = f => picked.some(o => o !== f && o.start <= f.start && f.end <= o.end);
  const encloses = f => picked.some(o => o !== f && f.start <= o.start && o.end <= f.end);
  const manual = [];
  const edits = [];
  for (const f of picked) {
    if (hasFrenchPluralSuffix(f.node) || nested(f) || encloses(f)) manual.push(f);
    else edits.push({ start: f.start, end: f.end, text: localizeReplacement(f.node, prefixFromFile(rel)) });
  }
  return { out: applyEdits(text, edits), count: edits.length, manual, texts: picked.filter(f => !manual.includes(f)).map(f => f.text) };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const approvePath = process.argv.find(a => a.startsWith('--approve='))?.slice(10);
  setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);
  const { listTsFiles } = await import(pathToFileURL(path.join(WEB, 'scripts/i18n/inventory-ts-literals.mjs')).href);
  const approved = approvePath ? JSON.parse(fs.readFileSync(path.resolve(approvePath), 'utf8')) : null;
  let files = 0;
  let total = 0;
  for (const rel of approved ? Object.keys(approved) : listTsFiles()) {
    if (only && !rel.includes(only)) continue;
    const abs = path.join(WEB, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const result = approved ? approvedEdits(rel, text, approved[rel]) : localizeSource(rel, text);
    for (const m of result.manual ?? []) console.warn(`  [à la main] ${rel}:${m.line} ${m.text.slice(0, 80)}`);
    if (dryRun && process.argv.includes('--verbose')) for (const t of result.texts ?? []) console.log(`  ${rel} ← ${t.slice(0, 100)}`);
    if (!result.count) continue;
    files++;
    total += result.count;
    if (!dryRun) fs.writeFileSync(abs, result.out, 'utf8');
  }
  console.log(`[localize-ts-ast] ${total} littéral(aux) dans ${files} fichier(s)${dryRun ? ' — simulation' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
