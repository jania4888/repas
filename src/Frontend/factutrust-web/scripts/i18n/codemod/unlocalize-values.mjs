#!/usr/bin/env node
/**
 * Retire de $localize des valeurs qui ne sont pas de l'affichage (valeurs d'API, énumérations,
 * codes devise, identifiants DOM) : `$localize`:@@id:Valeur`` redevient `'Valeur'`, et
 * `$localize`:@@id:pre${x}:p0:post`` redevient `` `pre${x}post` ``. Même valeur, même rendu ;
 * seul le risque de traduction disparaît.
 *
 * Usage : node scripts/i18n/codemod/unlocalize-values.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getWebRoot, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';

/** ID des messages qui portent une valeur, jamais un texte affiché. */
const VALUE_IDS = new Set([
  'ui.tern.tnd.51da21', // code devise par défaut (Intl.NumberFormat)
  'ui.tern.internalnote.28a701', // type de message d'échange envoyé à l'API
  'ui.tern.clientvisible.bf9461',
  'ui.tern.open.cf9b77', // statut de fil d'échange
  'ui.tern.msg.ph.e4663f', // clé de suivi de liste
  'ui.tern.fortyeighthours.a53c9c', // régime hebdomadaire (énumération)
  'ui.tern.byemployee.8f359b', // vue d'export (énumération)
  'ui.tern.initialstock.2874d4', // motif de bon de stock (énumération)
  'ui.tern.damage.7bf6d1',
  'ui.tern.expensecategory.d48904', // identifiants DOM (attribut for)
  'ui.tern.revenuecategory.21cd74',
  'ui.tern.father.922561', // lien de parenté par défaut (valeur de formulaire)
  'ui.tern.none.6eef66', // statut / mode par défaut (énumérations de paie)
  'ui.tern.name.709a23' // colonne d'affichage par défaut d'une table liée (nom de colonne)
]);

const checkOnly = process.argv.includes('--check');
const WEB = getWebRoot();
let total = 0;

for (const rel of listWorkFiles(r => r.endsWith('.ts') && !r.endsWith('.spec.ts'))) {
  const source = readWorkFile(rel);
  if (!source.includes('$localize')) continue;
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const visit = node => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === '$localize') {
      const raw = node.template.getText(sf); // avec les accents graves
      const meta = raw.match(/^`:(?:[^:|]*\|)?[^:@]*@@([^:]+):/);
      if (meta && VALUE_IDS.has(meta[1])) {
        const body = raw.slice(meta[0].length, -1).replace(/(\$\{[^}]*\}):[A-Za-z_][A-Za-z0-9_]*:/g, '$1');
        const text = body.includes('${') ? `\`${body}\`` : `'${body.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  total += edits.length;
  console.log(`${rel}: ${edits.length}`);
  if (!checkOnly) fs.writeFileSync(path.join(WEB, rel), out, 'utf8');
}
console.log(`[unlocalize-values] ${total} valeur(s)${checkOnly ? ' à retirer' : ' retirée(s)'} de $localize`);
process.exit(checkOnly && total ? 1 : 0);
