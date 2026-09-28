#!/usr/bin/env node
/**
 * Localise chaque branche française d'un ternaire, pas l'expression.
 * Dans un template inline, les backticks de $localize sont échappés.
 * Usage: node localize-ternaries.mjs <dir-or-file>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['firm', 'portal', 'home', 'legal', 'platform', 'virtual-street', 'node_modules']);
const target = process.argv[2];
if (!target) {
  console.error('Usage: localize-ternaries.mjs <path>');
  process.exit(1);
}

function shouldLocalize(text) {
  if (text.length < 2 || text.length > 180) return false;
  if (text.includes('${') || text.includes('`') || text.includes('\\')) return false;
  if (/^(pi[ -]|fa-)/.test(text)) return false;
  if (/\d+(?:vh|rem|px|em|ms|vw|%)\b/.test(text)) return false;
  if (/^(warn|error|info|success|danger|secondary|contrast|primary|OK|shortDate|mediumDate|longDate|fullDate|shortTime|mediumTime|number|currency|percent)$/.test(text)) return false;
  if (/var\(--|===|\(\)|document:/.test(text)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(text)) return false;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(text)) return false;
  return /[\p{L}]{3,}/u.test(text);
}

function idFor(text) {
  const slug = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 42);
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 6);
  return `ui.tern.${slug || 'texte'}.${hash}`;
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

function isTernaryAlternate(src, offset) {
  let j = offset - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  const prev = src[j] ?? '';
  if (prev === ')' || prev === ']' || prev === '}') {
    const open = prev === ')' ? '(' : prev === ']' ? '[' : '{';
    let depth = 1;
    j--;
    while (j >= 0 && depth > 0) {
      if (src[j] === prev) depth++;
      else if (src[j] === open) depth--;
      j--;
    }
  } else if (prev === "'" || prev === '"' || prev === '`') {
    const q = prev;
    j--;
    while (j >= 0) {
      if (src[j] === '\\') { j -= 2; continue; }
      if (src[j] === q) { j--; break; }
      j--;
    }
  } else {
    return false;
  }
  while (j >= 0 && /\s/.test(src[j])) j--;
  let depth = 0;
  while (j >= 0) {
    const c = src[j];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0 && (c === ',' || c === ';' || c === '\n')) return false;
    else if (depth === 0 && c === '?' && src[j + 1] !== '.' && src[j - 1] !== '?') return true;
    j--;
  }
  return false;
}

function localizeFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  for (const quote of ["'", '"']) {
    const ranges = templateRanges(src);
    const escaped = quote === "'" ? "(?:\\\\'|[^'\\n])*?" : '(?:\\\\"|[^"\\n])*?';
    const re = new RegExp(`(\\?\\s*|:\\s*)${quote}(${escaped})${quote}`, 'g');
    src = src.replace(re, (match, pre, raw, offset) => {
      if (pre.startsWith(':') && !isTernaryAlternate(src, offset)) return match;
      const lookbehind = src.slice(Math.max(0, offset - 20), offset);
      if (lookbehind.includes('$localize') || lookbehind.includes('i18n')) return match;
      const text = quote === "'" ? raw.replace(/\\'/g, "'") : raw.replace(/\\"/g, '"');
      if (!shouldLocalize(text)) return match;
      const id = idFor(text);
      const inside = inTemplate(ranges, offset);
      return inside
        ? `${pre}$localize\\\`:@@${id}:${text}\\\``
        : `${pre}$localize\`:@@${id}:${text}\``;
    });
  }
  src = localizeConcat(src);
  // Les littéraux `...` sont laissés tels quels : un ? final avalait le code jusqu'au backtick suivant.
  if (src !== original) fs.writeFileSync(file, src);
  return src !== original;
}

function localizeConcat(src) {
  const ranges = templateRanges(src);
  const re = /'((?:\\'|[^'\n])*?)'(?=\s*\+)|(\+\s*)'((?:\\'|[^'\n])*?)'/g;
  return src.replace(re, (match, rawA, plus, rawB, offset) => {
    const raw = rawA ?? rawB;
    const text = raw.replace(/\\'/g, "'");
    if (!/\s/.test(text) || !shouldLocalize(text)) return match;
    const lookbehind = src.slice(Math.max(0, offset - 16), offset + match.length);
    if (lookbehind.includes('$localize')) return match;
    const id = idFor(text);
    const inside = inTemplate(ranges, offset);
    const expr = inside ? `$localize\\\`:@@${id}:${text}\\\`` : `$localize\`:@@${id}:${text}\``;
    return rawA != null ? `${expr}` : `${plus}${expr}`;
  });
}

function toTagged(raw, inside) {
  if (raw.includes('`') || /\$\{[^}]*\{/.test(raw)) return null;
  const staticText = raw.replace(/\$\{[^}]*\}/g, ' ');
  if (!shouldLocalize(staticText) || !/\s/.test(staticText)) return null;
  if (/page_|replace\(|\\n|\\r/.test(raw)) return null;
  let n = 0;
  const body = raw.replace(/\$\{([^}]*)\}/g, (_, expr) => `\${${expr}}:p${n++}:`);
  const canonical = raw.replace(/\$\{[^}]*\}/g, '{$ph}');
  const id = idFor(canonical);
  return inside
    ? `$localize\\\`:@@${id}:${body}\\\``
    : `$localize\`:@@${id}:${body}\``;
}

function localizeTemplateBranches(src) {
  const ranges = templateRanges(src);
  const re = /(\?\s*|:\s*)`([^`\\]|\\[\s\S])*?`/g;
  return src.replace(re, (match, pre, _unused, offset) => {
    const raw = match.slice(pre.length + 1, -1);
    if (pre.startsWith(':') && !isTernaryAlternate(src, offset)) return match;
    const lookbehind = src.slice(Math.max(0, offset - 12), offset);
    if (lookbehind.includes('$localize')) return match;
    const tagged = toTagged(raw, inTemplate(ranges, offset));
    return tagged ? `${pre}${tagged}` : match;
  });
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.component.ts') && !/receipt|print-ticket|pos-ticket/i.test(entry.name)) acc.push(full);
  }
  return acc;
}

const root = path.resolve(target);
const files = fs.statSync(root).isDirectory() ? walk(root) : [root];
let n = 0;
for (const file of files) {
  if (localizeFile(file)) n++;
}
console.log(`ternaries updated ${n} files`);
