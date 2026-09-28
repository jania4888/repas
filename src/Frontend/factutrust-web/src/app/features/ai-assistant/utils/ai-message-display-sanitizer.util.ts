import { buildScreenAnalysisDisplayLabel } from './ai-screen-labels.util';
import { SCREEN_ANALYSIS_BACKEND_PROMPT_PREFIX } from './ai-volatile-analysis-payload.util';

const SCREEN_CONTEXT_MARKER = '[CONTEXTE ÉCRAN —';
const SCREEN_CONTEXT_END_MARKER = '[FIN CONTEXTE ÉCRAN]';
const SCREEN_ID_PATTERN = /\[CONTEXTE ÉCRAN — ([^—\]]+)/;

/** Detects a persisted user message originating from a screen analysis trigger. */
export function isPersistedScreenAnalysisUserMessage(content: string): boolean {
  if (!content?.trim()) {
    return false;
  }
  if (content.startsWith(SCREEN_ANALYSIS_BACKEND_PROMPT_PREFIX)) {
    return true;
  }
  if (content.includes(SCREEN_CONTEXT_MARKER)) {
    return true;
  }
  return content.includes(SCREEN_CONTEXT_END_MARKER);
}

/** Extracts screenId from a persisted message containing a volatile screen block. */
export function extractScreenIdFromPersistedMessage(content: string): string | null {
  const match = content.match(SCREEN_ID_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

/** Returns a friendly display label for analysis messages, or the original content. */
export function sanitizeUserMessageForDisplay(content: string): string {
  if (!isPersistedScreenAnalysisUserMessage(content)) {
    return content;
  }
  const screenId = extractScreenIdFromPersistedMessage(content);
  if (!screenId) {
    return $localize`:@@ai-assistant.sanitizer.analyse.ecran.generique:Analyse de l'écran : écran`;
  }
  return buildScreenAnalysisDisplayLabel(screenId);
}
