#!/usr/bin/env node
/** Classifieur et codemod des littéraux TS (node --test). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, scanFile } from './_ts-literals.mjs';
import { approvedEdits, localizeSource } from './localize-ts-ast.mjs';

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

test("charge utile IA : tout littéral d'une fonction qui construit le contexte d'écran reste en français", () => {
  const src = `
    class A {
      payload() { const h = [{ label: 'Marge brute négative' }]; return buildScreenAnalysisPayloadV2({ highlights: h }); }
      message() { return 'Marge brute négative'; }
    }`;
  const found = scanFile('t.ts', src).found;
  assert.deepEqual(found.map(f => classify(f.node).kind), ['NEVER', 'DISPLAY']);
});

test('--approve : « * », exclusions, pluriel fabriqué et imbrication laissés à la main', () => {
  const rel = 'src/app/features/stock/stock-list/stock-list.component.ts';
  const src = [
    "missing.push('une majuscule');",
    "missing.push('un chiffre obligatoire');",
    'parts.push(`${n} étape${n > 1 ? ' + "'s'" + " : ''} terminée`);",
    "return `Période ${m ? 'clôturée' : 'ouverte'} pour le mois`;"
  ].join('\n');
  const all = approvedEdits(rel, src, '*');
  assert.equal(all.count, 2, all.out);
  assert.ok(all.out.includes(':une majuscule`'), all.out);
  assert.deepEqual(all.manual.map(m => m.line), [3, 4, 4]);
  const some = approvedEdits(rel, src, { exclude: ['un chiffre obligatoire'] });
  assert.equal(some.count, 1);
  assert.ok(some.out.includes("missing.push('un chiffre obligatoire');"), some.out);
});

test('--approve : « ** » prend aussi les libellés sans accent, « also » les ajoute à « * », « texte@ligne » cible un homonyme', () => {
  const rel = 'src/app/features/stock/stock-list/stock-list.component.ts';
  const src = [
    "const LABELS = { Draft: 'Brouillon', Active: 'Actif' };",
    "const INTENTS = [{ intent: 'relations', title: 'Relations' }];",
    "const COUNTS = { relations: 'relations' };"
  ].join('\n');
  const all = approvedEdits(rel, src, '**');
  assert.ok(all.texts.includes('Actif') && all.texts.includes('Brouillon'), all.texts.join('|'));
  const plus = approvedEdits(rel, src, { base: '*', also: ['Actif'] });
  assert.deepEqual(plus.texts, ['Actif']);
  const homonym = approvedEdits(rel, src, { base: '**', exclude: ['relations@2'] });
  assert.ok(!homonym.out.split('\n')[1].includes("$localize`:@@stock.stock-list.ts.relations."), homonym.out);
  assert.ok(homonym.out.split('\n')[2].includes('$localize'), homonym.out);
});
