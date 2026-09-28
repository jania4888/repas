#!/usr/bin/env node
/**
 * Interdit le CSS physique directionnel dans les scopes ERP verrouillés (RTL).
 * Exceptions : erp-rtl.scss, pluto-rtl.generated.css, commentaire rtl-ok, centrage décoratif.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(fileURLToPath(new URL('../src/app/', import.meta.url)));

const SCOPES = ['core/layout', 'features/dashboard', 'shared/components/page-header'];

const PATTERNS = [
  { re: /(^|[^\w-])margin-left\s*:/, prop: 'margin-left' },
  { re: /(^|[^\w-])margin-right\s*:/, prop: 'margin-right' },
  { re: /(^|[^\w-])padding-left\s*:/, prop: 'padding-left' },
  { re: /(^|[^\w-])padding-right\s*:/, prop: 'padding-right' },
  { re: /(^|[^\w-])text-align\s*:\s*(left|right)\b/, prop: 'text-align: left|right' },
  { re: /^\s*left\s*:/, prop: 'left' },
  { re: /^\s*right\s*:/, prop: 'right' }
];

const ALLOW_LINE = /rtl-ok|translate\(-50%|left:\s*50%|right:\s*50%|-9999px/;
const ALLOW_FILE = /(erp-rtl\.scss|pluto-rtl\.generated\.css)$/;

function* scssFiles(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* scssFiles(p);
    else if (e.endsWith('.scss')) yield p;
  }
}

const violations = [];
for (const scope of SCOPES) {
  const root = join(APP, scope);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const file of scssFiles(root)) {
    scan(file);
  }
}

function scan(file) {
  if (ALLOW_FILE.test(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const { re, prop } of PATTERNS) {
      if (re.test(line)) {
        violations.push(`${relative(APP, file)}:${i + 1}: « ${prop} » (${line.trim().slice(0, 100)})`);
        break;
      }
    }
  });
}

if (violations.length) {
  console.error(`check-erp-physical-css: ${violations.length} violation(s)`);
  violations.forEach(v => console.error(' ', v));
  process.exit(1);
}
console.log('check-erp-physical-css: OK');
