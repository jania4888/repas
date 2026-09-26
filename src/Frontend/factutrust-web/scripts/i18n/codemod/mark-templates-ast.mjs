#!/usr/bin/env node
/**
 * Codemod i18n templates via @angular/compiler parseTemplate, then mark-templates.mjs.
 * Usage: node scripts/i18n/codemod/mark-templates-ast.mjs <directory> [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from '@angular/compiler';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const targetDir = process.argv[2];

if (!targetDir) {
  console.error('Usage: mark-templates-ast.mjs <directory> [--check]');
  process.exit(1);
}

const PARSE_OPTS = { preserveWhitespaces: false, escapeHtml: false };

function findInlineTemplateSpans(tsSource) {
  const spans = [];
  const re = /template:\s*`/g;
  let m;
  while ((m = re.exec(tsSource)) !== null) {
    let i = m.index + m[0].length;
    while (i < tsSource.length) {
      const ch = tsSource[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        spans.push({ contentStart: m.index + m[0].length, contentEnd: i });
        break;
      }
      i++;
    }
  }
  return spans;
}

function assertTemplateParses(html, url) {
  parseTemplate(html, url, PARSE_OPTS);
}

function shouldSkipDir(parentDir, name) {
  return name === 'firm' && parentDir.replace(/\\/g, '/').endsWith('/features');
}

function validateTree(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(dir, ent.name)) continue;
      validateTree(p);
    } else if (ent.name.endsWith('.html') && !ent.name.endsWith('-before.html')) {
      const src = fs.readFileSync(p, 'utf8');
      assertTemplateParses(src, p.replace(/\\/g, '/'));
    } else if (ent.name.endsWith('.component.ts')) {
      const src = fs.readFileSync(p, 'utf8');
      for (const span of findInlineTemplateSpans(src)) {
        const fragment = src.slice(span.contentStart, span.contentEnd);
        assertTemplateParses(fragment, `${p.replace(/\\/g, '/')}:inline`);
      }
    }
  }
}

const abs = path.resolve(targetDir);
try {
  validateTree(abs);
} catch (err) {
  console.error(`[mark-templates-ast] parseTemplate failed: ${err.message}`);
  process.exit(1);
}

const delegate = path.join(here, 'mark-templates.mjs');
const args = [delegate, targetDir];
if (checkOnly) args.push('--check');

const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(here, '../../..') });
process.exit(result.status ?? 1);
