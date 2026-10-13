#!/usr/bin/env node
/**
 * Parité statique du français : chaque template du périmètre société doit rendre exactement le
 * même texte, les mêmes attributs statiques (hors i18n*) et la même structure qu'à fr-reference.
 *
 *   node scripts/i18n/verify/template-fr-parity.mjs                  compare à la référence versionnée
 *   node scripts/i18n/verify/template-fr-parity.mjs --write-baseline régénère la référence (tag requis)
 *   node scripts/i18n/verify/template-fr-parity.mjs --json out.json  rapport machine
 *
 * Les écarts relus et acceptés se déclarent dans e2e/baselines/fr-static/approved.json :
 *   { "<label>": { "sha": "<empreinte du canonique courant>", "reason": "…" } }
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FR_REFERENCE_TAG,
  canonicalTemplate,
  classifyMissingReference,
  collectTemplates,
  getWebRoot,
  inlineStaticTextFields,
  isTemplateSource,
  staticTextFields,
  lineDiff,
  listWorkFiles,
  readRefFiles,
  readWorkFile,
  refCommit,
  sha256
} from './_lib.mjs';

const args = process.argv.slice(2);
const writeBaseline = args.includes('--write-baseline');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const maxHunks = Number(args.find(a => a.startsWith('--hunks='))?.split('=')[1] ?? 3);

const web = getWebRoot();
const baselineDir = path.join(web, 'e2e/baselines/fr-static');
const manifestPath = path.join(baselineDir, 'manifest.json');
const approvedPath = path.join(baselineDir, 'approved.json');

const baselineFile = label => path.join(baselineDir, 'templates', `${label}.txt`);

/** Référence canonique des templates, recalculée depuis le commit de référence (non versionnée). */
function writeBaselineFiles() {
  const refFiles = readRefFiles(isTemplateSource);
  const templates = collectTemplates(refFiles);
  fs.rmSync(path.join(baselineDir, 'templates'), { recursive: true, force: true });
  const index = {};
  let parseErrors = 0;
  for (const t of templates) {
    if (t.unsupported) continue;
    const { lines, errors } = canonicalTemplate(t.template, t.label);
    if (errors.length) {
      parseErrors++;
      console.warn(`[référence] ${t.label} : ${errors[0]}`);
    }
    const text = lines.join('\n') + '\n';
    const file = baselineFile(t.label);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    index[t.label] = sha256(text);
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ ref: FR_REFERENCE_TAG, commit: refCommit(), templates: index }, null, 2) + '\n',
    'utf8'
  );
  console.log(
    `[template-fr-parity] référence ${FR_REFERENCE_TAG} : ${Object.keys(index).length} templates (${parseErrors} avec erreurs d'analyse)`
  );
}

if (writeBaseline) {
  writeBaselineFiles();
  process.exit(0);
}

const currentRef = refCommit();
if (!currentRef) {
  console.error(`[template-fr-parity] référence ${FR_REFERENCE_TAG} introuvable (tag absent ? voir I18N_FR_REFERENCE).`);
  process.exit(2);
}
if (!fs.existsSync(manifestPath) || JSON.parse(fs.readFileSync(manifestPath, 'utf8')).commit !== currentRef) {
  writeBaselineFiles();
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const approved = fs.existsSync(approvedPath) ? JSON.parse(fs.readFileSync(approvedPath, 'utf8')) : {};
const workFiles = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
const workTemplates = collectTemplates(workFiles);

/** Champs à texte français statique du composant qui porte le template (inline ou .html voisin). */
const fieldsCache = new Map();
function fieldsFor(label) {
  const tsRel = label.includes('#') ? label.split('#')[0] : label.replace(/\.html$/, '.ts');
  if (!fieldsCache.has(tsRel)) {
    const source = workFiles.get(tsRel);
    fieldsCache.set(tsRel, source ? staticTextFields(tsRel, source) : new Map());
  }
  return fieldsCache.get(tsRel);
}

const report = { diffs: [], parseErrors: [], added: [], removed: [], approved: [], deleted: [] };
const seen = new Set();

for (const t of workTemplates) {
  if (t.unsupported) {
    report.parseErrors.push({ label: t.label, error: 'template non littéral (non analysable)' });
    continue;
  }
  seen.add(t.label);
  const resolved = inlineStaticTextFields(t.template, t.label, fieldsFor(t.label));
  const { lines, errors } = canonicalTemplate(resolved, t.label);
  if (errors.length) report.parseErrors.push({ label: t.label, error: errors[0] });
  const text = lines.join('\n') + '\n';
  const refSha = manifest.templates[t.label];
  if (!refSha) {
    report.added.push(t.label);
    continue;
  }
  if (refSha === sha256(text)) continue;
  const workSha = sha256(text);
  if (approved[t.label]?.sha === workSha) {
    report.approved.push(t.label);
    continue;
  }
  // Les références peuvent être extraites en CRLF (core.autocrlf) : comparer ligne à ligne en LF.
  const refLines = fs.readFileSync(baselineFile(t.label), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  report.diffs.push({ label: t.label, sha: workSha, hunks: lineDiff(refLines, lines) });
}
// Une suppression de composant est un écart comme un autre : elle doit être APPROUVÉE, pas subie.
// L'approbation porte `removed: true` et un motif — sans quoi un composant disparu passerait pour
// une référence manquante, et la porte deviendrait infranchissable sans déplacer le tag de
// référence, qui est partagé avec les autres branches.
for (const label of Object.keys(manifest.templates)) {
  if (seen.has(label)) continue;
  const verdict = classifyMissingReference(approved[label]);
  report[verdict === 'deleted' ? 'deleted' : 'removed'].push(label);
}

for (const d of report.diffs) {
  console.error(`\n[écart] ${d.label} (${d.hunks.length} bloc(s))`);
  for (const h of d.hunks.slice(0, maxHunks)) {
    console.error(`  @@ ligne ${h.first + 1}`);
    for (const l of h.lines) console.error(`  ${l}`);
  }
  if (d.hunks.length > maxHunks) console.error(`  … ${d.hunks.length - maxHunks} autre(s) bloc(s)`);
}
for (const e of report.parseErrors) console.error(`[analyse] ${e.label} : ${e.error}`);
for (const label of report.removed) console.error(`[supprimé] ${label}`);
for (const label of report.deleted) {
  console.log(`[suppression approuvée] ${label} — ${approved[label].reason ?? 'sans motif'}`);
}
if (report.added.length) console.log(`[info] ${report.added.length} template(s) sans référence (nouveaux)`);

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');

const failures = report.diffs.length + report.parseErrors.length + report.removed.length;
console.log(
  `[template-fr-parity] ${workTemplates.length} templates : ${report.diffs.length} écart(s), ` +
    `${report.parseErrors.length} erreur(s) d'analyse, ${report.removed.length} supprimé(s), ` +
    `${report.approved.length} écart(s) approuvé(s), ${report.deleted.length} suppression(s) approuvée(s)`
);
process.exit(failures ? 1 : 0);
