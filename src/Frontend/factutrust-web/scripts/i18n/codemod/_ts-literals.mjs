/**
 * Classifieur AST (API TypeScript) des littéraux français hors `$localize`.
 *
 *  - DISPLAY : texte affiché à coup sûr (toast, libellé de menu, en-tête de dialogue, signal
 *    d'erreur, repli d'extractErrorMessage…) → le codemod l'enveloppe en `$localize`.
 *  - NEVER   : valeur, clé, comparaison, route, fichier, journal, prompt IA… → jamais touché.
 *  - REVIEW  : le reste, à revoir à la main.
 *
 * Partagé par l'inventaire et le codemod (localize-ts-ast.mjs).
 */
import path from 'node:path';
import ts from 'typescript';
import { hasTranslatableWords } from './_untagged.mjs';

/** Propriétés d'objet affichées telles quelles (MenuItem, ConfirmationService, colonnes, options…). */
export const DISPLAY_KEYS = new Set([
  'label', 'header', 'summary', 'detail', 'message', 'title', 'subtitle', 'description', 'placeholder',
  'tooltip', 'tooltipText', 'acceptLabel', 'rejectLabel', 'confirmLabel', 'cancelLabel', 'actionLabel',
  'retryLabel', 'text', 'hint', 'helpText', 'emptyMessage', 'emptyText', 'emptyTitle', 'emptyDescription',
  'ariaLabel', 'caption', 'subheader', 'legend', 'loadingText', 'successMessage', 'errorMessage',
  'warningMessage', 'infoMessage', 'confirmMessage', 'noDataMessage', 'heading', 'sublabel', 'subLabel',
  'badgeLabel', 'buttonLabel', 'displayName', 'displayLabel', 'shortLabel', 'longLabel', 'titleText',
  'emptyStateTitle', 'emptyStateDescription', 'lead', 'kicker', 'eyebrow'
]);

/** Méthodes d'affichage de notifications (receveur toast/message/notification). */
const NOTIFY_METHODS = new Set([
  'success', 'error', 'warning', 'warn', 'info', 'show', 'showSuccess', 'showError', 'showWarning', 'showInfo',
  'add', 'notify', 'notifySuccess', 'notifyError', 'notifyWarning', 'notifyInfo'
]);
const NOTIFY_RECEIVER = /toast|notif|message|snack|alert/i;

/** Fonctions dont un argument texte est un message affiché (repli d'erreur). */
const ERROR_FALLBACK_CALLS = new Set([
  'extractErrorMessage', 'getErrorMessage', 'handleError', 'handleHttpError', 'showError', 'resolveErrorMessage',
  'errorMessage', 'toErrorMessage', 'describeError', 'userMessage', 'apiErrorMessage'
]);

/** Signaux / champs d'état porteurs de texte affiché : `this.error.set('…')`, `this.message = '…'`. */
const DISPLAY_STATE = /(error|errors|message|messages|warning|info|notice|title|label|hint|subtitle|description|caption|placeholder|status(Text|Message|Label)|feedback|banner|toastText|loadingText|emptyText)$/i;

/** Propriétés de valeur : jamais traduites. */
const VALUE_KEYS = new Set([
  'value', 'key', 'id', 'code', 'field', 'type', 'kind', 'severity', 'icon', 'styleClass', 'class', 'routerLink',
  'path', 'route', 'url', 'href', 'queryParams', 'fragment', 'name', 'dataKey', 'sortField', 'filterField',
  'format', 'dateFormat', 'mode', 'status', 'color', 'variant', 'size', 'width', 'height', 'prompt', 'systemPrompt',
  'instructions', 'model', 'role', 'permission', 'permissions', 'feature', 'module', 'fileName', 'filename',
  'extension', 'mimeType', 'accept', 'pattern', 'regex', 'locale', 'currency', 'unit', 'endpoint', 'method',
  'storageKey', 'cacheKey', 'eventName', 'action', 'command', 'target', 'selector', 'templateUrl', 'styleUrl',
  'styleUrls', 'styles', 'template', 'providedIn', 'loadComponent', 'loadChildren', 'redirectTo', 'pathMatch',
  'canActivate', 'outlet', 'placement', 'position', 'appendTo', 'tooltipPosition', 'iconPos', 'dateKey', 'sheetName'
]);

const API_RECEIVER = /http|api|client|service|store|facade|repository|repo/i;
const UI_RECEIVER = /toast|message|notif|confirm|dialog|snack|alert|menu/i;
const API_METHOD = /^(post|put|patch|create|update|save|send|submit|upsert|import|generate|execute|run|request|persist|register|add[A-Z])/;
const PAYLOAD_NAME = /(payload|request|body|dto|command|params|input|draft|form(Value|Data)?|data)$/i;
const PAYLOAD_TYPE = /(Request|Dto|DTO|Command|Payload|Input|Body)/;

/**
 * L'objet qui porte la propriété est-il une charge envoyée à l'API (données, pas affichage) ?
 * Remonte les littéraux objet / tableau imbriqués jusqu'au premier contexte d'usage.
 */
function apiPayloadContext(prop) {
  let n = prop.parent;
  while (n && (ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isPropertyAssignment(n) ||
    ts.isParenthesizedExpression(n) || ts.isSpreadAssignment(n) || ts.isSpreadElement(n))) {
    const up = n.parent;
    if (!up) break;
    if (ts.isAsExpression(up) && PAYLOAD_TYPE.test(up.type.getText())) return `as ${up.type.getText()}`;
    if (ts.isCallExpression(up) && up.arguments.includes(n)) {
      const { name, receiver } = calleeName(up);
      if (UI_RECEIVER.test(receiver) || UI_RECEIVER.test(name)) return null;
      if (API_RECEIVER.test(receiver) || API_METHOD.test(name)) return `${receiver ? receiver + '.' : ''}${name}`;
      return null;
    }
    if (ts.isVariableDeclaration(up)) {
      const vname = up.name.getText();
      if (PAYLOAD_NAME.test(vname) || (up.type && PAYLOAD_TYPE.test(up.type.getText()))) return `variable ${vname}`;
      return null;
    }
    if (ts.isReturnStatement(up)) {
      const fn = ts.findAncestor(up, x => ts.isFunctionLike(x));
      const fname = fn && fn.name ? fn.name.getText() : '';
      if (/^(build|to|map|create)\w*(Payload|Request|Dto|Command|Body)$/i.test(fname)) return `retour de ${fname}`;
      if (fn && fn.type && PAYLOAD_TYPE.test(fn.type.getText())) return `retour typé ${fn.type.getText()}`;
      return null;
    }
    n = up;
  }
  return null;
}

/** Le texte a-t-il l'air français (accents, mots-outils) plutôt qu'une valeur anglaise technique ? */
export function frenchLooking(text) {
  const t = ` ${String(text).toLowerCase()} `;
  if (/[éèêëàâîïôûùçœ«»’]/.test(t)) return true;
  return /\s(le|la|les|des|du|de|un|une|et|ou|pour|avec|sans|est|sont|sur|dans|aucun|aucune|votre|vos|ce|cette|ces|pas|non|oui|impossible|veuillez|erreur|montant|facture|client|fournisseur|produit|stock|compte|date|période|total|jour|jours|mois|année)\s/.test(t);
}

/** Fonctions dont le retour est un texte affiché (libellé, message, description…). */
const DISPLAY_FN = /(Label|Labels|Message|Error|Text|Title|Description|Hint|Caption|Tooltip|Placeholder|Header|Subtitle|Summary|Name|Wording|Explanation)$|^(describe|format|humanize|explain|label|message|title)/;
/** Noms de fonctions de fichiers / exports / feuilles : le texte reste celui du document. */
const NOT_DISPLAY_FN = /(Sheet|Csv|CSV|Excel|Xlsx|Export|File|Filename|Prompt|Payload|Query|Sql|Key)/;
/** Variables porteuses d'un texte affiché. */
const DISPLAY_VAR = /^(error|err)?(Message|Msg)$|^(message|msg|header|detail|details|hint|hintMessage|label|title|subtitle|description|summary|caption|text|warning|notice|confirmMessage|successMessage|periodLabel|prevLabel|nextLabel|usageLabel|UNSAVED_CHANGES_MESSAGE)$/i;

/** `'A' | 'B'` ou `'A'` : type fait de littéraux chaîne. */
function isLiteralUnionType(type) {
  if (ts.isLiteralTypeNode(type)) return true;
  if (ts.isUnionTypeNode(type)) return type.types.every(t => ts.isLiteralTypeNode(t) || t.kind === ts.SyntaxKind.NullKeyword || t.kind === ts.SyntaxKind.UndefinedKeyword);
  return false;
}

const isLocalizeTag = n => ts.isTaggedTemplateExpression(n) && n.tag.getText() === '$localize';

/** Texte statique d'un littéral (sans les ${} d'un gabarit). */
export function staticTextOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join(' ');
  return '';
}

/** Ressemble à une valeur technique plutôt qu'à du texte : identifiant, chemin, URL, CSS, format… */
export function looksTechnical(text) {
  const t = text.trim();
  if (!t) return true;
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return true; // camelCase
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return true; // PascalCase composé
  if (/^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/.test(t)) return true; // kebab / snake / dotted
  if (/^[A-Z0-9_]+$/.test(t)) return true; // CONSTANTE
  if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|assets\/)/.test(t)) return true; // URL, chemin
  if (/\.(ts|js|json|html|scss|css|png|jpe?g|svg|pdf|csv|xlsx?|docx?|xml|txt|zip)$/i.test(t)) return true;
  if (/^(pi|fa|fa-solid|fa-regular|p|tw|ft|mat)[- ]/.test(t)) return true; // classes d'icône/CSS
  if (/^var\(--/.test(t) || /^#[0-9a-f]{3,8}$/i.test(t) || /^(rgb|hsl)a?\(/.test(t)) return true;
  if (/^[dMyHhms\/.:\s,-]+$/.test(t) && /[dMyHh]{2}/.test(t)) return true; // format de date
  if (/^\s*[{[<]/.test(t)) return true; // JSON / HTML / SQL embarqué
  if (/\b(SELECT|INSERT|UPDATE|DELETE)\b.*\b(FROM|INTO|SET)\b/.test(t)) return true;
  return false;
}

function propName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isPrivateIdentifier(node)) return node.text;
  return null;
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return { name: e.text, receiver: '' };
  if (ts.isPropertyAccessExpression(e)) return { name: e.name.text, receiver: e.expression.getText() };
  return { name: '', receiver: '' };
}

/**
 * Remonte depuis le littéral au travers des expressions transparentes (ternaire, ??, ||,
 * parenthèses, concaténation, `as`) et classe selon le premier contexte significatif.
 */
export function classify(node) {
  let child = node;
  let parent = node.parent;
  while (parent) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression?.(parent) ||
      ts.isNonNullExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== child) ||
      (ts.isBinaryExpression(parent) &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(
          parent.operatorToken.kind
        ))
    ) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    break;
  }
  if (!parent) return { kind: 'REVIEW', reason: 'racine' };

  // Jamais : comparaisons, cas de switch, clés, imports, journaux.
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op)) {
      return { kind: 'NEVER', reason: 'comparaison' };
    }
    if (op === ts.SyntaxKind.EqualsToken && parent.right === child) {
      const target = parent.left;
      const name = ts.isPropertyAccessExpression(target) ? target.name.text : ts.isIdentifier(target) ? target.text : '';
      if (DISPLAY_STATE.test(name)) return { kind: 'DISPLAY', reason: `affectation ${name}` };
      return { kind: 'REVIEW', reason: `affectation ${name}` };
    }
  }
  if (ts.isCaseClause(parent)) return { kind: 'NEVER', reason: 'case' };
  if (ts.isElementAccessExpression(parent)) return { kind: 'NEVER', reason: 'clé' };
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) {
    return { kind: 'NEVER', reason: 'import' };
  }
  if (ts.isPropertyAssignment(parent) && parent.name === child) return { kind: 'NEVER', reason: 'nom de propriété' };
  if (ts.isEnumMember(parent)) return { kind: 'NEVER', reason: 'enum' };
  if (ts.isLiteralTypeNode(parent)) return { kind: 'NEVER', reason: 'type' };

  if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
    const key = propName(parent.name);
    if (key && VALUE_KEYS.has(key)) return { kind: 'NEVER', reason: `valeur ${key}` };
    if (key && DISPLAY_KEYS.has(key)) {
      const payload = apiPayloadContext(parent);
      if (payload) return { kind: 'REVIEW', reason: `charge API (${payload})` };
      return { kind: 'DISPLAY', reason: `propriété ${key}` };
    }
    return { kind: 'REVIEW', reason: `propriété ${key}` };
  }

  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const { name, receiver } = ts.isCallExpression(parent) ? calleeName(parent) : { name: parent.expression.getText(), receiver: '' };
    if (/^console\./.test(parent.expression.getText())) return { kind: 'NEVER', reason: 'console' };
    if (/(localStorage|sessionStorage)\b/.test(receiver) || /^(getItem|setItem|removeItem)$/.test(name)) {
      return { kind: 'NEVER', reason: 'stockage' };
    }
    if (/^(includes|startsWith|endsWith|indexOf|lastIndexOf|split|replace|replaceAll|match|test|localeCompare|has|get|delete|set|append|navigate|navigateByUrl|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|emit|dispatchEvent|require|import)$/.test(name) &&
      !(name === 'set' && DISPLAY_STATE.test(receiver.split('.').pop() ?? ''))) {
      if (name === 'set' || name === 'emit') return { kind: 'REVIEW', reason: `${receiver}.${name}` };
      return { kind: 'NEVER', reason: `appel ${name}` };
    }
    if (name === 'set' && DISPLAY_STATE.test(receiver.split('.').pop() ?? '')) {
      return { kind: 'DISPLAY', reason: `${receiver}.set` };
    }
    if (NOTIFY_METHODS.has(name) && NOTIFY_RECEIVER.test(receiver)) return { kind: 'DISPLAY', reason: `${receiver}.${name}` };
    if (ERROR_FALLBACK_CALLS.has(name) && parent.arguments?.indexOf(child) > 0) {
      return { kind: 'DISPLAY', reason: `${name}(repli)` };
    }
    if (/^(Error|TypeError|RangeError|HttpParams|URL|URLSearchParams|RegExp|Date|Blob|File)$/.test(name)) {
      return { kind: 'NEVER', reason: `new ${name}` };
    }
    if (/^(alert|confirm|prompt)$/.test(name) && !receiver) return { kind: 'DISPLAY', reason: `${name}()` };
    return { kind: 'REVIEW', reason: `argument de ${receiver ? receiver + '.' : ''}${name}` };
  }

  if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === child)) {
    const fn = ts.isArrowFunction(parent) ? parent : ts.findAncestor(parent, n => ts.isFunctionLike(n));
    let fname = fn && fn.name ? fn.name.getText() : '';
    if (!fname && fn && ts.isVariableDeclaration(fn.parent)) fname = fn.parent.name.getText();
    if (!fname && fn && ts.isPropertyAssignment(fn.parent)) fname = fn.parent.name.getText();
    if (DISPLAY_FN.test(fname) && !NOT_DISPLAY_FN.test(fname) && frenchLooking(staticTextOf(node))) {
      return { kind: 'DISPLAY', reason: `retour de ${fname}` };
    }
    if (/(Label|Title|Text|Message|Description|Hint|Caption|Tooltip|Placeholder|Header|Subtitle|Summary|Display)$/i.test(fname)) {
      return { kind: 'REVIEW', reason: `retour de ${fname}` };
    }
    return { kind: 'REVIEW', reason: `retour de ${fname || 'fonction'}` };
  }

  if (ts.isVariableDeclaration(parent)) {
    const vname = parent.name.getText();
    if (DISPLAY_VAR.test(vname) && frenchLooking(staticTextOf(node))) {
      // Une variable ensuite envoyée à l'IA ou au serveur est une donnée (prompt), pas un affichage.
      const scope = ts.findAncestor(parent, n => ts.isFunctionLike(n) || ts.isSourceFile(n));
      const sent = new RegExp(String.raw`\b(send|ask|prompt|stream|chat|submit|complete|post)\w*\(\s*` + vname + String.raw`\b`);
      if (scope && sent.test(scope.getText())) return { kind: 'REVIEW', reason: `variable ${vname} envoyée` };
      return { kind: 'DISPLAY', reason: `variable ${vname}` };
    }
    return { kind: 'REVIEW', reason: `variable ${vname}` };
  }
  // Déclaration typée par une union de littéraux (`'Client' | 'Fournisseur'`) : c'est une valeur.
  if ((ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) &&
    parent.type && isLiteralUnionType(parent.type)) {
    return { kind: 'NEVER', reason: 'type littéral' };
  }
  if (ts.isPropertyDeclaration(parent)) {
    const name = parent.name.getText();
    if (DISPLAY_STATE.test(name) || DISPLAY_KEYS.has(name)) return { kind: 'DISPLAY', reason: `champ ${name}` };
    return { kind: 'REVIEW', reason: `champ ${name}` };
  }
  if (ts.isArrayLiteralExpression(parent)) return { kind: 'REVIEW', reason: 'élément de tableau' };
  return { kind: 'REVIEW', reason: ts.SyntaxKind[parent.kind] };
}

/** Parcourt un fichier et rend les littéraux français hors $localize, classés. */
export function scanFile(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  // Fichiers qui construisent ce qui est envoyé à l'IA ou au serveur : jamais d'enveloppe automatique.
  const dataFile = /(payload|prompt)[^/]*\.ts$/i.test(file);
  const visit = node => {
    if (isLocalizeTag(node)) return;
    if (ts.isDecorator(node)) return; // templates inline : pris en charge par le pipeline des templates
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = staticTextOf(node);
      if (hasTranslatableWords(text) && !looksTechnical(text) && /[a-zà-ÿ]{2}/i.test(text)) {
        let c = classify(node);
        if (dataFile && c.kind === 'DISPLAY') c = { kind: 'REVIEW', reason: `fichier de données (${c.reason})` };
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        out.push({ file, line: line + 1, start: node.getStart(), end: node.getEnd(), node, text, ...c });
      }
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach(s => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sf, found: out };
}

export const rel = (web, abs) => path.relative(web, abs).replace(/\\/g, '/');
