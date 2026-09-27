#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.ar.arb'), 'utf8'));
const prefix = process.argv[2] ?? 'core';
const rows = [];
for (const [id, text] of Object.entries(fr)) {
  if (id.startsWith('@')) continue;
  if (!id.startsWith(prefix)) continue;
  const a = ar[id];
  if (!a || a === text) {
    rows.push({ id, fr: text });
  }
}
process.stdout.write(JSON.stringify(rows, null, 2));
console.error(`${rows.length} untranslated for prefix=${prefix}`);
