/** Sous-ensemble de l'API Cloudflare Turnstile utilisé par le formulaire de contact. */
export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
  appearance?: 'always' | 'execute' | 'interaction-only';
  'response-field'?: boolean;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (errorCode?: string) => void;
  'timeout-callback'?: () => void;
}

export interface TurnstileApi {
  render(el: HTMLElement | string, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
  getResponse?(widgetId?: string): string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onloadTurnstileCallback?: () => void;
  }
}

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_SCRIPT_ID = 'instafact-turnstile-script';
/** Doit correspondre à `PublicContactOptions.TurnstileExpectedAction` (backend). */
export const TURNSTILE_ACTION = 'contact';
export const TURNSTILE_LOAD_TIMEOUT_MS = 8_000;
