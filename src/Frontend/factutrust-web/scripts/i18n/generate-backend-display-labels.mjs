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

/** Aides backend hors ToDisplayString dont le résultat est affiché tel quel (champ *Display d'un DTO). */
const DISPLAY_HELPERS = [
  'BillingFrequencyDisplay' // RecurringContractService → ContractDto.BillingFrequencyDisplay
];

const labels = new Set();
for (const file of walk(BACKEND)) {
  const src = fs.readFileSync(file, 'utf8');
  // ToDisplayString() des énumérations, et les aides nommées `static string X(…) => v switch { … }`
  // qui alimentent un champ *Display d'un DTO du périmètre société (liste explicite).
  const blocks = [
    /ToDisplayString\s*\([\s\S]{0,1200}?switch\s*\{([\s\S]*?)\n\s*\}/g,
    new RegExp(`static string (?:${DISPLAY_HELPERS.join('|')})\\s*\\([^)]*\\)\\s*=>\\s*\\w+\\s+switch\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g')
  ];
  for (const re of blocks) {
    for (const m of src.matchAll(re)) {
      for (const lit of m[1].matchAll(/=>\s*"([^"\\]+)"/g)) {
        const text = lit[1].trim();
        if (text && /[A-Za-zÀ-ÿ]/.test(text)) labels.add(text);
      }
    }
  }
}

/**
 * Libellés d'affichage envoyés tels quels par l'API hors ToDisplayString (constante d'un DTO),
 * affichés via `| backendLabel` ou `backendDisplayLabel()`. Chacun doit exister dans le fichier source indiqué.
 */
const EXCHANGES = 'FactuTrust.Infrastructure/Services/ExchangeService.cs';
const VERBATIM = [
  ['InstaFact Comptabilité', 'FactuTrust.Application/Features/FixedAssets/AmortizationReportAssembler.cs'],
  // ExchangeBootstrapDto.EmptyHint
  ['Liez un cabinet comptable dans Paramètres → Cabinet comptable pour ouvrir les échanges.', EXCHANGES],
  ['Votre demande de liaison est en attente d’acceptation par le cabinet.', EXCHANGES],
  ['Aucun dossier client actif pour démarrer un échange.', EXCHANGES],
  // ActiveInventoryDto.TypeLabel
  ['Complet', 'FactuTrust.Application/Features/Inventory/Queries/GetActiveInventoryQuery.cs'],
  ['Partiel', 'FactuTrust.Application/Features/Inventory/Queries/GetActiveInventoryQuery.cs']
];
for (const [text, rel] of VERBATIM) {
  if (!fs.readFileSync(path.join(BACKEND, rel), 'utf8').includes(`"${text}"`)) {
    throw new Error(`Libellé verbatim introuvable dans ${rel} : ${text}`);
  }
  labels.add(text);
}

const entries = [...labels].sort((a, b) => a.localeCompare(b, 'fr'));
const used = new Map();
const idByText = new Map();
// ID stables : un libell\u00e9 d\u00e9j\u00e0 g\u00e9n\u00e9r\u00e9 garde son ID (ses traductions en d\u00e9pendent) ; un nouveau
// libell\u00e9 prend un ID libre, jamais celui d'un autre texte.
const previousIds = new Map();
if (fs.existsSync(out)) {
  for (const m of fs.readFileSync(out, 'utf8').matchAll(/^\s+("(?:[^"\\]|\\.)*"): \$localize`:@@([^:]+):/gm)) {
    previousIds.set(JSON.parse(m[1]), m[2]);
  }
}
for (const text of entries) {
  const id = previousIds.get(text);
  if (id && !used.has(id)) {
    used.set(id, text);
    idByText.set(text, id);
  }
}
for (const text of entries) {
  if (idByText.has(text)) continue;
  const base = `backend.${text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}`;
  let id = base;
  for (let n = 0; used.has(id); n++) id = `${base}.${String.fromCharCode(98 + n)}`;
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
