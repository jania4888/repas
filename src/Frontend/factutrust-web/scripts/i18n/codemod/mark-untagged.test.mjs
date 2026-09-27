#!/usr/bin/env node
/** Non-régression du codemod mark-untagged (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as ng from '@angular/compiler';
import { markTemplate } from './mark-untagged.mjs';

const parse = t => ng.parseTemplate(t, 'test.html', { preserveWhitespaces: true });

test('une phrase coupée par <ng-container *ngIf> devient un seul message', () => {
  const tpl = `<p>
  <strong i18n="@@x">Aperçu :</strong> exercice « {{ a() }} »<ng-container *ngIf="b()"> (frontière {{ c() }})</ng-container>.
</p>`;
  const out = markTemplate(tpl);
  assert.equal((out.match(/i18n="/g) ?? []).length, 1, out);
  assert.match(out, /^<p i18n="@@test\.[^"]+">/);
  assert.doesNotMatch(out, /<strong i18n/);
  assert.deepEqual(parse(out).errors ?? [], []);
});

test('jamais de conteneur i18n vide ni de fermeture inversée', () => {
  const tpl = `<div>
  Total : {{ t }}
  @if (x) { <app-x /> }
  <span>Reste {{ r }}</span> à payer
</div>`;
  const out = markTemplate(tpl);
  assert.doesNotMatch(out, /<ng-container i18n="[^"]*">\s*<\/ng-container>/);
  assert.deepEqual(parse(out).errors ?? [], []);
  assert.equal((out.match(/<ng-container i18n=/g) ?? []).length, 2, out);
  assert.equal((out.match(/<ng-container/g) ?? []).length, (out.match(/<\/ng-container>/g) ?? []).length);
});

test('le texte affiché est inchangé', () => {
  const tpl = `<label><input type="radio" value="N" /> N — ex. « {{ s('N') }} »</label>`;
  const out = markTemplate(tpl);
  const strip = t => t.replace(/<\/?ng-container[^>]*>/g, '').replace(/\s+i18n(-[\w-]+)?="[^"]*"/g, '');
  assert.equal(strip(out), strip(tpl));
});
