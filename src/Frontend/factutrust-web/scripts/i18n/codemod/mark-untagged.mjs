#!/usr/bin/env node
/**
 * Codemod AST : balise pour i18n les textes et attributs d'affichage encore non balisés des
 * templates (fichiers .html et templates inline), avec des ID personnalisés.
 *
 *  - Élément dont tout le contenu est une phrase (texte, interpolations, éléments en ligne) :
 *    `i18n="@@id"` sur l'élément ; les `i18n` des fragments internes sont retirés, la phrase
 *    devient UN message (ordre des mots libre à la traduction).
 *  - Suite de texte entre des blocs (@if, @for) ou des composants : `<ng-container i18n="@@id">`.
 *  - Attribut d'affichage statique : `i18n-attr="@@id"`.
 *  - Littéral lié `[attr]="'Texte'"` : réécrit en `attr="Texte" i18n-attr="@@id"` (même rendu).
 *
 * Le texte affiché n'est jamais modifié : on ne fait qu'insérer des attributs ou des
 * ng-container transparents (parité FR vérifiée par i18n:parity:template).
 *
 * Usage : node scripts/i18n/codemod/mark-untagged.mjs [--dry-run] [--only=chemin/prefixe]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectTemplates, cookedToRawOffsets, getWebRoot, isTemplateSource, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';
import { findUntagged, setIdenticalWords, staticText } from './_untagged.mjs';

/** Rang des insertions à une même position (voir applyEdits). */
const ORDER = { close: 0, attr: 1, open: 2, replace: 3 };

function prefixFromFile(rel) {
  const clean = s => s.replace(/\.component$/, '').replace(/\.(html|ts)$/, '').replace(/\.component$/, '');
  const m = rel.match(/features\/([^/]+)\/([^/]+)/);
  if (m) return `${m[1]}.${clean(m[2])}`;
  const core = rel.match(/core\/(.+?)(?:\.component)?\.(html|ts)$/);
  if (core) return `core.${core[1].replace(/\//g, '.')}`;
  const shared = rel.match(/shared\/(.+?)(?:\.component)?\.(html|ts)$/);
  if (shared) return `shared.${shared[1].replace(/\//g, '.')}`;
  return 'ui';
}

function slugWords(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
    .replace(/\.+$/, '') || 'texte';
}

/** ID : préfixe + mots + hash de la source brute (deux structures différentes → deux ID). */
function makeId(prefix, words, rawSource) {
  const hash = crypto.createHash('sha1').update(rawSource.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 8);
  return `${prefix}.${slugWords(words)}.${hash}`;
}

/**
 * Retire les attributs `i18n` (contenu) des descendants : la phrase devient un seul message.
 * Le compilateur retire `i18n` des attributs de l'AST (il devient `node.i18n`) : on le retrouve
 * donc dans le texte de la balise ouvrante.
 */
function stripInnerI18n(template, nodes, edits) {
  for (const n of nodes) {
    if (n.startSourceSpan && n.i18n?.constructor?.name === 'Message') {
      const tagStart = n.startSourceSpan.start.offset;
      const tag = template.slice(tagStart, n.startSourceSpan.end.offset);
      const m = /\s+i18n="[^"]*"/.exec(tag) ?? /\s+i18n(?=[\s>/])/.exec(tag);
      if (m) edits.push({ start: tagStart + m.index, end: tagStart + m.index + m[0].length, text: '' });
    }
    if (n.children) stripInnerI18n(template, n.children, edits);
  }
}

/** Position d'insertion d'un attribut dans la balise ouvrante (avant `>` ou `/>`). */
function attrInsertOffset(template, el) {
  let end = el.startSourceSpan.end.offset - 1; // sur '>'
  if (template[end - 1] === '/') end -= 1;
  while (end > 0 && /\s/.test(template[end - 1])) end -= 1;
  return end;
}

export function editsFor(template, label, prefix, stats) {
  const { out, errors } = findUntagged(template, label);
  if (errors.length) {
    stats.skipped.push(`${label} : ${errors[0].msg ?? errors[0]}`);
    return [];
  }
  const edits = [];
  for (const f of out) {
    if (f.kind === 'element-content') {
      const el = f.node;
      const inner = template.slice(el.startSourceSpan.end.offset, el.endSourceSpan?.start.offset ?? el.startSourceSpan.end.offset);
      const words = f.run.map(staticText).join(' ');
      stripInnerI18n(template, f.run, edits);
      edits.push({ start: attrInsertOffset(template, el), end: attrInsertOffset(template, el), text: ` i18n="@@${makeId(prefix, words, inner)}"` });
      stats.element++;
    } else if (f.kind === 'run') {
      const first = f.run[0];
      const last = f.run[f.run.length - 1];
      // fullStart inclut les blancs de tête du texte : ils restent dans le conteneur, rendu identique.
      const start = (first.sourceSpan.fullStart ?? first.sourceSpan.start).offset;
      const end = last.sourceSpan.end.offset;
      const raw = template.slice(start, end);
      const words = f.run.map(staticText).join(' ');
      const id = makeId(prefix, words, raw);
      stripInnerI18n(template, f.run, edits);
      const single = f.run.filter(n => !(n.constructor?.name === 'Text' && !n.value.trim()));
      if (single.length === 1 && single[0].constructor?.name === 'Element' && single[0].name !== 'ng-container') {
        // Un seul élément en ligne : balise directement l'élément.
        const el = single[0];
        edits.push({ start: attrInsertOffset(template, el), end: attrInsertOffset(template, el), text: ` i18n="@@${id}"` });
      } else {
        edits.push({ start, end: start, text: `<ng-container i18n="@@${id}">`, order: ORDER.open });
        edits.push({ start: end, end, text: '</ng-container>', order: ORDER.close });
      }
      stats.run++;
    } else if (f.kind === 'attr') {
      const a = f.attr;
      edits.push({ start: a.sourceSpan.end.offset, end: a.sourceSpan.end.offset, text: ` i18n-${a.name}="@@${makeId(prefix, a.value, `${a.name}=${a.value}`)}"` });
      stats.attr++;
    } else if (f.kind === 'bound-literal') {
      const b = f.input;
      const value = f.value.replace(/"/g, '&quot;');
      edits.push({
        start: b.sourceSpan.start.offset,
        end: b.sourceSpan.end.offset,
        text: `${f.name}="${value}" i18n-${f.name}="@@${makeId(prefix, f.value, `${f.name}=${f.value}`)}"`
      });
      stats.bound++;
    }
  }
  return edits;
}

/**
 * Applique les modifications de la fin vers le début. À position égale, l'ordre final est :
 * fermetures `</ng-container>`, puis insertions d'attributs, puis ouvertures, puis remplacements
 * (sinon une fermeture et une ouverture voisines s'inversent et produisent un conteneur vide).
 * Les doublons (même suppression vue via un Template et son élément) sont fusionnés.
 */
export function applyEdits(text, edits) {
  const seen = new Set();
  const unique = edits.filter(e => {
    const key = `${e.start}:${e.end}:${e.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = e => e.order ?? (e.end > e.start ? ORDER.replace : ORDER.attr);
  const sorted = unique.sort((a, b) => a.start - b.start || rank(a) - rank(b));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) throw new Error(`modifications qui se chevauchent à ${sorted[i].start}`);
  }
  let out = text;
  for (const e of sorted.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Balise un template isolé (tests) : rend le template modifié. */
export function markTemplate(template, prefix = 'test') {
  const stats = { element: 0, run: 0, attr: 0, bound: 0, files: 0, skipped: [] };
  const edits = editsFor(template, 'test.html', prefix, stats);
  if (stats.skipped.length) throw new Error(stats.skipped[0]);
  return applyEdits(template, edits);
}

function main() {
const dryRun = process.argv.includes('--dry-run');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
const WEB = getWebRoot();
setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);

const files = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
const stats = { element: 0, run: 0, attr: 0, bound: 0, files: 0, skipped: [] };
/** Modifications par fichier, en positions absolues du fichier source. */
const byFile = new Map();

for (const t of collectTemplates(files)) {
  if (t.template == null) continue;
  const rel = t.label.split('#')[0];
  if (only && !rel.includes(only)) continue;
  const edits = editsFor(t.template, t.label, prefixFromFile(rel), stats);
  if (!edits.length) continue;
  let fileEdits = edits;
  if (!rel.endsWith('.html')) {
    // Template inline : positions du texte évalué → positions brutes dans le littéral.
    const map = cookedToRawOffsets(files.get(rel).slice(t.rawStart, t.rawEnd), t.template);
    if (!map) {
      stats.skipped.push(`${t.label} : séquence d'échappement non reconnue`);
      continue;
    }
    fileEdits = edits.map(e => ({ ...e, start: t.rawStart + map[e.start], end: t.rawStart + map[e.end] }));
  }
  if (!byFile.has(rel)) byFile.set(rel, []);
  byFile.get(rel).push(...fileEdits);
}

for (const [rel, edits] of byFile) {
  stats.files++;
  const content = applyEdits(files.get(rel), edits);
  if (/<ng-container i18n="[^"]*">\s*<\/ng-container>/.test(content)) throw new Error(`${rel} : conteneur i18n vide produit`);
  if (!dryRun) fs.writeFileSync(path.join(WEB, rel), content, 'utf8');
}
for (const s of stats.skipped) console.warn(`[ignoré] ${s}`);
console.log(
  `[mark-untagged] ${stats.files} fichier(s) : ${stats.element} élément(s), ${stats.run} suite(s), ` +
    `${stats.attr} attribut(s), ${stats.bound} littéral(aux)${dryRun ? ' — simulation' : ''}`
);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
