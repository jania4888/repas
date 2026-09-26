#!/usr/bin/env node
/** Génère backend-display-labels.generated.ts depuis les ToDisplayString C# (stub — étendre avec Roslyn). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(
  fileURLToPath(new URL('../../src/app/core/i18n/backend-display-labels.generated.ts', import.meta.url))
);
const content = `/** Fichier généré — ne pas modifier à la main. */
export const BACKEND_DISPLAY_LABELS: Record<string, string> = {};
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, content, 'utf8');
console.log('Wrote', out);
