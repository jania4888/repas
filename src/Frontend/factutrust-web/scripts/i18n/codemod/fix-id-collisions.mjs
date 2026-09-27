#!/usr/bin/env node
/**
 * Donne un ID propre (préfixe + slug + hash du texte) à chaque variante d'un `$localize` dont l'ID
 * est partagé par plusieurs textes. Le texte source n'est pas modifié : rendu français identique.
 *
 * Usage : node scripts/i18n/codemod/fix-id-collisions.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collectMessages, findIdCollisions, parseLocalize } from '../gate/_messages.mjs';
import { getWebRoot } from '../verify/_lib.mjs';
import { i18nSlug } from './id-slug.mjs';

const checkOnly = process.argv.includes('--check');
const WEB = getWebRoot();
const collisions = findIdCollisions(collectMessages());
if (!collisions.length) {
  console.log('[fix-id-collisions] aucune collision');
  process.exit(0);
}

const colliding = new Set(collisions.map(c => c.id));
const files = new Set(collisions.flatMap(c => c.variants.flatMap(v => v.files.map(f => f.replace(/:\d+$/, '')))));
let rewritten = 0;

for (const rel of files) {
  const abs = path.join(WEB, rel);
  const source = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const visit = node => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === '$localize') {
      const m = parseLocalize(node, sf);
      if (m.id && colliding.has(m.id)) {
        const prefix = m.id.split('.').slice(0, -1).join('.');
        const newId = `${prefix}.${i18nSlug(m.text)}`;
        const start = node.template.getStart(sf);
        const marker = `@@${m.id}:`;
        const at = source.indexOf(marker, start);
        if (at < 0 || at > node.template.getEnd()) throw new Error(`${rel}:${m.line} métadonnée introuvable pour @@${m.id}`);
        edits.push({ at, len: marker.length, text: `@@${newId}:`, from: m.id, to: newId, line: m.line });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  let out = source;
  for (const e of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len);
    console.log(`${rel}:${e.line}  @@${e.from} → @@${e.to}`);
  }
  rewritten += edits.length;
  if (!checkOnly) fs.writeFileSync(abs, out, 'utf8');
}
console.log(`[fix-id-collisions] ${rewritten} message(s) ${checkOnly ? 'à renommer' : 'renommé(s)'}`);
process.exit(checkOnly && rewritten ? 1 : 0);
