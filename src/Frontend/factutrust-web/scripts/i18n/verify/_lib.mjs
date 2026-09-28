/**
 * Parité du français : périmètre société, lecture de la référence git, extraction des templates
 * (AST TypeScript) et forme canonique des templates (AST Angular).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as ng from '@angular/compiler';

/**
 * Référence du français : tag local `fr-reference` par défaut ; en CI, `I18N_FR_REFERENCE` peut
 * désigner le point de divergence avec main (`git merge-base HEAD origin/main`).
 */
export const FR_REFERENCE_TAG = process.env.I18N_FR_REFERENCE || 'fr-reference';

/** Dossiers de `features/` hors périmètre société : ils restent en français. */
export const OUT_OF_SCOPE_FEATURES = new Set(['home', 'firm', 'portal', 'virtual-street', 'legal']);

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const REPO_ROOT = path.resolve(WEB, '../../..');
const WEB_PREFIX = path.relative(REPO_ROOT, WEB).split(path.sep).join('/');

export const getWebRoot = () => WEB;
export const getRepoRoot = () => REPO_ROOT;

export function webRel(absPath) {
  return path.relative(WEB, absPath).split(path.sep).join('/');
}

export function isInCompanyScope(rel) {
  if (!rel.startsWith('src/app/')) return false;
  const parts = rel.split('/');
  if (parts.length === 3) return true;
  if (parts[2] === 'features') return !OUT_OF_SCOPE_FEATURES.has(parts[3]);
  return parts[2] === 'core' || parts[2] === 'shared';
}

/** Fichiers du périmètre dans la copie de travail (chemins relatifs à factutrust-web). */
export function listWorkFiles(filter) {
  const out = [];
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules') walk(abs);
        continue;
      }
      const rel = webRel(abs);
      if (isInCompanyScope(rel) && filter(rel)) out.push(rel);
    }
  };
  walk(path.join(WEB, 'src/app'));
  return out.sort();
}

export function readWorkFile(rel) {
  return fs.readFileSync(path.join(WEB, rel), 'utf8');
}

/** Contenu des fichiers du périmètre à la référence git, lu en un seul `git cat-file --batch`. */
export function readRefFiles(filter, ref = FR_REFERENCE_TAG) {
  const ls = spawnSync('git', ['ls-tree', '-r', '-z', ref, '--', `${WEB_PREFIX}/src/app`], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024
  });
  if (ls.status !== 0) {
    throw new Error(`git ls-tree ${ref} : ${ls.stderr?.toString() ?? 'échec'} (le tag est-il récupéré ?)`);
  }
  const entries = [];
  for (const record of ls.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [, type, sha] = record.slice(0, tab).split(' ');
    const rel = record.slice(tab + 1).slice(WEB_PREFIX.length + 1);
    if (type === 'blob' && isInCompanyScope(rel) && filter(rel)) entries.push({ sha, rel });
  }
  const cat = spawnSync('git', ['cat-file', '--batch'], {
    cwd: REPO_ROOT,
    input: entries.map(e => e.sha).join('\n') + '\n',
    maxBuffer: 1024 * 1024 * 1024
  });
  if (cat.status !== 0) throw new Error(`git cat-file : ${cat.stderr?.toString() ?? 'échec'}`);
  const buf = cat.stdout;
  const files = new Map();
  let offset = 0;
  for (const entry of entries) {
    const eol = buf.indexOf(0x0a, offset);
    const size = Number(buf.subarray(offset, eol).toString('ascii').split(' ')[2]);
    files.set(entry.rel, buf.subarray(eol + 1, eol + 1 + size).toString('utf8'));
    offset = eol + 1 + size + 1;
  }
  return files;
}

export function refCommit(ref = FR_REFERENCE_TAG) {
  const r = spawnSync('git', ['rev-parse', `${ref}^{commit}`], { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Templates

function decoratorName(dec, sf) {
  const expr = dec.expression;
  return ts.isCallExpression(expr) ? expr.expression.getText(sf) : null;
}

/**
 * Templates inline des classes `@Component` : valeur évaluée du littéral (celle que compile
 * Angular) et intervalle brut entre les accents graves (pour les codemods).
 */
export function inlineTemplates(rel, source) {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if (ts.isClassDeclaration(node)) {
      for (const dec of ts.getDecorators(node) ?? []) {
        if (decoratorName(dec, sf) !== 'Component') continue;
        const arg = dec.expression.arguments[0];
        if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== 'template') continue;
          const init = prop.initializer;
          if (!ts.isNoSubstitutionTemplateLiteral(init) && !ts.isStringLiteral(init)) {
            out.push({ label: `${rel}#${node.name?.text ?? 'anonyme'}`, template: null, unsupported: true });
            continue;
          }
          out.push({
            label: `${rel}#${node.name?.text ?? 'anonyme'}`,
            template: init.text,
            rawStart: init.getStart(sf) + 1,
            rawEnd: init.getEnd() - 1
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Position brute (dans le source TS) de chaque position du texte évalué d'un littéral gabarit :
 * TypeScript normalise CRLF en LF et interprète les séquences d'échappement.
 * Renvoie null si une séquence n'est pas reconnue.
 */
export function cookedToRawOffsets(raw, cooked) {
  const map = new Array(cooked.length + 1);
  let i = 0;
  let c = 0;
  while (c < cooked.length) {
    if (i >= raw.length) return null;
    map[c] = i;
    if (raw[i] === '\r' && raw[i + 1] === '\n' && cooked[c] === '\n') {
      i += 2;
      c += 1;
    } else if (raw[i] === '\\') {
      const next = raw[i + 1];
      const simple = { '\\': '\\', '`': '`', $: '$', "'": "'", '"': '"', n: '\n', t: '\t', r: '\r', '{': '{', '}': '}' };
      if (next in simple && cooked[c] === simple[next]) {
        i += 2;
        c += 1;
      } else if (next === 'u' && raw[i + 2] !== '{' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
        i += 6;
        c += 1;
      } else {
        return null;
      }
    } else if (raw[i] === cooked[c]) {
      i++;
      c++;
    } else {
      return null;
    }
  }
  map[cooked.length] = i;
  return map;
}

/**
 * Champs de classe dont la valeur française est statique : `$localize` sans substitution
 * (texte après le bloc `:…:`) ou chaîne littérale d'un champ `loc_*`. Les codemods i18n y ont
 * remonté les littéraux des templates.
 */
export function staticTextFields(rel, source) {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fields = new Map();
  const visit = node => {
    if (ts.isPropertyDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (
        ts.isTaggedTemplateExpression(init) &&
        init.tag.getText(sf) === '$localize' &&
        ts.isNoSubstitutionTemplateLiteral(init.template) &&
        // Champs passés en $localize par le codemod TS (ID « … .ts.slug.hash8 ») : ils étaient des
        // chaînes simples dans la référence, non résolues ; on les laisse donc non résolus aussi.
        !/^:@@[^:]*\.ts\.[a-z0-9.]*\.[0-9a-f]{8}:/.test(init.template.text)
      ) {
        fields.set(node.name.text, init.template.text.replace(/^:[^:]*:/, ''));
      } else if (node.name.text.startsWith('loc_') && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) {
        fields.set(node.name.text, init.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return fields;
}

function collectFieldReads(ast, fields, out) {
  if (!ast || typeof ast !== 'object') return;
  if (
    ast.constructor?.name === 'PropertyRead' &&
    fields.has(ast.name) &&
    (ast.receiver?.constructor?.name === 'ImplicitReceiver' || ast.receiver?.constructor?.name === 'ThisReceiver')
  ) {
    out.push({ start: ast.sourceSpan.start, end: ast.sourceSpan.end, name: ast.name });
    return;
  }
  for (const key of Object.keys(ast)) {
    if (/span$|Span$|^source$|^location$/.test(key)) continue;
    const value = ast[key];
    if (Array.isArray(value)) value.forEach(v => collectFieldReads(v, fields, out));
    else if (value && typeof value === 'object' && (value instanceof ng.AST || value instanceof ng.ASTWithSource)) {
      collectFieldReads(value, fields, out);
    }
  }
}

/**
 * Remplace, dans les expressions affichées (liaisons de propriété et interpolations), chaque
 * lecture d'un champ statique par son littéral français : `[label]="loc_x"` redevient
 * `[label]="'Texte'"`, la forme d'avant le codemod. Les attributs et le texte ne sont pas touchés.
 */
export function inlineStaticTextFields(template, url, fields) {
  if (!fields?.size) return template;
  // preserveWhitespaces: true : la réduction des blancs décale les positions absolues des interpolations.
  const parsed = ng.parseTemplate(template, url, { preserveWhitespaces: true, enableLetSyntax: true });
  const reads = [];
  const visit = nodes => {
    for (const n of nodes ?? []) {
      for (const input of n.inputs ?? []) collectFieldReads(input.value, fields, reads);
      if (n instanceof ng.TmplAstBoundText) collectFieldReads(n.value, fields, reads);
      for (const key of ['children', 'branches', 'cases']) if (Array.isArray(n[key])) visit(n[key]);
      for (const key of ['empty', 'placeholder', 'loading', 'error']) if (n[key]) visit([n[key]]);
    }
  };
  visit(parsed.nodes);
  // Un `*ngIf` réexpose les liaisons de l'élément hôte sur le nœud Template : dédoublonner.
  const unique = [...new Map(reads.map(r => [r.start, r])).values()];
  let out = template;
  for (const r of unique.sort((a, b) => b.start - a.start)) {
    const text = fields.get(r.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    out = out.slice(0, r.start) + `'${text}'` + out.slice(r.end);
  }
  return out;
}

/** Tous les templates du périmètre : fichiers .html et templates inline. */
export function collectTemplates(files) {
  const templates = [];
  for (const [rel, content] of files) {
    if (rel.endsWith('.html')) {
      templates.push({ label: rel, template: content });
    } else if (rel.endsWith('.ts') && !rel.endsWith('.spec.ts') && /template\s*:/.test(content)) {
      for (const t of inlineTemplates(rel, content)) templates.push(t);
    }
  }
  return templates.sort((a, b) => a.label.localeCompare(b.label));
}

export const isTemplateSource = rel =>
  rel.endsWith('.html') || (rel.endsWith('.ts') && !rel.endsWith('.spec.ts'));

const I18N_ATTR = /^i18n(-|$)/;
const ws = s => String(s ?? '').replace(/\s+/g, ' ');
const span = s => ws(s?.toString?.() ?? '');

function isStringLiteralBinding(input) {
  const ast = input.value?.ast ?? input.value;
  return input.type === 0 && ast instanceof ng.LiteralPrimitive && typeof ast.value === 'string';
}

/**
 * Attributs d'un élément, triés. Les attributs i18n* sont ignorés ; `[x]="'texte'"` est
 * équivalent à `x="texte"` au rendu et sérialisé de la même façon.
 */
function attrPart(node, extra = []) {
  const parts = [];
  for (const a of node.attributes ?? []) {
    if (!I18N_ATTR.test(a.name)) parts.push(`${a.name}=${JSON.stringify(a.value)}`);
  }
  for (const input of node.inputs ?? []) {
    if (isStringLiteralBinding(input)) {
      const ast = input.value?.ast ?? input.value;
      parts.push(`${input.name}=${JSON.stringify(ast.value)}`);
    } else {
      parts.push(span(input.sourceSpan));
    }
  }
  for (const o of node.outputs ?? []) parts.push(span(o.sourceSpan));
  for (const r of node.references ?? []) parts.push(`#${r.name}${r.value ? `=${r.value}` : ''}`);
  for (const e of extra) parts.push(e);
  return parts.length ? ' ' + parts.sort().join(' ') : '';
}

function emitNodes(nodes, depth, out) {
  for (const node of nodes ?? []) emitNode(node, depth, out);
}

function emitNode(node, depth, out) {
  const pad = '  '.repeat(depth);
  if (node instanceof ng.TmplAstText) {
    if (node.value) {
      out.push(`${pad}#text ${JSON.stringify(ws(node.value))}`);
      out.nodes?.set(out.length - 1, node);
    }
    return;
  }
  if (node instanceof ng.TmplAstBoundText) {
    const source = node.value?.source ?? node.sourceSpan?.toString();
    out.push(`${pad}#bound ${JSON.stringify(ws(source))}`);
    out.nodes?.set(out.length - 1, node);
    return;
  }
  if (node instanceof ng.TmplAstIcu) {
    out.push(`${pad}#icu ${JSON.stringify(span(node.sourceSpan))}`);
    return;
  }
  if (node instanceof ng.TmplAstElement) {
    const transparent =
      node.name === 'ng-container' &&
      !(node.attributes ?? []).some(a => !I18N_ATTR.test(a.name)) &&
      !node.inputs?.length &&
      !node.outputs?.length &&
      !node.references?.length;
    if (transparent) {
      emitNodes(node.children, depth, out);
      return;
    }
    out.push(`${pad}<${node.name}${attrPart(node)}>`);
    emitNodes(node.children, depth + 1, out);
    out.push(`${pad}</${node.name}>`);
    return;
  }
  if (node instanceof ng.TmplAstTemplate) {
    const templateAttrs = (node.templateAttrs ?? []).map(a =>
      a instanceof ng.TmplAstTextAttribute ? `*${a.name}=${JSON.stringify(a.value)}` : `*${span(a.sourceSpan)}`
    );
    const variables = (node.variables ?? []).map(v => `let-${v.name}=${JSON.stringify(v.value)}`);
    out.push(`${pad}<ng-template:${node.tagName ?? ''}${attrPart(node, [...templateAttrs, ...variables])}>`);
    emitNodes(node.children, depth + 1, out);
    out.push(`${pad}</ng-template>`);
    return;
  }
  if (node instanceof ng.TmplAstContent) {
    out.push(`${pad}<ng-content${attrPart(node)}>`);
    emitNodes(node.children, depth + 1, out);
    out.push(`${pad}</ng-content>`);
    return;
  }
  if (node instanceof ng.TmplAstIfBlock) {
    for (const branch of node.branches) {
      out.push(`${pad}${span(branch.startSourceSpan)}`);
      emitNodes(branch.children, depth + 1, out);
    }
    out.push(`${pad}}`);
    return;
  }
  if (node instanceof ng.TmplAstForLoopBlock) {
    out.push(`${pad}${span(node.startSourceSpan)}`);
    emitNodes(node.children, depth + 1, out);
    if (node.empty) {
      out.push(`${pad}${span(node.empty.startSourceSpan)}`);
      emitNodes(node.empty.children, depth + 1, out);
    }
    out.push(`${pad}}`);
    return;
  }
  if (node instanceof ng.TmplAstSwitchBlock) {
    out.push(`${pad}${span(node.startSourceSpan)}`);
    for (const c of node.cases) {
      out.push(`${pad}  ${span(c.startSourceSpan)}`);
      emitNodes(c.children, depth + 2, out);
    }
    out.push(`${pad}}`);
    return;
  }
  if (node instanceof ng.TmplAstDeferredBlock) {
    out.push(`${pad}${span(node.startSourceSpan)}`);
    emitNodes(node.children, depth + 1, out);
    for (const sub of [node.placeholder, node.loading, node.error]) {
      if (!sub) continue;
      out.push(`${pad}${span(sub.startSourceSpan)}`);
      emitNodes(sub.children, depth + 1, out);
    }
    out.push(`${pad}}`);
    return;
  }
  if (node instanceof ng.TmplAstLetDeclaration) {
    out.push(`${pad}${span(node.sourceSpan)}`);
    return;
  }
  if (node instanceof ng.TmplAstUnknownBlock) {
    out.push(`${pad}@${node.name}`);
    return;
  }
  out.push(`${pad}#${node?.constructor?.name ?? 'inconnu'}`);
}

/**
 * Forme canonique du rendu français : une ligne par nœud, espaces fusionnés mais jamais rognés.
 * Avec `withNodes`, `nodes` associe l'index d'une ligne de texte à son nœud (et à son intervalle source).
 */
export function canonicalTemplate(template, url, { withNodes = false } = {}) {
  const parsed = ng.parseTemplate(template, url, {
    preserveWhitespaces: false,
    enableLetSyntax: true
  });
  const errors = (parsed.errors ?? []).map(e => `${e.msg ?? e}`);
  const lines = [];
  if (withNodes) lines.nodes = new Map();
  emitNodes(parsed.nodes, 0, lines);
  return { lines: [...lines], errors, nodes: lines.nodes ?? null };
}

// ---------------------------------------------------------------------------------------------
// Diff ligne à ligne

/** Opérations d'alignement LCS entre deux listes de lignes (i : index dans a, j : index dans b). */
export function diffOps(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > 16_000_000) return null;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ t: ' ', s: a[i], i, j });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i * (m + 1) + j + 1] >= dp[(i + 1) * (m + 1) + j])) {
      ops.push({ t: '+', s: b[j], i, j });
      j++;
    } else {
      ops.push({ t: '-', s: a[i], i, j });
      i++;
    }
  }
  return ops;
}

/** Hunks de diff ; au-delà de 16 M cellules, on signale seulement la première divergence. */
export function lineDiff(a, b, context = 2) {
  const ops = diffOps(a, b);
  if (!ops) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [{ first: i, lines: [`- ${a[i] ?? '(fin)'}`, `+ ${b[i] ?? '(fin)'}`] }];
  }
  const hunks = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === ' ') {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    while (end < ops.length) {
      if (ops[end].t !== ' ') {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run].t === ' ') run++;
      if (run > context * 2 || end + run === ops.length) break;
      end += run;
    }
    const stop = Math.min(ops.length, end + context);
    hunks.push({
      first: ops[start].i,
      lines: ops.slice(start, stop).map(o => `${o.t} ${o.s}`)
    });
    k = stop;
  }
  return hunks;
}
