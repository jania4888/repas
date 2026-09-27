#!/usr/bin/env node
/** Classifieur et codemod des littéraux TS (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { scanFile } from './_ts-literals.mjs';
import { localizeSource } from './localize-ts-ast.mjs';

const kinds = src => scanFile('t.ts', src).found.map(f => `${f.kind}:${f.text}`);
const BS = '\\';
const BT = '`';

test("affichage : toast, dialogue, menu, signal d'erreur, repli d'erreur", () => {
  const src = `
    this.toast.success('Enregistré avec succès');
    this.confirmationService.confirm({ header: 'Valider le document', message: 'Confirmer la suppression ?' });
    const items = [{ label: 'Nouveau devis', icon: 'pi pi-plus' }];
    this.error.set('Chargement impossible');
    this.errors.extractErrorMessage(err, 'Erreur réseau lors du chargement');`;
  assert.deepEqual(kinds(src).map(k => k.split(':')[0]), Array(6).fill('DISPLAY'));
});

test('jamais : comparaison, case, clé, valeur, journal, stockage, type littéral', () => {
  const src = `
    if (status === 'Brouillon validé') {}
    switch (x) { case 'Facture payée': break; }
    const o = { value: 'Congé payé annuel', 'Clé française': 1 };
    console.warn('Avertissement technique');
    localStorage.setItem('Préférence utilisateur', v);
    class C { partyLabel: 'Client' | 'Fournisseur' = 'Client'; }`;
  assert.ok(kinds(src).every(k => k.startsWith('NEVER:')), kinds(src).join(' | '));
});

test('charge API : les libellés envoyés au serveur ne sont pas traduits', () => {
  const src = `
    this.http.post('/api/x', { label: 'Nouveau champ personnalisé' });
    const payload = { description: 'Frais de dossier' };`;
  assert.ok(kinds(src).every(k => k.startsWith('REVIEW:')), kinds(src).join(' | '));
});

test('remplacement : échappements, placeholders nommés, texte français identique', () => {
  // Une chaîne contenant `x` et ${y} littéraux, puis un gabarit avec \n et une expression.
  const src =
    'this.toast.error("Impossible de charger ' + BT + 'x' + BT + ' ${y}");\n' +
    'this.error.set(' + BT + 'Échec : ${e.message}' + BS + 'nRéessayez' + BT + ');';
  const { out, count } = localizeSource('src/app/features/stock/stock-list/stock-list.component.ts', src);
  assert.equal(count, 2);
  assert.ok(out.includes(':Impossible de charger ' + BS + BT + 'x' + BS + BT + ' ' + BS + '${y}' + BT), out);
  assert.ok(out.includes(':Échec : ${e.message}:message:' + BS + 'nRéessayez' + BT), out);
  assert.ok(/\$localize`:@@stock\.stock-list\.ts\.impossible\.de\.charger\.x\.y\.[0-9a-f]{8}:/.test(out), out);
});
