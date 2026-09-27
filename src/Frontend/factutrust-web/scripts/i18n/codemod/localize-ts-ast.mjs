#!/usr/bin/env node
/**
 * Codemod AST : enveloppe en `$localize` les littéraux français classés DISPLAY par
 * _ts-literals.mjs (toasts, libellés de menu, en-têtes et messages de dialogue, signaux
 * d'erreur, replis d'extractErrorMessage…). Le texte français rendu est inchangé.
 *
 *  'Texte'                → $localize`:@@préfixe.ts.slug.hash8:Texte`
 *  `Texte ${n} suite`     → $localize`:@@…:Texte ${n}:n: suite`
 *
 * Usage : node scripts/i18n/codemod/localize-ts-ast.mjs [--dry-run] [--only=chemin]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { setIdenticalWords } from './_untagged.mjs';
import { scanFile } from './_ts-literals.mjs';

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
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { out, count: edits.length };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);
  const { listTsFiles } = await import(pathToFileURL(path.join(WEB, 'scripts/i18n/inventory-ts-literals.mjs')).href);
  let files = 0;
  let total = 0;
  for (const rel of listTsFiles()) {
    if (only && !rel.includes(only)) continue;
    const abs = path.join(WEB, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const { out, count } = localizeSource(rel, text);
    if (!count) continue;
    files++;
    total += count;
    if (!dryRun) fs.writeFileSync(abs, out, 'utf8');
  }
  console.log(`[localize-ts-ast] ${total} littéral(aux) dans ${files} fichier(s)${dryRun ? ' — simulation' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
