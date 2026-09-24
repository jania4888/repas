import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { ContactRequestFieldName, ContactSubmitError, PublicApiEnvelope } from './contact-request.models';

export const RATE_LIMIT_FALLBACK_SECONDS = 60;

const FIELD_NAMES: readonly ContactRequestFieldName[] = [
  'subject',
  'fullName',
  'organization',
  'email',
  'phone',
  'size',
  'message',
  'consent',
  'locale',
  'honeypot',
  'elapsedMs',
  'turnstileToken'
];

/** `FullName` / `fullName` / `Command.FullName` → `fullName` ; inconnu → `null`. */
export function normalizeFieldName(raw: string): ContactRequestFieldName | null {
  const last = raw.split('.').pop() ?? raw;
  const camel = last.charAt(0).toLowerCase() + last.slice(1);
  return (FIELD_NAMES as readonly string[]).includes(camel) ? (camel as ContactRequestFieldName) : null;
}

/** Lit `Retry-After` (secondes entières ou date HTTP) ; `RATE_LIMIT_FALLBACK_SECONDS` sinon. */
export function parseRetryAfter(headerValue: string | null | undefined, now: number = Date.now()): number {
  if (!headerValue) {
    return RATE_LIMIT_FALLBACK_SECONDS;
  }
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : RATE_LIMIT_FALLBACK_SECONDS;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const seconds = Math.ceil((date - now) / 1000);
    return seconds > 0 ? seconds : RATE_LIMIT_FALLBACK_SECONDS;
  }
  return RATE_LIMIT_FALLBACK_SECONDS;
}

function firstMessage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const m = firstMessage(item);
      if (m) {
        return m;
      }
    }
    return null;
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (value && typeof value === 'object' && 'message' in value) {
    const m = (value as { message?: unknown }).message;
    return typeof m === 'string' && m.trim() ? m : null;
  }
  return null;
}

/**
 * Fonction pure : convertit l'erreur d'un `submit()` en `ContactSubmitError` exploitable par le formulaire.
 * - 400 → `validation` (fieldErrors camelCase, message global éventuel) ;
 * - 429 → `rateLimited` (`Retry-After`, repli 60 s) ;
 * - 503 → `disabled` ;
 * - status 0 / `TimeoutError` → `network` ;
 * - autre → `unknown`.
 */
export function mapContactSubmitError(err: unknown): ContactSubmitError {
  if (err instanceof TimeoutError) {
    return { kind: 'network' };
  }
  if (!(err instanceof HttpErrorResponse)) {
    return { kind: 'unknown', status: 0 };
  }
  switch (err.status) {
    case 0:
      return { kind: 'network' };
    case 503:
      return { kind: 'disabled' };
    case 429:
      return { kind: 'rateLimited', retryAfterSeconds: parseRetryAfter(err.headers?.get('Retry-After')) };
    case 400:
    case 422:
      return mapValidation(err.error);
    default:
      return { kind: 'unknown', status: err.status };
  }
}

function mapValidation(body: unknown): ContactSubmitError {
  const env = (body && typeof body === 'object' ? body : {}) as PublicApiEnvelope<unknown> & {
    errors?: unknown;
  };
  const fieldErrors: Partial<Record<ContactRequestFieldName, string>> = {};

  // Forme 1 : ValidationErrorResponse { fieldErrors: { email: [{ message }] } }
  // Forme 2 : ASP.NET ProblemDetails { errors: { Email: ["msg"] } }
  const sources: unknown[] = [env.fieldErrors, !Array.isArray(env.errors) ? env.errors : undefined];
  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    for (const [rawKey, value] of Object.entries(source as Record<string, unknown>)) {
      const key = normalizeFieldName(rawKey);
      const message = firstMessage(value);
      if (key && message && !fieldErrors[key]) {
        fieldErrors[key] = message;
      }
    }
  }

  const globalCandidates: unknown[] = [env.globalErrors, Array.isArray(env.errors) ? env.errors : undefined, env.message, env.error];
  let message: string | undefined;
  for (const c of globalCandidates) {
    const m = firstMessage(c);
    if (m) {
      message = m;
      break;
    }
  }
  return { kind: 'validation', fieldErrors, ...(message ? { message } : {}) };
}
