#!/usr/bin/env node
/**
 * Convertit les littéraux d'affichage simples en $localize (mode conservateur).
 * Usage: localize-ts.mjs <file-or-dir> [--check]
 */
import fs from 'node:fs';
import path from 'node:path';

const checkOnly = process.argv.includes('--check');
const target = process.argv[2];
if (!target) {
  console.error('Usage: localize-ts.mjs <path> [--check]');
  process.exit(1);
}

const DISPLAY_PROPS = new Set([
  'summary',
  'detail',
  'message',
  'header',
  'title',
  'label',
  'placeholder',
  'emptyMessage',
  'ariaLabel',
  'formAriaLabel'
]);

function processTs(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  for (const prop of DISPLAY_PROPS) {
    const re = new RegExp(`(${prop}\\s*:\\s*)'([^'\\\\n]+)'`, 'g');
    src = src.replace(re, (m, pre, text) => {
      if (text.includes('$localize') || text.length > 120) return m;
      if (/^[\\d\\s.,:;%€$+-]+$/.test(text)) return m;
      const id = `${path.basename(file, '.ts')}.${prop}.${text.slice(0, 12).replace(/\\W+/g, '_')}`;
      return `${pre}$localize\`:@@${id}:${text}\``;
    });
  }
  if (src !== original) {
    if (checkOnly) {
      console.log(`[unlocalized] ${file}`);
      return true;
    }
    if (!src.includes('$localize') && original.includes('$localize')) {
      // already had localize
    } else if (!original.includes("from '@angular/localize'") && src.includes('$localize')) {
      src = "/// <reference types=\"@angular/localize\" />\n" + src;
    }
    fs.writeFileSync(file, src, 'utf8');
    console.log(`[localize-ts] ${file}`);
  }
  return false;
}

function walk(p) {
  let flagged = false;
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      flagged = walk(path.join(p, ent.name)) || flagged;
    }
  } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
    flagged = processTs(p) || flagged;
  }
  return flagged;
}

const had = walk(path.resolve(target));
if (checkOnly && had) process.exit(1);
