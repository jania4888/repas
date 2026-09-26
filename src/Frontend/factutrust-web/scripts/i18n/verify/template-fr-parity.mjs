#!/usr/bin/env node
/**
 * Compare les templates ERP (parseTemplate, preserveWhitespaces: false) entre le tag
 * fr-reference et l'arbre de travail. Templates inline via spans TS + templateUrl.
 *
 * Usage:
 *   node scripts/i18n/verify/template-fr-parity.mjs
 *   node scripts/i18n/verify/template-fr-parity.mjs --write-baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTemplate } from '@angular/compiler';
import {
  FR_REFERENCE_TAG,
  baselineKey,
  extractTemplatesFromComponentTs,
  getRepoRoot,
  getWebRoot,
  gitShow,
  listCompanyTemplates,
  repoRelativePath,
  walkCompanyFiles
} from './_lib.mjs';

const writeBaseline = process.argv.includes('--write-baseline');
const web = getWebRoot();
const baselineDir = path.join(web, 'e2e/baselines/fr-static');

function stripI18nAttrs(template) {
  return template
    .replace(/\s+i18n(?:-[a-z-]+)?(?:="[^"]*")?/gi, '')
    .replace(/\s+i18n="@@[^"]*"/gi, '');
}

function serializeNodes(nodes) {
  if (!nodes?.length) return '';
  return nodes.map(serializeNode).join('');
}

function serializeNode(node) {
  const name = node.constructor?.name ?? '';
  switch (name) {
    case 'Text':
      return `T:${normalizeWs(node.value)}`;
    case 'BoundText':
      return 'B:{{}}';
    case 'BoundAttribute':
    case 'BoundEvent':
      return `${name[0]}:${node.name}`;
    case 'Element': {
      const attrs = [...(node.attributes ?? [])]
        .filter(a => !/^i18n/i.test(a.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(a => `${a.name}=${JSON.stringify(a.value)}`)
        .join(',');
      const inputs = [...(node.inputs ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(i => `${i.name}=${i.value?.source ?? ''}`)
        .join(',');
      const outputs = [...(node.outputs ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(o => `@${o.name}`)
        .join(',');
      const child = serializeNodes(node.children);
      return `E:${node.name}|${attrs}|${inputs}|${outputs}{${child}}`;
    }
    case 'Template': {
      const child = serializeNodes(node.children);
      return `Tpl{${child}}`;
    }
    case 'Content':
      return `Content{${serializeNodes(node.children)}}`;
    case 'Icu':
      return `Icu:${node.i18n?.messagePlaceholder ?? ''}`;
    default:
      if (node.children) {
        return `${name}{${serializeNodes(node.children)}}`;
      }
      return `${name}`;
  }
}

function normalizeWs(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function canonicalize(template, sourceUrl) {
  const cleaned = stripI18nAttrs(template);
  const { nodes, errors } = parseTemplate(cleaned, sourceUrl, {
    preserveWhitespaces: false
  });
  if (errors?.length) {
    return { error: errors.map(e => e.msg ?? String(e)).join('; '), canonical: null };
  }
  return { error: null, canonical: serializeNodes(nodes) };
}

function templatesAtRef(repoRelComponentTs, refContent) {
  const items = [];
  if (repoRelComponentTs.endsWith('.html')) {
    items.push({ label: repoRelComponentTs, template: refContent });
    return items;
  }
  const abs = path.join(getRepoRoot(), ...repoRelComponentTs.split('/'));
  for (const t of extractTemplatesFromComponentTs(abs, refContent)) {
    if (t.kind === 'html') {
      const htmlRel = repoRelativePath(t.file);
      const htmlRef = gitShow(FR_REFERENCE_TAG, htmlRel);
      items.push({ label: t.label, template: htmlRef ?? t.template });
    } else {
      items.push({ label: t.label, template: t.template });
    }
  }
  return items;
}

function collectWorkItems() {
  return listCompanyTemplates(web);
}

function collectRefItems() {
  const items = [];
  const htmlFiles = walkCompanyFiles(web, p => p.endsWith('.html'));
  for (const file of htmlFiles) {
    const rel = repoRelativePath(file);
    const ref = gitShow(FR_REFERENCE_TAG, rel);
    if (ref == null) continue;
    items.push({ label: rel, template: ref });
  }
  const components = walkCompanyFiles(web, p => p.endsWith('.component.ts'));
  for (const file of components) {
    const rel = repoRelativePath(file);
    const refTs = gitShow(FR_REFERENCE_TAG, rel);
    if (!refTs) continue;
    if (!/template:\s*`/.test(refTs) && !/templateUrl:/.test(refTs)) continue;
    for (const t of templatesAtRef(rel, refTs)) {
      items.push(t);
    }
  }
  return items;
}

function runCompare(workItems, refMap) {
  let diffs = 0;
  for (const item of workItems) {
    const refTemplate = refMap.get(item.label);
    if (refTemplate == null) {
      console.warn(`[skip] pas de référence fr-reference pour ${item.label}`);
      continue;
    }
    const refCanon = canonicalize(refTemplate, item.label);
    const workCanon = canonicalize(item.template, item.label);
    if (refCanon.error || workCanon.error) {
      console.error(`[parse] ${item.label}`);
      if (refCanon.error) console.error(`  ref: ${refCanon.error}`);
      if (workCanon.error) console.error(`  work: ${workCanon.error}`);
      diffs++;
      continue;
    }
    if (refCanon.canonical !== workCanon.canonical) {
      diffs++;
      console.error(`[diff] ${item.label}`);
      console.error('--- fr-reference (canonical)');
      console.error(refCanon.canonical.slice(0, 4000));
      console.error('--- working tree (canonical)');
      console.error(workCanon.canonical.slice(0, 4000));
    }
  }
  return diffs;
}

if (writeBaseline) {
  fs.mkdirSync(baselineDir, { recursive: true });
  const refItems = collectRefItems();
  let written = 0;
  for (const item of refItems) {
    const { error, canonical } = canonicalize(item.template, item.label);
    if (error) {
      console.warn(`[baseline skip parse] ${item.label}: ${error}`);
      continue;
    }
    const out = path.join(baselineDir, baselineKey(item.label));
    fs.writeFileSync(out, canonical, 'utf8');
    written++;
  }
  console.log(`[template-fr-parity] baseline ${written} fichiers → ${baselineDir}`);
  process.exit(0);
}

const refItems = collectRefItems();
const refMap = new Map(refItems.map(i => [i.label, i.template]));
const workItems = collectWorkItems();
const diffs = runCompare(workItems, refMap);

console.log(`[template-fr-parity] ${workItems.length} templates, ${diffs} écart(s)`);
process.exit(diffs ? 1 : 0);
