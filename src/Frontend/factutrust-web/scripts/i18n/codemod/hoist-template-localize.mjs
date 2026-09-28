#!/usr/bin/env node
/**
 * Angular ne parse pas $localize`...` dans un template inline.
 * Remonte chaque $localize échappé du template vers un champ de classe.
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['firm', 'portal', 'home', 'legal', 'platform', 'virtual-street', 'node_modules']);
const target = process.argv[2];
if (!target) {
  console.error('Usage: hoist-template-localize.mjs <path>');
  process.exit(1);
}

function templateRanges(src) {
  const ranges = [];
  const re = /template\s*:\s*`/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') break;
      i++;
    }
    ranges.push([start, i]);
    re.lastIndex = i + 1;
  }
  return ranges;
}

function inTemplate(ranges, offset) {
  return ranges.some(([a, b]) => offset >= a && offset < b);
}

function propFor(id) {
  return `loc_${id.replace(/[^A-Za-z0-9_]+/g, '_')}`;
}

function hoist(file) {
  let src = fs.readFileSync(file, 'utf8');
  const ranges = templateRanges(src);
  if (!ranges.length) return false;
  const found = new Map();
  const re = /\$localize\\`:@@([^:]+):([^\\`]*)\\`/g;
  const next = src.replace(re, (match, id, text, offset) => {
    if (!inTemplate(ranges, offset)) return match;
    const prop = propFor(id);
    found.set(prop, { id, text });
    return prop;
  });
  if (!found.size || next === src) return false;
  const classMatch = /export class [A-Za-z0-9_]+[^{]*\{/.exec(next);
  if (!classMatch) {
    console.error(`no class ${file}`);
    return false;
  }
  const fields = [...found.entries()]
    .filter(([prop]) => !next.includes(`readonly ${prop} =`))
    .map(([prop, { id, text }]) => `  readonly ${prop} = $localize\`:@@${id}:${text}\`;`)
    .join('\n');
  const at = classMatch.index + classMatch[0].length;
  const out = fields
    ? `${next.slice(0, at)}\n${fields}${next.slice(at)}`
    : next;
  fs.writeFileSync(file, out);
  return true;
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.component.ts')) acc.push(full);
  }
  return acc;
}

const root = path.resolve(target);
const files = fs.statSync(root).isDirectory() ? walk(root) : [root];
let n = 0;
for (const file of files) if (hoist(file)) n++;
console.log(`hoisted ${n} files`);
