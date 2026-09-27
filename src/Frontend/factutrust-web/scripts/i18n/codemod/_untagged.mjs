/**
 * Analyse AST des templates : texte et attributs d'affichage non balisés pour i18n.
 * Partagé par l'inventaire (inventory-untagged) et le codemod (mark-untagged).
 */
import * as ng from '@angular/compiler';

/** Éléments en ligne : leur contenu fait partie de la phrase qui les entoure. */
export const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'br', 'cite', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'ng-container'
]);

/** Contenus jamais traduits. */
export const SKIP_CONTENT = new Set(['script', 'style', 'pre', 'textarea', 'svg', 'math']);

/** Attributs d'affichage (texte lu par l'utilisateur ou un lecteur d'écran). */
export const DISPLAY_ATTRS = new Set([
  'title', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription',
  'aria-valuetext', 'label', 'ariaLabel', 'header', 'subheader', 'subtitle', 'description', 'emptyMessage',
  'emptyText', 'emptyTitle', 'emptyDescription', 'pTooltip', 'tooltip', 'message', 'hint', 'helpText',
  'actionLabel', 'retryLabel', 'confirmLabel', 'cancelLabel', 'acceptLabel', 'rejectLabel', 'summary',
  'text', 'caption', 'legend', 'heading', 'badge', 'loadingText', 'searchPlaceholder', 'filterPlaceholder',
  'chooseLabel', 'uploadLabel', 'offLabel', 'onLabel', 'currentPageReportTemplate', 'emptyFilterMessage',
  'selectedItemsLabel', 'emptySelectionMessage', 'ariaCloseLabel', 'closeAriaLabel', 'buttonLabel',
  'tooltipText', 'sublabel', 'subLabel', 'eyebrow', 'kicker', 'lead', 'pageTitle', 'sectionTitle'
]);

/** Texte réellement affiché : au moins deux lettres, hors placeholders d'exemple purement techniques. */
export function hasWords(text) {
  const t = String(text ?? '').replace(/\{\{[\s\S]*?\}\}/g, ' ').trim();
  return /\p{L}{2,}/u.test(t);
}

const isElement = n => n instanceof ng.TmplAstElement;
const isText = n => n instanceof ng.TmplAstText;
const isBound = n => n instanceof ng.TmplAstBoundText;
const isIcu = n => n instanceof ng.TmplAstIcu;

const hasI18nContent = n => (n.attributes ?? []).some(a => a.name === 'i18n') || (n.i18n && n.i18n.constructor?.name === 'Message');

/** Un élément en ligne « simple » : seulement du texte, des interpolations et d'autres éléments en ligne simples. */
export function isSimpleInline(node) {
  // `<ng-container *ngIf>` / `<span *ngIf>` en ligne : placeholder du message englobant (Angular l'accepte).
  if (node instanceof ng.TmplAstTemplate) {
    return !!node.tagName && INLINE.has(node.tagName) && !(node.references ?? []).length &&
      (node.children ?? []).length > 0 && node.children.every(isSimpleInline);
  }
  if (!isElement(node) || !INLINE.has(node.name)) return false;
  if ((node.references ?? []).length) return false;
  return (node.children ?? []).every(c => isText(c) || isBound(c) || isSimpleInline(c));
}

/** Contenu de phrase : texte, interpolation, élément en ligne simple. */
export const isPhrasing = n => isText(n) || isBound(n) || isSimpleInline(n);

/** Texte statique d'une interpolation (hors expressions). */
export function staticText(node) {
  if (isText(node)) return node.value;
  if (isBound(node)) return (node.value?.source ?? '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
  if (isElement(node) || node instanceof ng.TmplAstTemplate) return (node.children ?? []).map(staticText).join(' ');
  return '';
}

/** Texte statique pas encore couvert par un `i18n` (les sous-arbres déjà balisés sont ignorés). */
export function untaggedText(node) {
  if (isElement(node) && hasI18nContent(node)) return '';
  if (isElement(node) || node instanceof ng.TmplAstTemplate) return (node.children ?? []).map(untaggedText).join(' ');
  return staticText(node);
}

/** Sigles et noms propres affichés tels quels : jamais « à traduire » à eux seuls. */
let identicalWords = new Set();
export function setIdenticalWords(values) {
  identicalWords = new Set(values);
}

/** Des mots restent-ils à traduire, une fois retirés les sigles de la liste blanche ? */
export function hasTranslatableWords(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (identicalWords.has(t)) return false;
  const stripped = t
    .split(/[\s·•|/,;:()\[\]«»"'+\-–—]+/)
    .filter(w => w && !identicalWords.has(w))
    .join(' ');
  return hasWords(stripped);
}

/** A-t-on du texte à traduire (non encore balisé) dans cette suite de nœuds ? */
export const runHasWords = run => hasTranslatableWords(run.map(untaggedText).join(' '));

/**
 * Parcourt un template et rend les « trouvailles » :
 *  - element-content : un élément dont TOUT le contenu est une phrase non balisée → i18n sur l'élément ;
 *  - run : une suite de nœuds de phrase non balisés, au milieu de blocs ou de composants → ng-container i18n ;
 *  - attr : attribut d'affichage statique sans i18n-attr ;
 *  - bound-literal : [attr]="'Texte'" (liaison d'un littéral) sans i18n.
 */
export function findUntagged(template, url) {
  const parsed = ng.parseTemplate(template, url, { preserveWhitespaces: true, enableLetSyntax: true });
  const out = [];
  if (parsed.errors?.length) return { out, errors: parsed.errors };

  const visitChildren = (children, parentEl, inI18n) => {
    const kids = children ?? [];
    // Cas 1 : tout le contenu est une phrase → balise sur le parent (s'il existe et n'est pas transparent).
    if (!inI18n && parentEl && kids.length && kids.every(isPhrasing) && runHasWords(kids)) {
      out.push({ kind: 'element-content', node: parentEl, run: kids });
      return;
    }
    // Cas 2 : suites de nœuds de phrase entre des blocs / composants.
    let run = [];
    const flush = () => {
      if (run.length && runHasWords(run) && !inI18n) out.push({ kind: 'run', node: parentEl, run: [...run] });
      run = [];
    };
    for (const k of kids) {
      if (isPhrasing(k)) {
        run.push(k);
      } else {
        flush();
        visit(k, inI18n);
      }
    }
    flush();
  };

  const visitAttrs = (el, inI18n) => {
    const i18nAttrs = new Set((el.attributes ?? []).filter(a => a.name.startsWith('i18n-')).map(a => a.name.slice(5)));
    for (const a of el.attributes ?? []) {
      if (!DISPLAY_ATTRS.has(a.name) || i18nAttrs.has(a.name) || a.i18n) continue;
      if (!hasTranslatableWords(a.value)) continue;
      out.push({ kind: 'attr', node: el, attr: a });
    }
    for (const b of el.inputs ?? []) {
      const ast = b.value?.ast ?? b.value;
      if (b.type !== 0 || !(ast instanceof ng.LiteralPrimitive) || typeof ast.value !== 'string') continue;
      const name = b.name.startsWith('attr.') ? b.name.slice(5) : b.name;
      if (!DISPLAY_ATTRS.has(name) || i18nAttrs.has(name) || !hasTranslatableWords(ast.value)) continue;
      out.push({ kind: 'bound-literal', node: el, input: b, name, value: ast.value });
    }
    void inI18n;
  };

  const visit = (node, inI18n) => {
    if (isElement(node)) {
      if (SKIP_CONTENT.has(node.name)) return;
      if ((node.attributes ?? []).some(a => a.name === 'ngNonBindable')) return;
      visitAttrs(node, inI18n);
      const nowI18n = inI18n || hasI18nContent(node);
      visitChildren(node.children, node.name === 'ng-container' && !hasI18nContent(node) ? null : node, nowI18n);
      return;
    }
    if (node instanceof ng.TmplAstTemplate) {
      visitAttrs(node, inI18n);
      visitChildren(node.children, null, inI18n || hasI18nContent(node));
      return;
    }
    if (isIcu(node)) return;
    for (const key of ['children']) if (Array.isArray(node[key])) visitChildren(node[key], null, inI18n);
    for (const key of ['branches', 'cases']) if (Array.isArray(node[key])) for (const b of node[key]) visitChildren(b.children, null, inI18n);
    for (const key of ['empty', 'placeholder', 'loading', 'error']) if (node[key]) visitChildren(node[key].children, null, inI18n);
  };

  visitChildren(parsed.nodes, null, false);
  return { out, errors: [] };
}
