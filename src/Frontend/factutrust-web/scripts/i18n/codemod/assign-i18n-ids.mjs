#!/usr/bin/env node
/**
 * Remplace i18n> par i18n="@@prefix.slug" pour le runtime JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const targetDir = process.argv[2];
if (!targetDir) {
  console.error('Usage: assign-i18n-ids.mjs <directory>');
  process.exit(1);
}

function slug(text) {
  const base = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
  return base ? `${base}.${hash}` : `text.${hash}`;
}

function prefixFromFile(file) {
  const rel = file.replace(/\\/g, '/');
  const stripComponent = s => s.replace(/\.component\.(html|ts)$/, '');
  const m = rel.match(/features\/([^/]+)\/([^/]+)/);
  if (m) return `${m[1]}.${stripComponent(m[2])}`;
  const core = rel.match(/core\/(.+)\.component\.(html|ts)$/);
  if (core) return `core.${core[1].replace(/\//g, '.')}`;
  const shared = rel.match(/shared\/(.+)\.component\.(html|ts)$/);
  if (shared) return `shared.${shared[1].replace(/\//g, '.')}`;
  return 'ui';
}

function processFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const prefix = prefixFromFile(file);
  src = src.replace(/<([a-zA-Z][^>]*?) i18n(?!=-)(?!=\s*="@@)>([^<]+)</g, (match, tagAttrs, text) => {
    if (match.includes('@@')) return match;
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('{{')) return match;
    const id = `${prefix}.${slug(trimmed)}`;
    return `<${tagAttrs} i18n="@@${id}">${text}<`;
  });
  if (src !== original) {
    fs.writeFileSync(file, src, 'utf8');
    console.log(`[ids] ${file}`);
  }
}

function shouldSkipDir(parentDir, name) {
  return name === 'firm' && parentDir.replace(/\\/g, '/').endsWith('/features');
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(dir, ent.name)) continue;
      walk(p);
    } else if (ent.name.endsWith('.html') || ent.name.endsWith('.component.ts')) {
      processFile(p);
    }
  }
}

walk(path.resolve(targetDir));
