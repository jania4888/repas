#!/usr/bin/env node
/**
 * Ajoute i18n sur les textes simples des fichiers .html et templates inline (*.component.ts).
 * Usage: node scripts/i18n/codemod/mark-templates.mjs <glob-dir> [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
const targetDir = process.argv[2];
if (!targetDir) {
  console.error('Usage: mark-templates.mjs <directory> [--check]');
  process.exit(1);
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

function openingTagEndingAt(src, gtIndex) {
  let i = gtIndex - 1;
  while (i >= 0 && src[i] !== '<') i--;
  return i >= 0 ? src.slice(i, gtIndex + 1) : '';
}

/** @param {string} src HTML fragment */
export function markHtmlContent(src) {
  // Texte direct entre balises (>texte<) sans {{ }}
  src = src.replace(/>([^<>{}\n][^<>{}]*?)<\//g, (match, text, offset) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('{{') || trimmed.includes('i18n')) return match;
    if (/^[\d\s.,:;%€$+-]+$/.test(trimmed)) return match;
    if (offset > 0 && src[offset - 1] === '/') return match;
    const opening = openingTagEndingAt(src, offset);
    if (/\bi18n\b/.test(opening)) return match;
    if (/<\//.test(opening)) return match;
    if (/\/>\s*$/.test(opening)) return match;
    return ` i18n>${trimmed}</`;
  });
  for (const attr of ATTRS) {
    const re = new RegExp(`(?:^|\\s)(${attr})="([^"]+)"(?!\\s+i18n-${attr}=)`, 'g');
    src = src.replace(re, (m, name, value) => {
      if (value.includes('{{')) return m;
      const prefix = m.startsWith(' ') ? ' ' : '';
      return `${prefix}${name}="${value}" i18n-${name}="${value}"`;
    });
  }
  return src;
}

function processHtml(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  src = markHtmlContent(src);
  if (src !== original) {
    if (checkOnly) {
      console.log(`[unmarked] ${file}`);
      return true;
    }
    fs.writeFileSync(file, src, 'utf8');
    console.log(`[updated] ${file}`);
  }
  return false;
}

/** @returns {{ contentStart: number, contentEnd: number }[]} */
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

function processComponentTs(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const spans = findInlineTemplateSpans(src);
  if (spans.length === 0) return false;

  let out = '';
  let last = 0;
  for (const { contentStart, contentEnd } of spans) {
    out += src.slice(last, contentStart);
    const marked = markHtmlContent(src.slice(contentStart, contentEnd));
    out += marked;
    last = contentEnd;
  }
  out += src.slice(last);
  src = out;

  if (src !== original) {
    if (checkOnly) {
      console.log(`[unmarked] ${file}`);
      return true;
    }
    fs.writeFileSync(file, src, 'utf8');
    console.log(`[updated] ${file}`);
  }
  return false;
}

function shouldSkipDir(parentDir, name) {
  return name === 'firm' && parentDir.replace(/\\/g, '/').endsWith('/features');
}

function walk(dir) {
  let changed = false;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(dir, ent.name)) continue;
      changed = walk(p) || changed;
    } else if (ent.name.endsWith('.html') && !ent.name.endsWith('-before.html')) {
      changed = processHtml(p) || changed;
    } else if (ent.name.endsWith('.component.ts')) {
      changed = processComponentTs(p) || changed;
    }
  }
  return changed;
}

const abs = path.resolve(targetDir);
const had = walk(abs);
if (checkOnly && had) process.exit(1);
