#!/usr/bin/env node
/**
 * Codemod AST : texte français resté dans les attributs de templates, que les passes précédentes ne
 * voyaient pas (liaisons `[attr.x]`, ternaires, concaténations, attributs de composants hors liste).
 *
 *  data-label="Client"                         → data-label="Client" i18n-data-label="@@…"
 *  [title]="isEdit() ? 'Modifier' : 'Nouveau'"  → [title]="isEdit() ? loc_modifier_… : loc_nouveau_…"
 *  [attr.aria-label]="'Modifier l\'écriture ' + r.journal + ' n° ' + r.piece"
 *                                              → [attr.aria-label]="loc_modifier_l_ecriture_…(r.journal, r.piece)"
 *
 * Une concaténation devient UN message à placeholders (`$localize` dans une méthode du composant) :
 * l'arabe peut réordonner les mots. Les champs et méthodes `loc_*` sont ajoutés en tête de classe.
 * Le texte français rendu est inchangé. Les littéraux comparés (`=== 'x'`) ne sont jamais touchés.
 *
 * Usage : node scripts/i18n/codemod/localize-bound-literals.mjs [--dry-run | --check] [--only=chemin]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { DISPLAY_ATTRS, hasTranslatableWords, setIdenticalWords } from './_untagged.mjs';
import { frenchLooking } from './_ts-literals.mjs';
import { prefixFromFile } from './localize-ts-ast.mjs';
import { collectTemplates, isTemplateSource, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const ng = await import(pathToFileURL(path.join(WEB, 'node_modules/@angular/compiler/fesm2022/compiler.mjs')).href);

const OUT_OF_SCOPE = /features\/(firm|portal|platform|home|legal|virtual-street)\/|register-firm/;
/** Noms d'attributs de composants qui portent du texte affiché (en plus de DISPLAY_ATTRS). */
const DISPLAY_NAME = /(label|title|text|message|description|placeholder|tooltip|hint|header|heading|caption|aria)/i;
/** Entrées qui portent une VALEUR (jamais traduite) malgré un nom d'affichage. */
const VALUE_INPUTS = /^(partyLabel|invoiceType|value|type|mode|kind|status|severity|icon|styleClass|class|style|id|for|href|src|routerLink|queryParams|ngClass|ngStyle)$/;

const slug = t =>
  String(t)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
    .replace(/\.+$/, '') || 'texte';
const hash = (t, n) => crypto.createHash('sha1').update(t).digest('hex').slice(0, n);
const escapeCooked = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createClassifier(known = new Set()) {
  return s => typeof s === 'string' && hasTranslatableWords(s) && (frenchLooking(s) || known.has(s.trim()));
}

/** Motif regex d'un extrait du texte évalué, cherché dans le source brut (CRLF, échappements TS). */
function rawPattern(snippet, inline) {
  let out = '';
  for (let i = 0; i < snippet.length; i++) {
    const ch = snippet[i];
    if (ch === '\n') out += '\\r?\\n';
    else if (inline && ch === '\\') out += '\\\\\\\\';
    else if (inline && ch === '`') out += '\\\\`';
    else if (inline && ch === '$' && snippet[i + 1] === '{') out += '\\\\\\$';
    else out += escapeRegex(ch);
  }
  return out;
}
const toRaw = (text, inline) => (inline ? escapeCooked(text) : text);

/**
 * Réécrit une expression de liaison.
 * @returns {{ text: string, members: object[] } | null} null si rien à traduire
 */
export function rewriteExpression(source, ast, isText, prefix) {
  const members = [];
  const field = text => {
    const name = `loc_${slug(text).replace(/\./g, '_').slice(0, 36)}_${hash(text, 6)}`;
    members.push({ kind: 'field', name, id: `${prefix}.tpl.${slug(text)}.${hash(text, 8)}`, text });
    return name;
  };
  // `+` est associatif à gauche : seule la branche gauche prolonge la chaîne. Un `+` à droite vient
  // de parenthèses (`'Ligne ' + (i + 1)`) : c'est une addition, un seul placeholder.
  const flatPlus = (n, out = []) => {
    if (n instanceof ng.Binary && n.operation === '+') {
      flatPlus(n.left, out);
      out.push(n.right);
    } else out.push(n);
    return out;
  };
  const isStr = n => n instanceof ng.LiteralPrimitive && typeof n.value === 'string';
  // Angular 20 : le parseur conserve les parenthèses sous forme de nœud ParenthesizedExpression.
  const isParen = n => typeof ng.ParenthesizedExpression !== 'undefined' && n instanceof ng.ParenthesizedExpression;
  const phName = (n, used) => {
    const src = source.slice(n.span.start, n.span.end);
    const ids = src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? ['p'];
    const base = ids.filter(x => !/^(null|undefined|true|false)$/.test(x)).pop() ?? 'p';
    let name = base;
    let i = 1;
    while (used.has(name)) name = `${base}${i++}`;
    used.add(name);
    return name;
  };
  // Rend le texte d'un nœud en y appliquant les remplacements de ses descendants.
  const render = n => {
    if (isStr(n) && isText(n.value)) return field(n.value);
    if (n instanceof ng.Binary && n.operation === '+') {
      const parts = flatPlus(n);
      if (parts.some(p => isStr(p) && isText(p.value)) && parts.some(p => !isStr(p))) {
        const used = new Set();
        let message = '';
        let idText = '';
        const args = [];
        const params = [];
        for (const p of parts) {
          if (isStr(p)) {
            message += escapeCooked(p.value);
            idText += p.value;
          } else {
            const name = phName(p, used);
            params.push(`p${args.length}`);
            message += `\${p${args.length}}:${name}:`;
            idText += `{${name}}`;
            // Un argument parenthèsé (`(i + 1)`) est rendu sans ses parenthèses.
            args.push(render(isParen(p) ? p.expression : p));
          }
        }
        const name = `loc_${slug(idText).replace(/\./g, '_').slice(0, 36)}_${hash(idText, 6)}`;
        members.push({ kind: 'method', name, id: `${prefix}.tpl.${slug(idText)}.${hash(idText, 8)}`, params, message });
        return `${name}(${args.join(', ')})`;
      }
    }
    // Parenthèses : réécriture du contenu, parenthèses préservées autour.
    if (isParen(n)) {
      const inner = render(n.expression);
      const origInner = source.slice(n.expression.span.start, n.expression.span.end);
      if (inner === origInner) return source.slice(n.span.start, n.span.end);
      return '(' + inner + ')';
    }
    const children = [];
    if (n instanceof ng.Conditional) children.push(n.trueExp, n.falseExp);
    else if (n instanceof ng.Binary && /^(\|\||\?\?|\+)$/.test(n.operation)) children.push(n.left, n.right);
    let text = source.slice(n.span.start, n.span.end);
    for (const c of children.sort((a, b) => b.span.start - a.span.start)) {
      const r = render(c);
      const orig = source.slice(c.span.start, c.span.end);
      if (r !== orig) text = text.slice(0, c.span.start - n.span.start) + r + text.slice(c.span.end - n.span.start);
    }
    return text;
  };
  const root = ast instanceof ng.ASTWithSource ? ast.ast : ast;
  const out = render(root);
  const original = source.slice(root.span.start, root.span.end);
  if (!members.length || out === original) return null;
  return { text: source.slice(0, root.span.start) + out + source.slice(root.span.end), members };
}

/** Membres de classe en TypeScript. */
function memberSource(m, indent, eol) {
  if (m.kind === 'field') return `${indent}protected readonly ${m.name} = $localize\`:@@${m.id}:${escapeCooked(m.text)}\`;`;
  const params = m.params.map(p => `${p}: unknown`).join(', ');
  return `${indent}protected ${m.name}(${params}): string {${eol}${indent}  return $localize\`:@@${m.id}:${m.message}\`;${eol}${indent}}`;
}

function insertMembers(tsText, className, templateUrl, members) {
  const sf = ts.createSourceFile('c.ts', tsText, ts.ScriptTarget.Latest, true);
  let target = null;
  const visit = n => {
    if (ts.isClassDeclaration(n) && !target) {
      const byName = className && n.name?.text === className;
      const byUrl =
        templateUrl &&
        (ts.getDecorators(n) ?? []).some(d => d.getText(sf).includes(`templateUrl: './${templateUrl}'`) || d.getText(sf).includes(`templateUrl: "./${templateUrl}"`));
      if (byName || byUrl) target = n;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!target) return null;
  const eol = tsText.includes('\r\n') ? '\r\n' : '\n';
  const open = tsText.indexOf('{', target.name ? target.name.getEnd() : target.getStart(sf));
  const existing = new Set(target.members.map(m => m.name?.getText(sf)));
  const fresh = [];
  const seen = new Set();
  for (const m of members) {
    if (existing.has(m.name) || seen.has(m.name)) continue;
    seen.add(m.name);
    fresh.push(memberSource(m, '  ', eol));
  }
  if (!fresh.length) return tsText;
  return tsText.slice(0, open + 1) + eol + fresh.join(eol) + eol + tsText.slice(open + 1);
}

function processTemplate(t, isText, fileTexts) {
  const inline = t.label.includes('#');
  const file = t.label.replace(/#.*$/, '');
  const prefix = prefixFromFile(file.replace(/\.html$/, '.ts'));
  let parsed;
  try {
    parsed = ng.parseTemplate(t.template, file, { preserveWhitespaces: false });
  } catch {
    return { changes: 0 };
  }
  if (parsed.errors?.length) return { changes: 0 };
  const edits = []; // { pattern, replacement } sur le texte évalué du template
  const members = [];
  const visit = nodes => {
    for (const n of nodes ?? []) {
      if (n instanceof ng.TmplAstElement || n instanceof ng.TmplAstTemplate) {
        const i18nAttrs = new Set((n.attributes ?? []).filter(a => a.name.startsWith('i18n-')).map(a => a.name.slice(5)));
        for (const a of n.attributes ?? []) {
          if (a.name.startsWith('i18n') || a.i18n || i18nAttrs.has(a.name) || VALUE_INPUTS.test(a.name)) continue;
          if (!(DISPLAY_ATTRS.has(a.name) || DISPLAY_NAME.test(a.name)) || !isText(a.value)) continue;
          const id = `${prefix}.${slug(a.value)}.${hash(a.value, 8)}`;
          edits.push({ kind: 'static', name: a.name, value: a.value, id });
        }
        for (const b of n.inputs ?? []) {
          const name = b.name;
          if (VALUE_INPUTS.test(name) || b.type > 1) continue;
          const source = b.value?.source;
          if (typeof source !== 'string') continue;
          const r = rewriteExpression(source, b.value, isText, prefix);
          if (!r) continue;
          edits.push({ kind: 'bound', key: b.type === 1 ? `attr.${name}` : name, source, text: r.text });
          members.push(...r.members);
        }
      }
      visit(n.children);
      if (n.branches) for (const br of n.branches) visit(br.children);
      if (n.cases) for (const c of n.cases) visit(c.children);
      if (n.empty) visit(n.empty.children);
      if (n.placeholder) visit(n.placeholder.children);
      if (n.loading) visit(n.loading.children);
      if (n.error) visit(n.error.children);
    }
  };
  visit(parsed.nodes);
  if (!edits.length) return { changes: 0 };

  // Remplacements dans le source brut de la région du template.
  const raw = fileTexts.get(file);
  let region = inline ? raw.slice(t.rawStart, t.rawEnd) : raw;
  let applied = 0;
  const done = new Set();
  for (const e of edits) {
    const key = JSON.stringify(e);
    if (done.has(key)) continue;
    done.add(key);
    if (e.kind === 'static') {
      const re = new RegExp(`(\\s${escapeRegex(e.name)}="${rawPattern(e.value, inline)}")(?![^>]*\\si18n-${escapeRegex(e.name)}=)`, 'g');
      region = region.replace(re, m => {
        applied++;
        return `${m} i18n-${e.name}="@@${e.id}"`;
      });
    } else {
      const re = new RegExp(`\\[${escapeRegex(e.key)}\\](\\s*=\\s*)"${rawPattern(e.source, inline)}"`, 'g');
      region = region.replace(re, (m, eq) => {
        applied++;
        return `[${e.key}]${eq}"${toRaw(e.text, inline)}"`;
      });
    }
  }
  if (!applied) return { changes: 0 };
  const newFile = inline ? raw.slice(0, t.rawStart) + region + raw.slice(t.rawEnd) : region;
  fileTexts.set(file, newFile);
  if (members.length) {
    const tsFile = inline ? file : file.replace(/\.html$/, '.ts');
    const className = inline ? t.label.split('#')[1] : null;
    const tsText = fileTexts.get(tsFile) ?? readWorkFile(tsFile);
    const updated = insertMembers(tsText, className, inline ? null : path.basename(file), members);
    if (updated == null) throw new Error(`Classe introuvable pour ${t.label}`);
    fileTexts.set(tsFile, updated);
  }
  return { changes: applied };
}

async function main() {
  const check = process.argv.includes('--check');
  const dryRun = check || process.argv.includes('--dry-run');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  setIdenticalWords(JSON.parse(fs.readFileSync(path.join(WEB, 'scripts/i18n/identical-fr-whitelist.json'), 'utf8')).values);
  const fr = JSON.parse(fs.readFileSync(path.join(WEB, 'src/locale/messages.fr.arb'), 'utf8'));
  const known = new Set(Object.entries(fr).filter(([k]) => !k.startsWith('@')).map(([, v]) => String(v).trim()));
  const isText = createClassifier(known);
  const rels = listWorkFiles(isTemplateSource).filter(r => !OUT_OF_SCOPE.test(r) && (!only || r.includes(only)));
  const original = new Map(rels.map(r => [r, readWorkFile(r)]));
  const fileTexts = new Map(original);
  let total = 0;
  // Un template à la fois, relu après chaque réécriture : les offsets bruts des autres templates
  // inline du même fichier (et l'ajout de membres de classe) les décaleraient sinon.
  for (const rel of rels) {
    for (let i = 0; ; i++) {
      const templates = collectTemplates(new Map([[rel, fileTexts.get(rel)]]));
      if (i >= templates.length) break;
      if (templates[i].template == null) continue;
      total += processTemplate(templates[i], isText, fileTexts).changes;
    }
  }
  const changed = [...fileTexts].filter(([f, txt]) => original.get(f) !== txt || !original.has(f));
  if (!dryRun) for (const [f, txt] of changed) fs.writeFileSync(path.join(WEB, f), txt, 'utf8');
  for (const [f] of changed) console.log(`  ${f}`);
  console.log(`[localize-bound-literals] ${total} attribut(s) dans ${changed.length} fichier(s)${dryRun ? ' — simulation' : ''}`);
  if (check && total) {
    console.error("  → npm run i18n:bound (ou marquer l'attribut i18n-… à la main)");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
