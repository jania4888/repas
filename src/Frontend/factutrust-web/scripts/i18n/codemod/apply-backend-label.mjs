/**
 * Branche le pipe backendLabel sur les interpolations *Display (affichage seul).
 * N'ajoute jamais le pipe sur ngModel, value ou un attribut posté.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'src/app');
const SKIP = /receipt|print-ticket|pos-ticket|[/\\]firm[/\\]/i;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'firm') continue;
      walk(p, out);
    } else if (/\.(component\.ts|html)$/.test(ent.name) && !ent.name.endsWith('.spec.ts') && !SKIP.test(p)) {
      out.push(p);
    }
  }
  return out;
}

function pipeDisplays(src) {
  return src.replace(/\{\{([^{}]*)\}\}/g, (full, body) => {
    if (!/Display\b/.test(body) || body.includes('backendLabel')) return full;
    const next = body.replace(/\b((?:[\w?.()!]+)?[\w]+Display)\b(?!\s*(?:[.|?(]|\|\|))/g, '$1 | backendLabel');
    return next === body ? full : `{{${next}}}`;
  });
}

function componentTsFor(file) {
  if (file.endsWith('.component.ts')) return file;
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.html$/, '.component.ts');
  const candidate = path.join(dir, base);
  return fs.existsSync(candidate) ? candidate : null;
}

function ensureImport(tsPath) {
  let src = fs.readFileSync(tsPath, 'utf8');
  if (!src.includes('imports:')) return false;
  let changed = false;
  if (!src.includes('BackendLabelPipe')) {
    src = `import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';\n${src}`;
    changed = true;
  }
  if (!/imports:\s*\[[^\]]*BackendLabelPipe/s.test(src)) {
    const next = src.replace(/imports:\s*\[/, 'imports: [BackendLabelPipe, ');
    if (next === src) return false;
    src = next;
    changed = true;
  }
  if (changed) fs.writeFileSync(tsPath, src);
  return changed;
}

let files = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const next = pipeDisplays(src);
  if (next === src) continue;
  fs.writeFileSync(file, next);
  const ts = componentTsFor(file);
  if (ts) ensureImport(ts);
  files++;
  console.log('[backendLabel]', path.relative(process.cwd(), file));
}
console.log(`[backendLabel] ${files} fichiers`);
