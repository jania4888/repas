#!/usr/bin/env node
/**
 * Convertit les littéraux d'affichage simples en $localize (mode conservateur).
 * Usage: localize-ts.mjs <file-or-dir> [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { i18nSlug } from './id-slug.mjs';

const checkOnly = process.argv.includes('--check');
const target = process.argv[2];
if (!target) {
  console.error('Usage: localize-ts.mjs <path> [--check]');
  process.exit(1);
}

const DISPLAY_PROPS = new Set(['summary', 'detail', 'acceptLabel', 'rejectLabel']);
const SKIP_DIRS = new Set(['firm', 'portal', 'home', 'legal', 'platform', 'virtual-street', 'node_modules']);

function toMessage(raw, quote) {
  const text = quote === "'" ? raw.replace(/\\'/g, "'") : raw.replace(/\\"/g, '"');
  return text;
}

function localizeLiteral(prop, file, quote) {
  const escaped = quote === "'" ? "(?:\\\\'|[^'\\n])*" : '(?:\\\\"|[^"\\n])*';
  return new RegExp(`(${prop}\\s*:\\s*)${quote}(${escaped})${quote}(?=\\s*[,}\\n])`, 'g');
}

function processTs(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  for (const prop of DISPLAY_PROPS) {
    for (const quote of ["'", '"']) {
      const re = localizeLiteral(prop, file, quote);
      src = src.replace(re, (m, pre, raw) => {
        if (m.includes('$localize') || raw.length > 180 || raw.includes('`') || raw.includes('${')) return m;
        const text = toMessage(raw, quote);
        if (/^[\d\s.,:;%€$+-]+$/.test(text)) return m;
        const id = `${path.basename(file, '.ts')}.${prop}.${i18nSlug(text)}`;
        return `${pre}$localize\`:@@${id}:${text}\``;
      });
    }
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

function processRouteTitles(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  src = src.replace(/\btitle\s*:\s*'((?:\\'|[^'\n])*)'(?=\s*[,}\n])/g, (m, raw) => {
    if (m.includes('$localize') || raw.length > 180 || raw.includes('`')) return m;
    const text = raw.replace(/\\'/g, "'");
    const id = `${path.basename(file, '.ts')}.title.${i18nSlug(text)}`;
    return `title: $localize\`:@@${id}:${text}\``;
  });
  if (src === original) return false;
  if (checkOnly) {
    console.log(`[unlocalized-title] ${file}`);
    return true;
  }
  if (!original.includes('$localize')) {
    src = '/// <reference types="@angular/localize" />\n' + src;
  }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`[localize-title] ${file}`);
  return false;
}

function walk(p) {
  let flagged = false;
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(p))) return false;
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      flagged = walk(path.join(p, ent.name)) || flagged;
    }
  } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
    flagged = processTs(p) || flagged;
    if (p.endsWith('.routes.ts')) flagged = processRouteTitles(p) || flagged;
  }
  return flagged;
}

const had = walk(path.resolve(target));
if (checkOnly && had) process.exit(1);
