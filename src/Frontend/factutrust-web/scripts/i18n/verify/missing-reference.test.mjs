#!/usr/bin/env node
/**
 * Référence disparue du travail : les deux portes de parité du français doivent exiger une
 * APPROBATION, et non subir la suppression (node --test).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMissingReference } from './_lib.mjs';

test('sans approbation, une référence disparue est une régression', () => {
  assert.equal(classifyMissingReference(undefined), 'removed');
  assert.equal(classifyMissingReference(null), 'removed');
  assert.equal(classifyMissingReference({}), 'removed');
});

test('une approbation d’écart ne vaut pas approbation de suppression', () => {
  assert.equal(classifyMissingReference({ sha: 'abc', reason: 'écart approuvé' }), 'removed');
});

test('seule une approbation explicite de suppression laisse passer', () => {
  assert.equal(classifyMissingReference({ removed: true, reason: 'composant retiré' }), 'deleted');
});

test('le drapeau doit valoir vrai, et non simplement être présent', () => {
  assert.equal(classifyMissingReference({ removed: false }), 'removed');
  assert.equal(classifyMissingReference({ removed: 'true' }), 'removed');
});
