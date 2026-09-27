import { DashboardConfig } from '../models/ai-chat.models';
import { getAiToolDisplayLabel } from './assistant-progress-display';

const DASHBOARD_JSON_FENCE = /```json\s*([\s\S]*?)\s*```/g;
const FT_META_FENCE = /```ft-meta\s*([\s\S]*?)\s*```/g;
const GENERIC_CODE_FENCE = /```[\s\S]*?```/g;

/**
 * Identifiants d'outils internes (snake_case, backticks optionnels) dans la prose visible.
 * Parité avec la substitution backend (SanitizeInternalToolNames) — couvre aussi les anciens
 * messages persistés AVANT le correctif serveur.
 */
const INTERNAL_TOOL_TOKEN =
  /`?\b(?:get|forecast|analyze|simulate|generate|create|record|propose|resolve|compliance|studio)_[a-z0-9]+(?:_[a-z0-9]+)*\b`?/g;

/**
 * Idéogrammes, kana, hangul, ponctuation CJK (hors BMP inclus). L'arabe et le latin ne matchent pas.
 * Parité avec AssistantVisibleContentFormatter.StripDisallowedScripts.
 */
const CJK_SCRIPT =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u3000-\u303F\u{20000}-\u{2FA1F}]/gu;

const MULTI_BLANK_LINE = /(?:[ \t]*\n){3,}/g;
const HORIZONTAL_WS_RUN = /[ \t]{2,}/g;

/** Minimum visible prose length before treating a response as complete (mirrors backend default). */
export const MIN_MEANINGFUL_ASSISTANT_CHARS = 80;

/**
 * Max rows rendered when humanizing a raw business JSON array fallback (mirrors the backend ranking cap).
 * Above this, a "… et N autre(s) ligne(s)." suffix is appended. Display-only safeguard.
 */
export const HUMANIZE_MAX_ROWS = 50;

export function isDashboardConfig(value: unknown): value is DashboardConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  return typeof o['title'] === 'string' && Array.isArray(o['sections']);
}

function isKnownToolPayload(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return true;
    }
    return value.some(item => isBusinessRow(item));
  }
  if (typeof value === 'object') {
    if (isDashboardConfig(value)) {
      return false;
    }
    return hasBusinessFields(value as Record<string, unknown>);
  }
  return false;
}

function hasBusinessFields(row: Record<string, unknown>): boolean {
  const keys = [
    'ca', 'montant', 'amount', 'total', 'revenue', 'periode', 'period',
    'productName', 'clientName', 'name', 'label', 'description', 'quantity', 'qty'
  ];
  return keys.some(k => k in row);
}

function isBusinessRow(item: unknown): item is Record<string, unknown> {
  return !!item && typeof item === 'object' && hasBusinessFields(item as Record<string, unknown>);
}

/**
 * First ```json ... ``` fence in assistant content that parses to a valid DashboardConfig.
 */
export function extractDashboardConfig(
  content: string
): { config: DashboardConfig; rawFence: string } | null {
  const regex = /```json\s*([\s\S]*?)\s*```/;
  const match = content.match(regex);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isDashboardConfig(parsed)) {
      return null;
    }
    return { config: parsed, rawFence: match[0] };
  } catch {
    return null;
  }
}

/**
 * Removes the first dashboard JSON fence from markdown when it was a valid dashboard payload.
 */
export function stripDashboardJsonFence(content: string): string {
  const extracted = extractDashboardConfig(content);
  if (!extracted) {
    return content;
  }
  return content.replace(extracted.rawFence, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Humanizes a business JSON payload into readable French prose.
 */
export function humanizeBusinessJson(json: string): string | null {
  try {
    const parsed = JSON.parse(json.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return humanizeJsonArray(parsed);
    }
    if (parsed && typeof parsed === 'object' && !isDashboardConfig(parsed)) {
      return humanizeJsonObject(parsed as Record<string, unknown>);
    }
    return null;
  } catch {
    return null;
  }
}

function humanizeJsonObject(obj: Record<string, unknown>): string | null {
  // Enveloppe CA agrégé : { totalRevenue, rowCount, currency, groupBy, period, rows: [...] }.
  // On affiche le total DÉTERMINISTE de l'outil (jamais recalculé) puis la ventilation.
  if (Array.isArray(obj['rows'])) {
    const total = pickNumber(obj, ['totalRevenue', 'total', 'ca']);
    if (total !== null) {
      const rows = obj['rows'] as unknown[];
      const periodSuffix = formatEnvelopePeriod(obj);
      if (rows.length === 0) {
        return periodSuffix
          ? $localize`:@@ai-assistant.assistant-message-display.ts.aucune.vente.sur.la.periode.periodsuffix.8b004855:Aucune vente sur la période ${periodSuffix}:periodSuffix:.`
          : $localize`:@@ai-assistant.assistant-message-display.ts.aucune.vente.sur.la.periode.97743ef9:Aucune vente sur la période.`;
      }
      const rowCount = pickNumber(obj, ['rowCount']) ?? rows.length;
      const header = periodSuffix
        ? $localize`:@@ai-assistant.assistant-message-display.ts.ca.total.periodsuffix.formattnd.rowcount.b793fa1b:CA total ${periodSuffix}:periodSuffix: : **${formatTnd(total)}:formatTnd:** (${rowCount}:rowCount: ligne(s)).`
        : $localize`:@@ai-assistant.assistant-message-display.ts.ca.total.formattnd.rowcount.ligne.s.88e6effe:CA total : **${formatTnd(total)}:formatTnd:** (${rowCount}:rowCount: ligne(s)).`;
      const breakdown = humanizeJsonArray(rows);
      return breakdown ? `${header}\n${breakdown}` : header;
    }
  }

  const parts: string[] = [];
  const amount = pickNumber(obj, ['ca', 'montant', 'amount', 'total', 'totalAmount', 'revenue']);
  if (amount !== null) {
    parts.push(`Montant : **${formatTnd(amount)}**.`);
  }
  const period = pickString(obj, ['periode', 'period', 'periodLabel', 'label']);
  if (period) {
    parts.push(`Période : ${period}.`);
  }
  const count = pickNumber(obj, ['count', 'nombre', 'totalCount']);
  if (count !== null && amount === null) {
    parts.push(`Nombre d'éléments : ${count}.`);
  }
  if (parts.length === 0) {
    const preview = Object.entries(obj)
      .slice(0, 4)
      .map(([k, v]) => `${k} : ${formatScalar(v)}`)
      .join(' · ');
    return preview || null;
  }
  return parts.join(' ');
}

function humanizeJsonArray(items: unknown[]): string | null {
  if (items.length === 0) {
    return $localize`:@@ai-assistant.assistant-message-display.ts.aucune.donnee.pour.cette.periode.254e84f4:Aucune donnée pour cette période.`;
  }
  const lines: string[] = [];
  for (const item of items.slice(0, HUMANIZE_MAX_ROWS)) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = pickString(row, ['productName', 'clientName', 'name', 'label', 'description', 'groupKey']);
    if (!name) {
      continue;
    }
    const qty = pickNumber(row, ['quantity', 'qty']);
    const lineAmount = pickNumber(row, ['amount', 'montant', 'total', 'ca']);
    let line = name;
    if (qty !== null) {
      line += ` (${formatQuantity(qty)})`;
    }
    if (lineAmount !== null) {
      line += ` — ${formatTnd(lineAmount)}`;
    }
    lines.push(`- ${line}`);
  }
  if (lines.length === 0) {
    return null;
  }
  const suffix = items.length > HUMANIZE_MAX_ROWS
    ? `\n\n… et ${items.length - HUMANIZE_MAX_ROWS} autre(s) ligne(s).`
    : '';
  return lines.join('\n') + suffix;
}

/** « du 03/06/2026 au 02/07/2026 » depuis le champ period {from,to} (yyyy-MM-dd), sinon null. */
function formatEnvelopePeriod(obj: Record<string, unknown>): string | null {
  const period = obj['period'];
  if (!period || typeof period !== 'object' || Array.isArray(period)) {
    return null;
  }
  const p = period as Record<string, unknown>;
  const from = typeof p['from'] === 'string' ? p['from'] : null;
  const to = typeof p['to'] === 'string' ? p['to'] : null;
  if (!from || !to) {
    return null;
  }
  return $localize`:@@ai-assistant.assistant-message-display.ts.du.formatisodatefr.au.formatisodatefr1.dc016cd4:du ${formatIsoDateFr(from)}:formatIsoDateFr: au ${formatIsoDateFr(to)}:formatIsoDateFr1:`;
}

function formatIsoDateFr(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string') {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return formatTnd(value);
  }
  if (typeof value === 'boolean') {
    return value ? $localize`:@@ai-assistant.assistant-message-display.ts.oui.5898fc86:oui` : $localize`:@@ai-assistant.assistant-message-display.ts.non.37031f99:non`;
  }
  if (Array.isArray(value)) {
    return $localize`:@@ai-assistant.assistant-message-display.ts.length.element.s.25d37380:${value.length}:length: élément(s)`;
  }
  return String(value);
}

function formatTnd(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('fr-FR') : value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/**
 * Extracts human-readable summaries from non-dashboard JSON fences.
 */
export function humanizeBusinessJsonFences(content: string): string | null {
  const summaries: string[] = [];
  for (const match of content.matchAll(DASHBOARD_JSON_FENCE)) {
    const inner = match[1]?.trim();
    if (!inner) {
      continue;
    }
    try {
      const parsed = JSON.parse(inner) as unknown;
      if (isDashboardConfig(parsed)) {
        continue;
      }
      if (!isKnownToolPayload(parsed)) {
        continue;
      }
      const summary = humanizeBusinessJson(inner);
      if (summary?.trim()) {
        summaries.push(summary);
      }
    } catch {
      /* ignore invalid JSON */
    }
  }
  return summaries.length > 0 ? summaries.join('\n\n') : null;
}

/**
 * Removes ```json ... ``` fences whose inner JSON is a known tool payload (not dashboard).
 * Dashboard-shaped fences are kept so extractDashboardConfig / stripDashboardJsonFence can run afterward.
 */
export function stripNonDashboardJsonFences(content: string): string {
  const result = content.replace(DASHBOARD_JSON_FENCE, (full, inner: string) => {
    try {
      const parsed = JSON.parse(inner.trim()) as unknown;
      if (isDashboardConfig(parsed)) {
        return full;
      }
      if (isKnownToolPayload(parsed)) {
        return '';
      }
    } catch {
      /* keep invalid JSON fences as prose context */
      return full;
    }
    return full;
  });
  return result.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Parses persisted `ft-meta` JSON (suggested follow-up prompts).
 */
export function extractSuggestedPromptsFromContent(content: string): string[] {
  if (!content?.trim()) {
    return [];
  }
  const m = content.match(/```ft-meta\s*([\s\S]*?)\s*```/);
  if (!m?.[1]) {
    return [];
  }
  try {
    const parsed = JSON.parse(m[1].trim()) as { suggestedPrompts?: unknown };
    const sp = parsed?.suggestedPrompts;
    if (!Array.isArray(sp)) {
      return [];
    }
    return sp.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

function stripFtMetaFences(content: string): string {
  return content.replace(FT_META_FENCE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function measureVisibleProseLength(content: string): number {
  if (!content?.trim()) {
    return 0;
  }
  let c = content.replace(FT_META_FENCE, '');
  c = c.replace(DASHBOARD_JSON_FENCE, '');
  c = c.replace(GENERIC_CODE_FENCE, '');
  return c.trim().length;
}

/**
 * Ferme temporairement une fence ``` restée ouverte (contenu en cours de streaming) pour que le
 * rendu markdown progressif reste stable — jamais de bloc de code qui « avale » la suite du texte.
 * Contenu équilibré (nombre pair de ```) → inchangé.
 */
export function closePartialFences(content: string): string {
  if (!content) {
    return content;
  }
  const fenceCount = (content.match(/```/g) ?? []).length;
  return fenceCount % 2 === 1 ? `${content}\n\`\`\`` : content;
}

/**
 * Substitue les identifiants d'outils internes par leur libellé métier dans la prose visible
 * (hors fences de code). Un nom connu du map → libellé ; un token snake_case à préfixe interne
 * inconnu → libellé prettifié. Couvre les messages persistés avant l'assainissement serveur.
 */
export function sanitizeInternalToolNamesForDisplay(content: string): string {
  if (!content || !INTERNAL_TOOL_TOKEN.test(content)) {
    INTERNAL_TOOL_TOKEN.lastIndex = 0;
    return content;
  }
  INTERNAL_TOOL_TOKEN.lastIndex = 0;
  return transformOutsideCodeFences(content, segment =>
    segment.replace(INTERNAL_TOOL_TOKEN, match =>
      getAiToolDisplayLabel(match.replace(/`/g, ''))
    )
  );
}

/**
 * Retire les écritures CJK de la prose visible (hors fences) — miroir du filet serveur pour les
 * messages déjà persistés avant le correctif. Latin, chiffres, arabe conservés.
 */
export function stripDisallowedScriptsForDisplay(content: string): string {
  if (!content) {
    return content;
  }
  CJK_SCRIPT.lastIndex = 0;
  if (!CJK_SCRIPT.test(content)) {
    CJK_SCRIPT.lastIndex = 0;
    return content;
  }
  CJK_SCRIPT.lastIndex = 0;
  return transformOutsideCodeFences(content, stripCjkFromProseSegment);
}

function stripCjkFromProseSegment(segment: string): string {
  const lines = segment.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    CJK_SCRIPT.lastIndex = 0;
    if (!CJK_SCRIPT.test(line)) {
      CJK_SCRIPT.lastIndex = 0;
      kept.push(line);
      continue;
    }
    CJK_SCRIPT.lastIndex = 0;
    const stripped = line.replace(CJK_SCRIPT, '').replace(HORIZONTAL_WS_RUN, ' ');
    if (isOrphanPunctuationLine(stripped)) {
      continue;
    }
    kept.push(stripped);
  }
  return kept.join('\n').replace(MULTI_BLANK_LINE, '\n\n');
}

function isOrphanPunctuationLine(line: string): boolean {
  return !/[\p{L}\p{N}]/u.test(line);
}

function transformOutsideCodeFences(content: string, transform: (segment: string) => string): string {
  let out = '';
  let index = 0;
  for (const m of content.matchAll(GENERIC_CODE_FENCE)) {
    const start = m.index ?? 0;
    if (start > index) {
      out += transform(content.slice(index, start));
    }
    out += m[0];
    index = start + m[0].length;
  }
  if (index < content.length) {
    out += transform(content.slice(index));
  }
  return out;
}

/**
 * Remplace les fences ```json de forme {"sections":[…]} SANS title (jamais un transport de
 * tableau de bord légitime, qui exige title+sections) par des puces lisibles — corrige les
 * « indicateurs clés » affichés en JSON brut. Les fences avec title restent intactes (widget).
 */
export function replaceSectionsOnlyFences(content: string): string {
  if (!content) {
    return content;
  }
  return content.replace(DASHBOARD_JSON_FENCE, (full, inner: string) => {
    try {
      const parsed = JSON.parse(inner.trim()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return full;
      }
      const obj = parsed as Record<string, unknown>;

      // Écho des ARGUMENTS de generate_dashboard_config ({title, sections_json}) : jamais un
      // transport légitime, MÊME avec title — humanisé en puces (le widget passe par l'événement
      // dashboard + l'appendice {title, sections}).
      const sectionsJson = obj['sections_json'];
      if (sectionsJson !== undefined) {
        const entries = coerceSectionsArray(sectionsJson);
        if (entries) {
          const bullets = humanizeSectionEntries(entries);
          if (bullets) {
            return bullets;
          }
        }
        return full;
      }

      if (typeof obj['title'] === 'string' || !Array.isArray(obj['sections'])) {
        return full;
      }
      const bullets = humanizeSectionEntries(obj['sections'] as unknown[]);
      return bullets ?? full;
    } catch {
      return full;
    }
  });
}

/** sections_json peut arriver en tableau OU en chaîne contenant un tableau JSON. */
function coerceSectionsArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function humanizeSectionEntries(sections: unknown[]): string | null {
  const lines: string[] = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') {
      continue;
    }
    const sec = s as Record<string, unknown>;
    const title = pickString(sec, ['title', 'label', 'name']);
    if (!title) {
      continue;
    }
    const data = sec['data'] && typeof sec['data'] === 'object' && !Array.isArray(sec['data'])
      ? (sec['data'] as Record<string, unknown>)
      : null;
    const value = data ? pickNumber(data, ['value', 'amount', 'total']) : null;
    const unit = data ? pickString(data, ['label', 'unit', 'currency']) : null;
    if (value !== null) {
      const formatted = unit?.toUpperCase() === 'TND'
        ? formatTnd(value)
        : `${formatQuantity(value)}${unit ? ` ${unit}` : ''}`;
      lines.push(`- **${title}** : ${formatted}`);
    } else {
      lines.push(`- ${title}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Adds CSS classes for severity keywords in screen analysis responses.
 */
export function applySeverityHighlightClasses(content: string): string {
  return content
    .replace(/\*\*Critique\*\*/g, '<span class="severity-critical">Critique</span>')
    .replace(/\*\*Attention\*\*/g, '<span class="severity-warning">Attention</span>')
    .replace(/\*\*OK\*\*/g, '<span class="severity-ok">OK</span>');
}

/**
 * Enhances short responses by humanizing embedded business JSON before display stripping.
 */
export function enhanceAssistantContentForDisplay(
  content: string,
  minMeaningfulChars: number = MIN_MEANINGFUL_ASSISTANT_CHARS
): string {
  if (!content?.trim()) {
    return '';
  }
  const visibleLen = measureVisibleProseLength(content);
  if (visibleLen >= minMeaningfulChars) {
    return content;
  }
  const humanized = humanizeBusinessJsonFences(content);
  if (!humanized?.trim()) {
    return content;
  }
  const prose = stripNonDashboardJsonFences(stripFtMetaFences(content)).trim();
  if (!prose) {
    return humanized;
  }
  if (visibleLen < minMeaningfulChars) {
    return `${prose}\n\n${humanized}`;
  }
  return content;
}

/**
 * Full assistant markdown pipeline for display and copy (non-dashboard tool dumps stripped, then dashboard fence stripped).
 */
function hasAnyDashboardConfig(content: string): boolean {
  for (const match of content.matchAll(DASHBOARD_JSON_FENCE)) {
    const inner = match[1]?.trim();
    if (!inner) {
      continue;
    }
    try {
      const parsed = JSON.parse(inner) as unknown;
      if (isDashboardConfig(parsed)) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function isLikelyIncompletePreamble(prose: string): boolean {
  const stripped = prose
    .replace(FT_META_FENCE, '')
    .replace(DASHBOARD_JSON_FENCE, '')
    .replace(GENERIC_CODE_FENCE, '')
    .trim()
    .toLowerCase();
  if (!stripped) {
    return true;
  }
  const preambles = new Set(['pour', 'je', 'ok', 'bon', 'alors', 'bien']);
  if (preambles.has(stripped)) {
    return true;
  }
  return stripped.length <= 3;
}

export function buildAssistantMarkdownForDisplay(
  content: string,
  options?: { smartJsonFallback?: boolean }
): string {
  if (!content?.trim()) {
    return '';
  }
  const useSmart = options?.smartJsonFallback !== false;
  // Assainissement de prose : identifiants d'outils → libellés, CJK retiré (anciens messages),
  // puis fences {"sections":…} sans title → puces lisibles.
  content = replaceSectionsOnlyFences(
    stripDisallowedScriptsForDisplay(sanitizeInternalToolNamesForDisplay(content))
  );
  let c = stripNonDashboardJsonFences(content);
  if (useSmart && measureVisibleProseLength(c) <= 15) {
    const humanized = humanizeBusinessJsonFences(content);
    if (humanized?.trim()) {
      const prose = c.trim();
      if (!prose || isLikelyIncompletePreamble(prose)) {
        c = prose ? `${prose}\n\n${humanized}` : humanized;
      }
    }
  }
  c = stripFtMetaFences(c);
  c = extractDashboardConfig(c) ? stripDashboardJsonFence(c) : c;
  return applySeverityHighlightClasses(c);
}

/**
 * Whether the display pipeline produced a usable answer from the raw content.
 */
export function hasAdequateDisplayContent(
  rawContent: string,
  renderedMarkdown: string,
  minChars: number = MIN_MEANINGFUL_ASSISTANT_CHARS
): boolean {
  return renderedMarkdown.trim().length >= minChars
    || measureVisibleProseLength(rawContent) < minChars;
}

export interface AssistantDisplayState {
  renderedMarkdown: string;
  displayFallbackText: string;
}

/**
 * Resolves markdown vs fallback text for a completed assistant message (mirrors chat-message logic).
 */
export function resolveAssistantDisplayState(
  raw: string,
  options?: {
    smartJsonFallback?: boolean;
    minChars?: number;
    hasParsedDashboard?: boolean;
  }
): AssistantDisplayState {
  const minChars = options?.minChars ?? MIN_MEANINGFUL_ASSISTANT_CHARS;
  const smartFallbackEnabled = options?.smartJsonFallback !== false;
  const enhancedRaw = smartFallbackEnabled
    ? enhanceAssistantContentForDisplay(raw, minChars)
    : raw;
  const renderedMarkdown = buildAssistantMarkdownForDisplay(enhancedRaw, {
    smartJsonFallback: smartFallbackEnabled
  });

  const renderedLen = renderedMarkdown.trim().length;
  const rawVisibleLen = measureVisibleProseLength(raw);

  if (renderedLen >= minChars) {
    return { renderedMarkdown, displayFallbackText: '' };
  }

  if (rawVisibleLen >= minChars && renderedLen < minChars) {
    return { renderedMarkdown: '', displayFallbackText: raw.trim() };
  }

  if (renderedLen > 0) {
    if (options?.hasParsedDashboard && renderedLen < minChars) {
      // Le tableau de bord se rend AU-DESSUS du texte dans chat-message : « ci-dessus ».
      const hint = renderedMarkdown.trim()
        ? $localize`:@@ai-assistant.assistant-message-display.ts.trim.analyse.complementaire.dans.le.tabl.29930d10:${renderedMarkdown.trim()}:trim:\n\n_Analyse complémentaire dans le tableau de bord ci-dessus._`
        : $localize`:@@ai-assistant.assistant-message-display.ts.analyse.disponible.dans.le.tableau.de.bo.7e908280:Analyse disponible dans le tableau de bord ci-dessus.`;
      return { renderedMarkdown: hint, displayFallbackText: '' };
    }
    return { renderedMarkdown, displayFallbackText: '' };
  }

  if (options?.hasParsedDashboard) {
    return {
      renderedMarkdown: '',
      displayFallbackText: 'Analyse disponible dans le tableau de bord ci-dessus.'
    };
  }

  // Dernier recours : si le pipeline d'affichage a tout retiré mais que le modèle a produit
  // quelque chose, on montre le brut plutôt qu'un corps vide. Ne se déclenche que dans les cas
  // aujourd'hui déjà blancs → strictement meilleur, aucun cas nominal modifié.
  const rawTrim = raw.trim();
  if (rawTrim) {
    return { renderedMarkdown: '', displayFallbackText: rawTrim };
  }

  return { renderedMarkdown: '', displayFallbackText: '' };
}
