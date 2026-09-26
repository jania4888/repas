#!/usr/bin/env node
/**
 * Compare les multiensembles de chaînes littérales TS (périmètre ERP société)
 * entre fr-reference et l'arbre de travail.
 *
 * Usage: node scripts/i18n/verify/ts-fr-parity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FR_REFERENCE_TAG,
  getRepoRoot,
  getWebRoot,
  gitShow,
  repoRelativePath,
  walkCompanyFiles
} from './_lib.mjs';

const web = getWebRoot();
const repo = getRepoRoot();

const STRING_RE =
  /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\$]|\\$|\$(?!\{))*`/g;

function decodeStringLiteral(raw) {
  if (raw.startsWith('`')) {
    return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  const q = raw[0];
  return raw.slice(1, -1).replace(/\\(.)/g, '$1');
}

function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\$localize`[^`]*`/g, '')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
}

function collectTsStrings(source) {
  const cleaned = stripNoise(source);
  const bag = new Map();
  let m;
  STRING_RE.lastIndex = 0;
  while ((m = STRING_RE.exec(cleaned)) !== null) {
    const raw = m[0];
    if (raw.length < 4) continue;
    const decoded = decodeStringLiteral(raw);
    if (decoded.length < 2) continue;
    if (/^[\d\s.,:;%€$+-]+$/.test(decoded)) continue;
    if (/^https?:\/\//i.test(decoded)) continue;
    if (/^[@./\\]/.test(decoded) && !/[\u00C0-\u024F]/.test(decoded)) continue;
    bag.set(decoded, (bag.get(decoded) ?? 0) + 1);
  }
  return bag;
}

function mergeBags(into, from) {
  for (const [k, v] of from) {
    into.set(k, (into.get(k) ?? 0) + v);
  }
}

function bagDiff(ref, work) {
  const added = [];
  const removed = [];
  const keys = new Set([...ref.keys(), ...work.keys()]);
  for (const k of keys) {
    const r = ref.get(k) ?? 0;
    const w = work.get(k) ?? 0;
    if (w > r) added.push({ text: k, delta: w - r });
    if (r > w) removed.push({ text: k, delta: r - w });
  }
  added.sort((a, b) => b.delta - a.delta);
  removed.sort((a, b) => b.delta - a.delta);
  return { added, removed };
}

function stringsForTree(readFile) {
  const bag = new Map();
  const tsFiles = walkCompanyFiles(web, p => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
  for (const file of tsFiles) {
    const src = readFile(file);
    if (src == null) continue;
    mergeBags(bag, collectTsStrings(src));
  }
  return bag;
}

const refBag = stringsForTree(absPath => gitShow(FR_REFERENCE_TAG, repoRelativePath(absPath)));
const workBag = stringsForTree(absPath => {
  if (!fs.existsSync(absPath)) return null;
  return fs.readFileSync(absPath, 'utf8');
});

const { added, removed } = bagDiff(refBag, workBag);
const changed = added.length + removed.length;

if (changed) {
  console.error('[ts-fr-parity] écarts multiset (extrait) :');
  for (const row of added.slice(0, 40)) {
    console.error(`  +${row.delta}  ${JSON.stringify(row.text.slice(0, 120))}`);
  }
  for (const row of removed.slice(0, 40)) {
    console.error(`  -${row.delta}  ${JSON.stringify(row.text.slice(0, 120))}`);
  }
  if (added.length + removed.length > 80) {
    console.error(`  … ${added.length + removed.length - 80} autres`);
  }
}

console.log(
  `[ts-fr-parity] ref=${refBag.size} clés distinctes, work=${workBag.size}, écarts=${changed}`
);
process.exit(changed ? 1 : 0);
