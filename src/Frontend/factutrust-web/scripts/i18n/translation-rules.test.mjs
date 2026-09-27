#!/usr/bin/env node
/** Règles de validité des traductions (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTranslation } from './translation-rules.mjs';

const ICU = '{VAR_PLURAL, plural, =0 {facture} =1 {facture} other {factures}}';

test('ICU plural arabe avec toutes les catégories CLDR : accepté', () => {
  const ar = '{VAR_PLURAL, plural, zero {فاتورة} one {فاتورة} two {فاتورتان} few {فواتير} many {فاتورة} other {فاتورة}}';
  assert.equal(validateTranslation(ICU, ar), null);
});

test('ICU : cas qui commence par un placeholder accepté', () => {
  const fr = '{VAR_PLURAL, plural, =1 {{$INTERPOLATION} ligne} other {{$INTERPOLATION} lignes}}';
  const ar = '{VAR_PLURAL, plural, one {{$INTERPOLATION} سطر} other {{$INTERPOLATION} أسطر}}';
  assert.equal(validateTranslation(fr, ar), null);
});

test('ICU : sans « other », clé inconnue, accolades déséquilibrées ou interpolation Angular → refusé', () => {
  assert.equal(validateTranslation(ICU, '{VAR_PLURAL, plural, one {فاتورة} few {فواتير}}'), 'icu-other');
  assert.equal(validateTranslation(ICU, '{VAR_PLURAL, plural, dual {فاتورتان} other {فاتورة}}'), 'icu-cle');
  assert.equal(validateTranslation(ICU, '{VAR_PLURAL, plural, one {فاتورة} other {فاتورة}'), 'icu-accolades');
  assert.equal(validateTranslation(ICU, '{VAR_PLURAL, plural, one {{{ n }} فاتورة} other {فاتورة}}'), 'code');
  assert.equal(validateTranslation(ICU, 'فواتير'), 'icu');
});

test('hors ICU, « }} » reste du code refusé', () => {
  assert.equal(validateTranslation('Total : {$INTERPOLATION}', 'المجموع: {{ total }}'), 'code');
  assert.equal(validateTranslation('Total : {$INTERPOLATION}', 'المجموع: {$INTERPOLATION}'), null);
});
