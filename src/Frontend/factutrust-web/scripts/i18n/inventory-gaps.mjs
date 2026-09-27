#!/usr/bin/env node
/**
 * Trois rapports versionnables :
 *   scripts/i18n/reports/fr-fallback.json
 *   scripts/i18n/reports/unmarked-templates.json
 *   scripts/i18n/reports/unlocalized-ts.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPORTS = path.join(WEB, 'scripts/i18n/reports');
const SKIP_FEATURES = new Set(['home', 'firm', 'portal', 'virtual-street', 'platform', 'legal']);
const whitelistFile = JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8'));
const whitelist = new Set([...(whitelistFile.ids ?? []), ...(whitelistFile.values ?? [])]);

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || SKIP_FEATURES.has(ent.name)) continue;
      walk(p, pred, out);
    } else if (pred(ent.name, p)) out.push(p);
  }
  return out;
}

const hasArabic = s => /[\u0600-\u06FF]/.test(s);
const looksFr = s => /[A-Za-zÀ-ÿ]{3,}/.test(s);

function frFallback() {
  const arPath = path.join(WEB, 'src/assets/i18n/messages.ar.json');
  if (!fs.existsSync(arPath)) return [];
  const { translations = {} } = JSON.parse(fs.readFileSync(arPath, 'utf8'));
  const rows = [];
  for (const [id, value] of Object.entries(translations)) {
    if (id.startsWith('auto.') || whitelist.has(id) || whitelist.has(value)) continue;
    if (!value || hasArabic(value)) continue;
    if (looksFr(value)) rows.push({ id, text: value });
  }
  return rows;
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function unmarkedTemplates() {
  const roots = [path.join(WEB, 'src/app/core'), path.join(WEB, 'src/app/shared'), path.join(WEB, 'src/app/features')];
  const files = roots.flatMap(r => walk(r, name => name.endsWith('.html') || name.endsWith('.component.ts')));
  const rows = [];
  const textRe = />([^<>{}]{2,})</g;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const chunks = file.endsWith('.ts') ? [...src.matchAll(/template:\s*`([\s\S]*?)`/g)].map(m => m[1]) : [src];
    for (const raw of chunks) {
      const html = stripComments(raw);
      let m;
      const re = new RegExp(textRe.source, 'g');
      while ((m = re.exec(html)) !== null) {
        const text = m[1].trim();
        if (!looksFr(text) || text.includes('i18n')) continue;
        if (text.includes('"') || text.includes('=') || text.includes('\n')) continue;
        if (/ngTemplateOutlet|compile time|declaration shared/.test(text)) continue;
        const opening = html.slice(Math.max(0, m.index - 240), m.index);
        const tagStart = opening.lastIndexOf('<');
        const openingTag = tagStart >= 0 ? opening.slice(tagStart) : opening;
        if (/\bi18n\b/.test(openingTag)) continue;
        if (/<\//.test(openingTag)) continue;
        rows.push({ file: path.relative(WEB, file).replace(/\\/g, '/'), text });
      }
    }
  }
  return rows;
}

function inComment(src, index) {
  const before = src.slice(0, index);
  const block = before.lastIndexOf('/*');
  const blockEnd = before.lastIndexOf('*/');
  if (block !== -1 && block > blockEnd) return true;
  const line = src.slice(before.lastIndexOf('\n') + 1, index);
  return /^\s*(\*|\/\/)/.test(line);
}

function unlocalizedTs() {
  const roots = [path.join(WEB, 'src/app/core'), path.join(WEB, 'src/app/shared'), path.join(WEB, 'src/app/features')];
  const files = roots.flatMap(r => walk(r, name => name.endsWith('.ts') && !name.endsWith('.spec.ts')));
  const propRe = /\b(summary|detail|acceptLabel|rejectLabel)\s*:\s*'((?:\\'|[^'\n])*)'(?=\s*[,}\n])/g;
  const titleRe = /\btitle\s*:\s*'((?:\\'|[^'\n])*)'(?=\s*[,}\n])/g;
  const rows = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(WEB, file).replace(/\\/g, '/');
    let m;
    while ((m = propRe.exec(src)) !== null) {
      if (inComment(src, m.index)) continue;
      if (src.slice(Math.max(0, m.index - 20), m.index + m[0].length).includes('$localize')) continue;
      rows.push({ file: rel, prop: m[1], text: m[2].replace(/\\'/g, "'") });
    }
    if (rel.endsWith('.routes.ts')) {
      while ((m = titleRe.exec(src)) !== null) {
        if (inComment(src, m.index)) continue;
        if (m[0].includes('$localize')) continue;
        rows.push({ file: rel, prop: 'title', text: m[1].replace(/\\'/g, "'") });
      }
    }
  }
  return rows;
}

fs.mkdirSync(REPORTS, { recursive: true });
const fallback = frFallback();
const unmarked = unmarkedTemplates();
const ts = unlocalizedTs();
fs.writeFileSync(path.join(REPORTS, 'fr-fallback.json'), JSON.stringify(fallback, null, 2));
fs.writeFileSync(path.join(REPORTS, 'unmarked-templates.json'), JSON.stringify(unmarked, null, 2));
fs.writeFileSync(path.join(REPORTS, 'unlocalized-ts.json'), JSON.stringify(ts, null, 2));
console.log(`[inventory] repli FR=${fallback.length} templates non balisés=${unmarked.length} TS=${ts.length}`);
