#!/usr/bin/env node
/**
 * Porte : aucun message i18n ne doit porter une valeur (énumération d'API, nom de champ, clé,
 * identifiant DOM). Traduite, une valeur casse la logique : `'InternalNote'` envoyé à l'API
 * devient un texte arabe, un code devise traduit fait échouer Intl.NumberFormat.
 *
 * Signal : texte en camelCase, PascalCase composé ou kebab-case, sans espace.
 * Les sigles en majuscules (TVA, CNSS…) sont de l'affichage et restent autorisés.
 *
 * Usage : node scripts/i18n/gate/check-value-messages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectMessages } from './_messages.mjs';
import { getWebRoot, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';

/** Noms propres et sigles affichés tels quels (InstaFact, WhatsApp…) : de l'affichage, pas des valeurs. */
const identical = new Set(
  JSON.parse(fs.readFileSync(path.join(getWebRoot(), 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values
);

const looksLikeValue = text =>
  /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(text) || // camelCase
  /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(text) || // PascalCase composé
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+|-\{\$[A-Za-z0-9_]+\})+$/.test(text) || // kebab-case, y compris msg-{$p0}
  /^var\(--[a-z0-9-]+\)$/.test(text); // valeur CSS

const offenders = collectMessages().filter(m => !identical.has(m.text.trim()) && looksLikeValue(m.text.trim()));
for (const m of offenders) console.error(`[valeur] « ${m.text} » ← ${m.file}${m.id ? ` (@@${m.id})` : ''}`);

// Repli de donnée (`x ?? $localize`Mot``) : un mot d'énumération anglais en repli d'une valeur
// d'API est une valeur (ex. `kinship ?? 'Father'`, `status ?? 'None'`), jamais un texte à traduire.
// Les libellés français de repli (« Erreur », « Inconnu »…) restent de l'affichage.
const ENUM_WORDS = new Set([
  'None', 'Other', 'Default', 'Unknown', 'Name', 'Id', 'Code', 'Type', 'Status', 'Open', 'Closed',
  'Draft', 'Pending', 'Paid', 'Unpaid', 'Sent', 'Approved', 'Rejected', 'Cancelled', 'Validated',
  'Father', 'Mother', 'Child', 'Spouse', 'Male', 'Female', 'Single', 'Married', 'True', 'False',
  'Yes', 'No', 'Monthly', 'Weekly', 'Daily', 'Yearly', 'Manual', 'Auto', 'List', 'Kanban', 'Calendar'
]);
const fallbacks = [];
for (const rel of listWorkFiles(r => r.endsWith('.ts') && !r.endsWith('.spec.ts'))) {
  const source = readWorkFile(rel);
  for (const m of source.matchAll(/\?\?\s*\$localize`:(?:[^:`]*@@)?[^:`]*:([A-Za-z][A-Za-z0-9_]*)`/g)) {
    if (!ENUM_WORDS.has(m[1])) continue;
    const line = source.slice(0, m.index).split('\n').length;
    fallbacks.push(`${rel}:${line}`);
    console.error(`[valeur] repli « ?? $localize ${m[1]} » ← ${rel}:${line}`);
  }
}

const total = offenders.length + fallbacks.length;
console.log(`[i18n:values] ${total} message(s) portant une valeur`);
process.exit(total ? 1 : 0);
