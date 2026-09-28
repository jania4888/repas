#!/usr/bin/env node
/** Format CSV de relecture native (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUMNS, keyOf, parseCsv, toCsv } from './review-csv.mjs';

test('aller-retour : guillemets, virgules, retours à la ligne, BOM et arabe préservés', () => {
  const row = {
    cle: keyOf('v3', 'Client « {$name} », ligne 2'),
    vague: 'v3',
    occurrences: 2,
    contexte: 'clients/client-form.component.ts',
    francais: 'Client « {$name} », ligne 2',
    arabe_propose: 'الحريف « {$name} »، السطر 2',
    correction: 'سطر "أول"\nسطر ثانٍ',
    statut: 'relu',
    commentaire: 'a, b; c'
  };
  const csv = toCsv([row]);
  assert.ok(csv.startsWith('﻿'));
  const [back] = parseCsv(csv);
  for (const c of COLUMNS) assert.equal(back[c], String(row[c]), c);
});

test('clé stable par vague et texte français', () => {
  assert.equal(keyOf('v1', 'Annuler'), keyOf('v1', 'Annuler'));
  assert.notEqual(keyOf('v1', 'Annuler'), keyOf('v2', 'Annuler'));
});
