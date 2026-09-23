import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import {
  RATE_LIMIT_FALLBACK_SECONDS,
  mapContactSubmitError,
  normalizeFieldName,
  parseRetryAfter
} from './contact-submit-error.mapper';

function httpError(status: number, error: unknown = null, headers?: Record<string, string>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, headers: new HttpHeaders(headers ?? {}), url: '/api/public/contact-requests' });
}

describe('mapContactSubmitError', () => {
  it('400 ValidationErrorResponse → erreurs de champ camelCase + message global', () => {
    const result = mapContactSubmitError(
      httpError(400, {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Certains champs sont invalides.',
        fieldErrors: {
          email: [{ code: 'EmailValidator', message: 'Adresse e-mail invalide.', attemptedValue: 'x', severity: 'Error' }],
          FullName: [{ message: 'Nom trop court.' }],
          inconnu: [{ message: 'ignoré' }]
        },
        globalErrors: []
      })
    );
    expect(result).toEqual({
      kind: 'validation',
      fieldErrors: { email: 'Adresse e-mail invalide.', fullName: 'Nom trop court.' },
      message: 'Certains champs sont invalides.'
    });
  });

  it('400 avec globalErrors privilégie le premier message global', () => {
    const result = mapContactSubmitError(
      httpError(400, { success: false, code: 'VALIDATION_FAILED', message: 'Générique', fieldErrors: {}, globalErrors: ['Vérification anti-robot échouée.'] })
    );
    expect(result).toEqual({ kind: 'validation', fieldErrors: {}, message: 'Vérification anti-robot échouée.' });
  });

  it('400 ProblemDetails ASP.NET (errors: { Email: [..] }) est aussi compris', () => {
    const result = mapContactSubmitError(httpError(400, { title: 'One or more validation errors occurred.', errors: { Email: ['Invalide'], 'Command.Phone': ['Numéro invalide'] } }));
    expect(result).toEqual({ kind: 'validation', fieldErrors: { email: 'Invalide', phone: 'Numéro invalide' } });
  });

  it('400 ApiResponse simple { success:false, error } → validation avec message global', () => {
    const result = mapContactSubmitError(httpError(400, { success: false, error: 'Requête invalide' }));
    expect(result).toEqual({ kind: 'validation', fieldErrors: {}, message: 'Requête invalide' });
  });

  it('429 lit Retry-After en secondes', () => {
    expect(mapContactSubmitError(httpError(429, { success: false, message: 'Trop de demandes', errors: [] }, { 'Retry-After': '120' }))).toEqual({
      kind: 'rateLimited',
      retryAfterSeconds: 120
    });
  });

  it('429 sans Retry-After → repli 60 s', () => {
    expect(mapContactSubmitError(httpError(429))).toEqual({ kind: 'rateLimited', retryAfterSeconds: RATE_LIMIT_FALLBACK_SECONDS });
  });

  it('503 → disabled', () => {
    expect(mapContactSubmitError(httpError(503))).toEqual({ kind: 'disabled' });
  });

  it('status 0 et TimeoutError → network', () => {
    expect(mapContactSubmitError(httpError(0))).toEqual({ kind: 'network' });
    expect(mapContactSubmitError(new TimeoutError())).toEqual({ kind: 'network' });
  });

  it('autre statut → unknown avec le statut ; erreur non HTTP → unknown 0', () => {
    expect(mapContactSubmitError(httpError(500))).toEqual({ kind: 'unknown', status: 500 });
    expect(mapContactSubmitError(new Error('boom'))).toEqual({ kind: 'unknown', status: 0 });
  });
});

describe('parseRetryAfter / normalizeFieldName', () => {
  it('parseRetryAfter accepte secondes, date HTTP, et retombe sur 60', () => {
    const now = Date.UTC(2026, 8, 23, 12, 0, 0);
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('0')).toBe(RATE_LIMIT_FALLBACK_SECONDS);
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90);
    expect(parseRetryAfter('n/a')).toBe(RATE_LIMIT_FALLBACK_SECONDS);
    expect(parseRetryAfter(null)).toBe(RATE_LIMIT_FALLBACK_SECONDS);
  });

  it('normalizeFieldName convertit PascalCase et chemins', () => {
    expect(normalizeFieldName('FullName')).toBe('fullName');
    expect(normalizeFieldName('email')).toBe('email');
    expect(normalizeFieldName('Command.TurnstileToken')).toBe('turnstileToken');
    expect(normalizeFieldName('Foo')).toBeNull();
  });
});
