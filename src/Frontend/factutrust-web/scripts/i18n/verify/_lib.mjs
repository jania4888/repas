#!/usr/bin/env node
/**
 * Utilitaires partagés — parité FR (tag fr-reference) et périmètre ERP société.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FR_REFERENCE_TAG = 'fr-reference';

export const SCAN_SKIP = new Set([
  'home',
  'firm',
  'portal',
  'virtual-street',
  'platform'
]);

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const REPO_ROOT = path.resolve(WEB, '../../..');

export function getWebRoot() {
  return WEB;
}

export function getRepoRoot() {
  return REPO_ROOT;
}

export function collectCompanyScanDirs(web = WEB) {
  const dirs = [
    path.join(web, 'src/app/core'),
    path.join(web, 'src/app/shared')
  ];
  const features = path.join(web, 'src/app/features');
  if (fs.existsSync(features)) {
    for (const ent of fs.readdirSync(features, { withFileTypes: true })) {
      if (ent.isDirectory() && !SCAN_SKIP.has(ent.name)) {
        dirs.push(path.join(features, ent.name));
      }
    }
  }
  return dirs;
}

export function walkCompanyFiles(web, filter) {
  const out = [];
  for (const dir of collectCompanyScanDirs(web)) {
    walkDir(dir, filter, out);
  }
  return out;
}

function walkDir(dir, filter, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'i18n') continue;
      walkDir(p, filter, out);
    } else if (filter(p)) {
      out.push(p);
    }
  }
}

/** Chemin relatif au dépôt (slash POSIX) pour git show. */
export function repoRelativePath(absPath, web = WEB) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

export function gitShow(ref, repoRelPath) {
  const r = spawnSync('git', ['show', `${ref}:${repoRelPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (r.status !== 0) {
    return null;
  }
  return r.stdout;
}

export function readFileOrGit(ref, absPath, web = WEB) {
  if (fs.existsSync(absPath)) {
    return fs.readFileSync(absPath, 'utf8');
  }
  return gitShow(ref, repoRelativePath(absPath, web));
}

/** @returns {{ contentStart: number, contentEnd: number }[]} */
export function findInlineTemplateSpans(tsSource) {
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

const TEMPLATE_URL_RE = /templateUrl:\s*['"]([^'"]+)['"]/g;

/** @returns {{ kind: 'html' | 'inline', file: string, template: string, label: string }[]} */
export function extractTemplatesFromComponentTs(tsPath, tsSource) {
  const items = [];
  const dir = path.dirname(tsPath);
  let m;
  TEMPLATE_URL_RE.lastIndex = 0;
  while ((m = TEMPLATE_URL_RE.exec(tsSource)) !== null) {
    const htmlPath = path.resolve(dir, m[1]);
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    items.push({
      kind: 'html',
      file: htmlPath,
      template: html,
      label: `${repoRelativePath(tsPath)} → ${repoRelativePath(htmlPath)}`
    });
  }
  const spans = findInlineTemplateSpans(tsSource);
  spans.forEach((span, idx) => {
    items.push({
      kind: 'inline',
      file: tsPath,
      template: tsSource.slice(span.contentStart, span.contentEnd),
      label: `${repoRelativePath(tsPath)}#inline${spans.length > 1 ? idx + 1 : ''}`
    });
  });
  return items;
}

/** @returns {{ kind: 'html' | 'inline', file: string, template: string, label: string }[]} */
export function listCompanyTemplates(web = WEB) {
  const items = [];
  const htmlFiles = walkCompanyFiles(web, p => p.endsWith('.html'));
  for (const file of htmlFiles) {
    items.push({
      kind: 'html',
      file,
      template: fs.readFileSync(file, 'utf8'),
      label: repoRelativePath(file, web)
    });
  }
  const components = walkCompanyFiles(web, p => p.endsWith('.component.ts'));
  for (const file of components) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/template:\s*`/.test(src) && !/templateUrl:/.test(src)) continue;
    for (const t of extractTemplatesFromComponentTs(file, src)) {
      if (t.kind === 'html' && htmlFiles.includes(t.file)) continue;
      items.push(t);
    }
  }
  return items;
}

export function baselineKey(label) {
  return label.replace(/[^a-zA-Z0-9._-]+/g, '_') + '.canonical.txt';
}
