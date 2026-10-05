#!/usr/bin/env node
/** Codemod des littéraux français dans les liaisons de templates (node --test). */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClassifier, rewriteExpression } from './localize-bound-literals.mjs';
import { setIdenticalWords } from './_untagged.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const ng = await import(pathToFileURL(path.join(WEB, 'node_modules/@angular/compiler/fesm2022/compiler.mjs')).href);
setIdenticalWords([]);
const isText = createClassifier(new Set(['Nouveau bon de réception']));
// Angular 20 : parseBinding exige un ParseSourceSpan (plus une simple chaîne).
const parse = src => {
  const file = new ng.ParseSourceFile(src, 'codemod-test.html');
  const loc = new ng.ParseLocation(file, 0, 0, 0);
  return new ng.Parser(new ng.Lexer()).parseBinding(src, new ng.ParseSourceSpan(loc, loc), 0);
};
const rewrite = src => rewriteExpression(src, parse(src), isText, 'stock.stock-list');

test('ternaire : chaque branche devient un champ $localize, la condition ne bouge pas', () => {
  const r = rewrite("isEdit() ? 'Modifier le bon de réception' : 'Nouveau bon de réception'");
  assert.match(r.text, /^isEdit\(\) \? loc_modifier_le_bon_de_reception_[0-9a-f]{6} : loc_nouveau_bon_de_reception_[0-9a-f]{6}$/);
  assert.equal(r.members.length, 2);
  assert.ok(r.members.every(m => m.kind === 'field' && m.id.startsWith('stock.stock-list.tpl.')));
});

test('concaténation : UN message à placeholders nommés (l’arabe peut réordonner)', () => {
  const r = rewrite("'Modifier l\\'écriture ' + r.journal + ' n° ' + r.piece");
  assert.match(r.text, /^loc_modifier_l_ecriture_journal_n_piece_[0-9a-f]{6}\(r\.journal, r\.piece\)$/);
  const [m] = r.members;
  assert.equal(m.kind, 'method');
  assert.equal(m.message, "Modifier l'écriture ${p0}:journal: n° ${p1}:piece:");
});

test('repli || et parenthèses conservés ; littéral comparé ou technique jamais touché', () => {
  const r = rewrite("prefix + (label() || 'Sélection non équilibrée')");
  assert.match(r.text, /^prefix \+ \(label\(\) \|\| loc_selection_non_equilibree_[0-9a-f]{6}\)$/);
  assert.equal(rewrite("status === 'Brouillon validé' ? a : b"), null);
  assert.equal(rewrite("'pi pi-check'"), null);
});

test('addition entre parenthèses : un seul placeholder, jamais une concaténation de ses termes', () => {
  const r = rewrite("'Supprimer la ligne ' + (i + 1)");
  assert.match(r.text, /^loc_supprimer_la_ligne_i_[0-9a-f]{6}\(i \+ 1\)$/);
  assert.equal(r.members[0].message, 'Supprimer la ligne ${p0}:i:');
});
