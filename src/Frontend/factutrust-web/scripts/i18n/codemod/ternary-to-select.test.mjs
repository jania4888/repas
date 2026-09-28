#!/usr/bin/env node
/** Non-régression du codemod ternary-to-select (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as ng from '@angular/compiler';
import { applyEdits, ternaryEdits } from './ternary-to-select.mjs';

const run = (tpl) => applyEdits(tpl, ternaryEdits(tpl, 'test').edits);
const parse = t => ng.parseTemplate(t, 'test.html', { preserveWhitespaces: true });

test('hors message : ICU select enveloppé dans un ng-container i18n', () => {
  const out = run(`<button>{{ saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>`);
  assert.match(out, /^<button><ng-container i18n="@@test\.sel\.[^"]+">\{!!\(saving\(\)\), select, true \{Enregistrement…\} other \{Enregistrer\}\}<\/ng-container><\/button>$/);
  assert.deepEqual(parse(out).errors ?? [], []);
});

test('dans un message : ICU en place et ID suffixé .sel une seule fois', () => {
  const out = run(`<p i18n="@@a.b">Statut : {{ x ? 'Actif' : 'Inactif' }} / {{ y ? 'Oui' : 'Non' }}</p>`);
  assert.equal(out, `<p i18n="@@a.b.sel">Statut : {!!(x), select, true {Actif} other {Inactif}} / {!!(y), select, true {Oui} other {Non}}</p>`);
  assert.deepEqual(parse(out).errors ?? [], []);
});

test('symboles, codes, pipes et concaténations laissés tels quels', () => {
  for (const tpl of [
    `<span>{{ ok ? '✓' : '✗' }}</span>`,
    `<span>{{ k === 1 ? 'C0001' : 'F0001' }}</span>`,
    `<span>{{ busy ? 'Approbation…' : 'Approuver (' + n + ')' }}</span>`,
    `<span>{{ (x ? 'Oui' : 'Non') | uppercase }}</span>`
  ]) assert.equal(run(tpl), tpl);
});
