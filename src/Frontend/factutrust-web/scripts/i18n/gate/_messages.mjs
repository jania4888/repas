/**
 * Inventaire des messages i18n du périmètre société, tels que le compilateur les voit :
 * templates (`i18n`, `i18n-*`) via parseTemplate et `$localize` via l'AST TypeScript.
 */
import ts from 'typescript';
import * as ng from '@angular/compiler';
import { collectTemplates, isTemplateSource, listWorkFiles, readWorkFile } from '../verify/_lib.mjs';

/** Placeholders d'une chaîne au format runtime (`{$NOM}`). */
export function runtimePlaceholders(text) {
  return [...String(text ?? '').matchAll(/\{\$([^}]+)\}/g)].map(m => m[1]).sort();
}

function templateMessageText(message) {
  const render = nodes =>
    nodes
      .map(n => {
        if (n.constructor?.name === 'Text') return n.value;
        if (n.constructor?.name === 'Container') return render(n.children);
        if (n.constructor?.name === 'TagPlaceholder') {
          return n.isVoid ? `{$${n.startName}}` : `{$${n.startName}}${render(n.children)}{$${n.closeName}}`;
        }
        if (n.constructor?.name === 'BlockPlaceholder') {
          return `{$${n.startName}}${render(n.children)}{$${n.closeName}}`;
        }
        if (n.name) return `{$${n.name}}`;
        return '';
      })
      .join('');
  return render(message.nodes ?? []);
}

function collectTemplateMessages(tpl, out) {
  const parsed = ng.parseTemplate(tpl.template, tpl.label, { preserveWhitespaces: false, enableLetSyntax: true });
  const seen = new Set();
  const note = (meta, kind) => {
    if (!meta || meta.constructor?.name !== 'Message' || seen.has(meta)) return;
    seen.add(meta);
    const text = templateMessageText(meta);
    out.push({
      source: 'template',
      kind,
      file: tpl.label,
      id: meta.customId || null,
      meaning: meta.meaning || '',
      text,
      placeholders: runtimePlaceholders(text)
    });
  };
  const visit = nodes => {
    for (const n of nodes ?? []) {
      note(n.i18n, 'element');
      for (const a of n.attributes ?? []) note(a.i18n, `attr:${a.name}`);
      for (const b of n.inputs ?? []) note(b.i18n, `input:${b.name}`);
      for (const key of ['children', 'branches', 'cases']) if (Array.isArray(n[key])) visit(n[key]);
      for (const key of ['empty', 'placeholder', 'loading', 'error']) if (n[key]) visit([n[key]]);
    }
  };
  visit(parsed.nodes);
}

/** Découpe un `$localize` : métadonnées `:meaning|desc@@id:` et placeholders `${x}:nom:`. */
export function parseLocalize(node, sf) {
  const tpl = node.template;
  const parts = ts.isNoSubstitutionTemplateLiteral(tpl)
    ? [tpl.text]
    : [tpl.head.text, ...tpl.templateSpans.map(s => s.literal.text)];
  let head = parts[0];
  let id = null;
  let meaning = '';
  const meta = head.match(/^:([^:]*):/);
  if (meta) {
    head = head.slice(meta[0].length);
    const block = meta[1];
    const at = block.indexOf('@@');
    if (at >= 0) id = block.slice(at + 2);
    const bar = block.indexOf('|');
    meaning = bar >= 0 ? block.slice(0, bar) : at >= 0 ? '' : block;
  }
  let text = head;
  let unnamed = 0;
  for (let i = 1; i < parts.length; i++) {
    let seg = parts[i];
    let name;
    const ph = seg.match(/^:([^:]*):/);
    if (ph) {
      name = ph[1];
      seg = seg.slice(ph[0].length);
    } else {
      name = unnamed === 0 ? 'PH' : `PH_${unnamed}`;
      unnamed++;
    }
    text += `{$${name}}${seg}`;
  }
  return { id, meaning, text, placeholders: runtimePlaceholders(text), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
}

function collectLocalizeMessages(rel, source, out) {
  if (!source.includes('$localize')) return;
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === '$localize') {
      const m = parseLocalize(node, sf);
      out.push({ source: 'localize', kind: 'ts', file: `${rel}:${m.line}`, ...m });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Tous les messages du périmètre société (copie de travail). */
export function collectMessages() {
  const files = new Map(listWorkFiles(isTemplateSource).map(rel => [rel, readWorkFile(rel)]));
  const out = [];
  for (const tpl of collectTemplates(files)) {
    if (tpl.template != null) collectTemplateMessages(tpl, out);
  }
  for (const [rel, content] of files) {
    if (rel.endsWith('.ts') && !rel.endsWith('.spec.ts')) collectLocalizeMessages(rel, content, out);
  }
  return out;
}

/**
 * Regroupe par ID personnalisé ; signale les ID portant des textes différents. Les blancs sont
 * normalisés : « Rechercher » et «  Rechercher  » reçoivent la même traduction sans dommage.
 */
export function findIdCollisions(messages) {
  const byId = new Map();
  for (const m of messages) {
    if (!m.id) continue;
    if (!byId.has(m.id)) byId.set(m.id, new Map());
    const texts = byId.get(m.id);
    const key = m.text.replace(/\s+/g, ' ').trim();
    if (!texts.has(key)) texts.set(key, []);
    texts.get(key).push(m.file);
  }
  return [...byId.entries()]
    .filter(([, texts]) => texts.size > 1)
    .map(([id, texts]) => ({ id, variants: [...texts.entries()].map(([text, files]) => ({ text, files })) }));
}
