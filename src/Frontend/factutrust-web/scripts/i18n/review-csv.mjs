/**
 * Format CSV de relecture native (partagé par export-review et import-review).
 * Une ligne = un couple (texte français, traduction proposée) d'une vague ; la clé est stable
 * (empreinte du texte français), les ID concernés sont retrouvés à l'import par le texte.
 */
import crypto from 'node:crypto';

export const COLUMNS = ['cle', 'vague', 'occurrences', 'contexte', 'francais', 'arabe_propose', 'correction', 'statut', 'commentaire'];
export const STATUS_TODO = 'à relire';
/** Statuts qui valident la ligne (avec ou sans correction). */
export const STATUS_DONE = /^(relu|valid[ée]|ok)$/i;

export const keyOf = (wave, french) => `${wave}-${crypto.createHash('sha1').update(french).digest('hex').slice(0, 10)}`;

const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function toCsv(rows) {
  const lines = [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => quote(r[c])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Analyseur CSV (guillemets doublés, virgules et retours à la ligne dans les champs, BOM). */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map(values => Object.fromEntries(header.map((h, i) => [h.trim(), values[i] ?? ''])));
}
