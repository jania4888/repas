#!/usr/bin/env node
/**
 * Porte CI : détecte la logique sur libellés français (périmètre société).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ROOT = path.join(WEB, 'src/app');
const SKIP = new Set(['home', 'firm', 'portal', 'virtual-street', 'platform']);
const PATTERNS = [
  /\.label\s*===\s*['"`][^'"`]+['"`]/,
  /\.title\s*===\s*['"`][^'"`]+['"`]/
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walk(p, out);
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

function collectFiles() {
  const files = [];
  const features = path.join(ROOT, 'features');
  if (fs.existsSync(features)) {
    for (const ent of fs.readdirSync(features, { withFileTypes: true })) {
      if (ent.isDirectory() && !SKIP.has(ent.name)) {
        walk(path.join(features, ent.name), files);
      }
    }
  }
  walk(path.join(ROOT, 'core'), files);
  walk(path.join(ROOT, 'shared'), files);
  return files;
}

const hits = [];
for (const file of collectFiles()) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (
      line.includes('erp-i18n:ignore') ||
      line.includes('no-label-logic:ok') ||
      line.includes('typeof') ||
      line.includes("label === 'string'")
    ) {
      return;
    }
    for (const re of PATTERNS) {
      if (re.test(line)) {
        hits.push(`${path.relative(WEB, file)}:${i + 1}: ${line.trim()}`);
      }
    }
  });
}

if (hits.length) {
  console.error(`[no-label-logic] ${hits.length} occurrence(s):`);
  for (const h of hits.slice(0, 80)) console.error(h);
  if (hits.length > 80) console.error(`… et ${hits.length - 80} de plus`);
  process.exit(1);
}
console.log('[no-label-logic] OK');
