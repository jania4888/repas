#!/usr/bin/env node
/**
 * Extrait les littéraux des méthodes ToDisplayString() et génère
 * backend-display-labels.generated.ts (clés FR, valeurs $localize).
 * En français, $localize renvoie la source : zéro changement d'affichage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BACKEND = path.resolve(WEB, '../../Backend');
const out = path.join(WEB, 'src/app/core/i18n/backend-display-labels.generated.ts');

const AR = {
  'Espèces': 'نقداً',
  'Virement': 'تحويل',
  'Chèque': 'صك',
  'Carte bancaire': 'بطاقة بنكية',
  'Traite': 'كمبيالة',
  'Brouillon': 'مسودة',
  'Validé': 'مثبّت',
  'Validée': 'مثبّتة',
  'Payée': 'مسددة',
  'Payé': 'مسدد',
  'Annulé': 'ملغى',
  'Annulée': 'ملغاة',
  'Envoyé': 'مُرسل',
  'Envoyée': 'مُرسلة',
  'Accepté': 'مقبول',
  'Acceptée': 'مقبولة',
  'Refusé': 'مرفوض',
  'Refusée': 'مرفوضة',
  'En retard': 'متأخر',
  'Partiellement payée': 'مسددة جزئياً',
  'Brouillon ': 'مسودة'
};

function walk(dir, outFiles = []) {
  if (!fs.existsSync(dir)) return outFiles;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'bin' || ent.name === 'obj') continue;
      walk(p, outFiles);
    } else if (ent.name.endsWith('.cs')) outFiles.push(p);
  }
  return outFiles;
}

const labels = new Set();
for (const file of walk(BACKEND)) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /ToDisplayString\s*\([\s\S]{0,1200}?switch\s*\{([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const block = m[1];
    for (const lit of block.matchAll(/=>\s*"([^"\\]+)"/g)) {
      const text = lit[1].trim();
      if (text && /[A-Za-zÀ-ÿ]/.test(text)) labels.add(text);
    }
  }
}

const entries = [...labels].sort((a, b) => a.localeCompare(b, 'fr'));
const used = new Map();
const idByText = new Map();
for (const text of entries) {
  const base = `backend.${text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}`;
  const prev = used.get(base);
  const id = prev && prev !== text ? `${base}.b` : base;
  used.set(id, text);
  idByText.set(text, id);
}
const lines = entries.map(text => {
  const id = idByText.get(text);
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `  ${JSON.stringify(text)}: $localize\`:@@${id}:${escaped}\`,`;
});

const content = `/** Fichier généré par scripts/i18n/generate-backend-display-labels.mjs — ne pas modifier à la main. */
/// <reference types="@angular/localize" />

export const BACKEND_DISPLAY_LABELS: Record<string, string> = {
${lines.join('\n')}
};
`;
fs.writeFileSync(out, content, 'utf8');

const arPath = path.join(WEB, 'scripts/i18n/translations-ar/backend-display.json');
const ar = {};
for (const text of entries) {
  const id = idByText.get(text);
  if (AR[text]) ar[id] = AR[text];
}
fs.writeFileSync(arPath, JSON.stringify(ar, null, 2), 'utf8');
console.log(`Wrote ${entries.length} display labels`);
