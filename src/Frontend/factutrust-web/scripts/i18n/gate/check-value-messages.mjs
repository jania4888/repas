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
import { getWebRoot } from '../verify/_lib.mjs';

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
console.log(`[i18n:values] ${offenders.length} message(s) portant une valeur`);
process.exit(offenders.length ? 1 : 0);
