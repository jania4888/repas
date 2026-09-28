#!/usr/bin/env node
/** Codemod CSS physique → logique (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { logicalizeComponentStyles, logicalizeCss } from './logicalize-css.mjs';

test('longhands, positions et alignements : équivalents logiques', () => {
  const { out, changes } = logicalizeCss(
    [
      '.a { margin-left: 8px; padding-right: 4px !important; }',
      '.b {',
      '  border-left: 3px solid var(--primary);',
      '  border-top-right-radius: 6px;',
      '  left: 0;',
      '  right: 12px;',
      '  text-align: right;',
      '}'
    ].join('\n')
  );
  assert.equal(changes, 7);
  assert.match(out, /margin-inline-start: 8px; padding-inline-end: 4px !important;/);
  assert.match(out, /border-inline-start: 3px solid var\(--primary\);/);
  assert.match(out, /border-start-end-radius: 6px;/);
  assert.match(out, /inset-inline-start: 0;/);
  assert.match(out, /inset-inline-end: 12px;/);
  assert.match(out, /text-align: end;/);
});

test('raccourcis asymétriques décomposés, symétriques laissés', () => {
  const { out } = logicalizeCss('.a { margin: 0 auto 0 8px; padding: 4px 8px; inset: 0 0 auto 10px; margin: 1px 2px 3px 2px; }');
  assert.match(out, /margin-block: 0; margin-inline: 8px auto;/);
  assert.match(out, /padding: 4px 8px;/);
  assert.match(out, /inset-block: 0 auto; inset-inline: 10px 0;/);
  assert.match(out, /margin: 1px 2px 3px 2px;/);
});

test('jamais : variables SCSS, propriétés personnalisées, sélecteurs, centrage, rtl-ok ; float signalé', () => {
  const src = [
    '$margin-left: 4px;',
    '.x { --panel-left: 2px; }',
    '.left:hover { color: red; }',
    '.c { left: 50%; transform: translateX(-50%); }',
    '.d { left: 3px; } /* rtl-ok : position calculée */',
    '.e { float: right; }',
    '.f { margin: 0 $gap * 2 0 0; }'
  ].join('\n');
  const { out, changes, manual } = logicalizeCss(src);
  assert.equal(changes, 0);
  assert.equal(out, src);
  assert.deepEqual(manual.map(m => m.why), ['float', 'margin asymétrique (expression)']);
});

test('styles en ligne d’un composant : seul le gabarit des styles est réécrit', () => {
  const ts = "@Component({ template: `<div style=\"margin-left: 2px\"></div>`, styles: [`\n.a { margin-left: 4px; }\n`] })";
  const { out, changes } = logicalizeComponentStyles(ts);
  assert.equal(changes, 1);
  assert.ok(out.includes('style="margin-left: 2px"'), out);
  assert.ok(out.includes('.a { margin-inline-start: 4px; }'), out);
});

test('border-radius asymétrique : coins logiques ; symétrique ou calc() : inchangé', () => {
  const { out } = logicalizeCss('.tab { border-radius: 4px 0 0 4px; } .top { border-radius: 8px 8px 0 0; } .m { margin: calc(var(--s) * -1) 0 var(--s) 0; }');
  assert.match(out, /border-start-start-radius: 4px; border-start-end-radius: 0; border-end-end-radius: 0; border-end-start-radius: 4px;/);
  assert.match(out, /border-radius: 8px 8px 0 0;/);
  assert.ok(out.includes('margin: calc(var(--s) * -1) 0 var(--s) 0;'), out);
});
