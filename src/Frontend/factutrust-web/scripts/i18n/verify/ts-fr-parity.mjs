#!/usr/bin/env node
/**
 * Parité statique du français côté TypeScript : pour chaque fichier du périmètre société, le
 * multiensemble des segments de texte français doit être identique à fr-reference.
 *
 * Segment : valeur d'un littéral chaîne, partie fixe d'un gabarit, ou partie fixe d'un `$localize`
 * (sans le bloc `:meaning|desc@@id:` ni les noms de placeholders `:nom:`). Ainsi
 * `'Erreur : ' + msg` et `$localize`:@@x:Erreur : ${msg}:msg:`` donnent le même segment,
 * alors qu'un espace rogné ou un mot changé ressort.
 *
 * Exclus : templates de composants (couverts par template-fr-parity) et champs `loc_*`
 * (littéraux remontés des templates, résolus par template-fr-parity).
 *
 *   node scripts/i18n/verify/ts-fr-parity.mjs [--json out.json]
 *
 * Écarts relus et acceptés : scripts/i18n/verify/ts-fr-parity.approved.json
 *   { "<fichier>": { "sha": "<empreinte de l'écart>", "reason": "…" } }
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getWebRoot, listWorkFiles, readRefFiles, readWorkFile, sha256 } from './_lib.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const approvedPath = path.join(getWebRoot(), 'scripts/i18n/verify/ts-fr-parity.approved.json');
const approved = fs.existsSync(approvedPath) ? JSON.parse(fs.readFileSync(approvedPath, 'utf8')) : {};

const isTs = rel => rel.endsWith('.ts') && !rel.endsWith('.spec.ts') && !rel.includes('.generated.');
const hasLetter = s => /[A-Za-zÀ-ÿ]/.test(s);

function propertyName(node) {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null;
}

function isExcluded(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const name = propertyName(parent);
    if (['template', 'styles', 'selector', 'templateUrl', 'styleUrl', 'styleUrls'].includes(name)) return true;
  }
  if (ts.isArrayLiteralExpression(parent) && ts.isPropertyAssignment(parent.parent) && propertyName(parent.parent) === 'styles') return true;
  if (ts.isPropertyDeclaration(parent) && parent.initializer === node && propertyName(parent)?.startsWith('loc_')) return true;
  return false;
}

/** Segments français d'un fichier : Map<texte, nombre>. */
function segments(rel, source) {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bag = new Map();
  const add = text => {
    if (text && hasLetter(text)) bag.set(text, (bag.get(text) ?? 0) + 1);
  };
  const visit = node => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === '$localize') {
      if (isExcluded(node)) return;
      const tpl = node.template;
      if (ts.isNoSubstitutionTemplateLiteral(tpl)) {
        add(tpl.text.replace(/^:[^:]*:/, ''));
      } else {
        add(tpl.head.text.replace(/^:[^:]*:/, ''));
        for (const span of tpl.templateSpans) add(span.literal.text.replace(/^:[^:]*:/, ''));
      }
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isExcluded(node)) add(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (isExcluded(node)) return;
      add(node.head.text);
      for (const span of node.templateSpans) {
        visit(span.expression);
        add(span.literal.text);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bag;
}

function bagDiff(ref, work) {
  const rows = [];
  for (const k of new Set([...ref.keys(), ...work.keys()])) {
    const d = (work.get(k) ?? 0) - (ref.get(k) ?? 0);
    if (d) rows.push({ text: k, delta: d });
  }
  return rows.sort((a, b) => a.text.localeCompare(b.text) || a.delta - b.delta);
}

const refFiles = readRefFiles(isTs);
const workRels = listWorkFiles(isTs);
const report = { diffs: [], approved: [], removedFiles: [], addedFiles: [], global: [] };
const globalRef = new Map();
const globalWork = new Map();
const merge = (into, bag) => {
  for (const [k, v] of bag) into.set(k, (into.get(k) ?? 0) + v);
};
for (const [rel, source] of refFiles) merge(globalRef, segments(rel, source));

for (const rel of workRels) {
  const work = segments(rel, readWorkFile(rel));
  merge(globalWork, work);
  if (!refFiles.has(rel)) {
    report.addedFiles.push(rel);
    continue;
  }
  const rows = bagDiff(segments(rel, refFiles.get(rel)), work);
  if (!rows.length) continue;
  const sha = sha256(JSON.stringify(rows));
  if (approved[rel]?.sha === sha) {
    report.approved.push(rel);
    continue;
  }
  report.diffs.push({ file: rel, sha, rows });
}
for (const rel of refFiles.keys()) if (!workRels.includes(rel)) report.removedFiles.push(rel);
// Bilan tous fichiers confondus, en présence : un texte déplacé ou factorisé dans une constante
// partagée n'est ni perdu ni nouveau ; seul un texte qui n'existe plus (ou pas encore) nulle part ressort.
report.global = [
  ...[...globalRef.keys()].filter(k => !globalWork.has(k)).map(text => ({ text, delta: -1 })),
  ...[...globalWork.keys()].filter(k => !globalRef.has(k)).map(text => ({ text, delta: 1 }))
].sort((a, b) => a.text.localeCompare(b.text));

for (const d of report.diffs) {
  console.error(`\n[écart] ${d.file}`);
  for (const r of d.rows.slice(0, 12)) console.error(`  ${r.delta > 0 ? '+' : ''}${r.delta}  ${JSON.stringify(r.text.slice(0, 140))}`);
  if (d.rows.length > 12) console.error(`  … ${d.rows.length - 12} autre(s)`);
}
for (const f of report.removedFiles) console.error(`[supprimé] ${f}`);
if (report.addedFiles.length) console.log(`[info] ${report.addedFiles.length} fichier(s) TS nouveaux (sans référence)`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');

const lost = report.global.filter(r => r.delta < 0).length;
const added = report.global.filter(r => r.delta > 0).length;
console.log(`[ts-fr-parity] bilan global : ${lost} segment(s) disparu(s), ${added} apparu(s) (--json pour le détail)`);
console.log(
  `[ts-fr-parity] ${workRels.length} fichiers : ${report.diffs.length} écart(s), ` +
    `${report.removedFiles.length} supprimé(s), ${report.approved.length} écart(s) approuvé(s)`
);
process.exit(report.diffs.length || report.removedFiles.length ? 1 : 0);
