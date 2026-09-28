#!/usr/bin/env node
/**
 * Extrait les ternaires de chaînes dans les templates vers des getters $localize (signalement).
 * Mode --check : liste les fichiers concernés sans modifier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
const targetDir = process.argv[2];
if (!targetDir) {
  console.error('Usage: extract-bound-literals.mjs <directory> [--check]');
  process.exit(1);
}

const boundRe = /\{\{\s*[^}]+\?\s*'[^']+'\s*:\s*'[^']+'\s*\}\}/g;

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(boundRe);
  if (!hits?.length) return false;
  console.log(`[bound-literals] ${file} (${hits.length})`);
  if (!checkOnly) {
    fs.appendFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'bound-literals.report.txt'),
      `${file}\n${hits.join('\n')}\n\n`
    );
  }
  return true;
}

function walk(dir) {
  let any = false;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) any = walk(p) || any;
    else if (ent.name.endsWith('.html')) any = scan(p) || any;
  }
  return any;
}

const had = walk(path.resolve(targetDir));
if (checkOnly && had) process.exit(1);
