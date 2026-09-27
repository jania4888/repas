#!/usr/bin/env node
/** Remet en littéral les $localize posés sur des classes, variables CSS ou symboles. */
import fs from 'node:fs';
import path from 'node:path';

function isCode(text) {
  if (/var\(--/.test(text)) return true;
  const t = text.trim();
  if (t === '&times;' || t === '&#9660;' || t === '&gt;90j') return true;
  if (/^Ctrl\+/.test(t)) return true;
  if (/^[a-z0-9 _-]+$/.test(t) && /-|modal|metric-tile|(^| )btn( |$)|icon/.test(t)) return true;
  return false;
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (ent.name.endsWith('.component.ts')) acc.push(full);
  }
  return acc;
}

const re = /readonly (loc_[A-Za-z0-9_]+) = \$localize`:@@[^:]+:([^`]*)`;/g;
let n = 0;
for (const file of walk(path.resolve(process.argv[2] ?? 'src/app'))) {
  const src = fs.readFileSync(file, 'utf8');
  let changed = false;
  const next = src.replace(re, (match, prop, text) => {
    if (!isCode(text)) return match;
    changed = true;
    return `readonly ${prop} = ${JSON.stringify(text)};`;
  });
  if (changed) {
    fs.writeFileSync(file, next);
    n++;
  }
}
console.log(`restored code literals in ${n} files`);
