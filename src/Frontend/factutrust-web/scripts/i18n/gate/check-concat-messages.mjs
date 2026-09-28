#!/usr/bin/env node
/**
 * Porte : une phrase affichée ne doit pas être découpée en morceaux concaténés
 * (`$localize`…` + nom + $localize`…``) : chaque morceau serait traduit seul, dans l'ordre
 * du français. `--fix` fusionne la chaîne en UN `$localize` à placeholders (texte FR identique).
 *
 * Usage : node scripts/i18n/gate/check-concat-messages.mjs [--fix]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import ts from 'typescript';

const { listTsFiles } = await import(new URL('../inventory-ts-literals.mjs', import.meta.url).href);
const { prefixFromFile } = await import(new URL('../codemod/localize-ts-ast.mjs', import.meta.url).href);

const fix = process.argv.includes('--fix');
const isLoc = n => ts.isTaggedTemplateExpression(n) && n.tag.getText() === '$localize';
const escapeCooked = s =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
const stripMeta = raw => raw.replace(/^:[^:]*:/, '');

function flatten(e, out = []) {
  if (ts.isParenthesizedExpression(e) && ts.isBinaryExpression(e.expression) && e.expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return flatten(e.expression, out);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    flatten(e.left, out);
    flatten(e.right, out);
  } else out.push(e);
  return out;
}

function baseName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isCallExpression(expr)) return baseName(expr.expression);
  return 'p';
}

/** Fusionne les morceaux en un corps `$localize` (brut) et un texte de référence pour l'ID. */
function merge(parts) {
  const used = new Set();
  const name = n => {
    const base = n.replace(/[^A-Za-z0-9_]/g, '') || 'p';
    let v = base;
    let i = 1;
    while (used.has(v)) v = `${base}${i++}`;
    used.add(v);
    return v;
  };
  let body = '';
  let ref = '';
  for (const p of parts) {
    if (isLoc(p)) {
      const tpl = p.template;
      if (ts.isNoSubstitutionTemplateLiteral(tpl)) {
        body += stripMeta(tpl.rawText ?? escapeCooked(tpl.text));
        ref += stripMeta(tpl.text);
      } else {
        body += stripMeta(tpl.head.rawText ?? escapeCooked(tpl.head.text));
        ref += stripMeta(tpl.head.text);
        for (const span of tpl.templateSpans) {
          const raw = span.literal.rawText ?? escapeCooked(span.literal.text);
          const m = /^:([^:]*):/.exec(raw);
          const n = name(m ? m[1] : baseName(span.expression));
          body += '${' + span.expression.getText() + '}:' + n + ':' + (m ? raw.slice(m[0].length) : raw);
          ref += `{${n}}` + span.literal.text.replace(/^:[^:]*:/, '');
        }
      }
    } else if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) {
      body += escapeCooked(p.text);
      ref += p.text;
    } else if (ts.isTemplateExpression(p)) {
      body += p.head.rawText ?? escapeCooked(p.head.text);
      ref += p.head.text;
      for (const span of p.templateSpans) {
        const n = name(baseName(span.expression));
        body += '${' + span.expression.getText() + '}:' + n + ':' + (span.literal.rawText ?? escapeCooked(span.literal.text));
        ref += `{${n}}` + span.literal.text;
      }
    } else {
      const n = name(baseName(p));
      body += '${' + p.getText() + '}:' + n + ':';
      ref += `{${n}}`;
    }
  }
  return { body, ref };
}

let count = 0;
for (const rel of listTsFiles()) {
  let text = fs.readFileSync(rel, 'utf8');
  if (!text.includes('$localize')) continue;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = n => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const parts = flatten(n);
      const locs = parts.filter(isLoc).length;
      const texty = parts.filter(p => ts.isStringLiteral(p) && /\p{L}{2,}/u.test(p.text)).length;
      if (locs >= 2 || (locs >= 1 && texty >= 1)) {
        count++;
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
        console.log(`${rel}:${line + 1}  ${n.getText().replace(/\s+/g, ' ').slice(0, 150)}`);
        if (fix) {
          const { body, ref } = merge(parts);
          const slug = ref.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.')
            .replace(/^\.+|\.+$/g, '').slice(0, 40).replace(/\.+$/, '');
          const hash = crypto.createHash('sha1').update(ref).digest('hex').slice(0, 8);
          edits.push({
            start: n.getStart(),
            end: n.getEnd(),
            text: '$localize`:@@' + `${prefixFromFile(rel)}.ts.${slug}.${hash}:` + body + '`'
          });
        }
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (fix && edits.length) {
    for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    fs.writeFileSync(rel, text, 'utf8');
  }
}
console.log(`[i18n:concat] ${count} phrase(s) découpée(s)${fix ? ' — fusionnées' : ''}`);
process.exit(!fix && count ? 1 : 0);
