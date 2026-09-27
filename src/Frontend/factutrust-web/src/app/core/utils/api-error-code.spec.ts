import { HttpErrorResponse } from '@angular/common/http';
import { API_ERROR_CODE, apiErrorCode } from './api-error-code';

describe('apiErrorCode', () => {
  it('lit le code de l’enveloppe JSON', () => {
    const err = new HttpErrorResponse({ status: 400, error: { success: false, message: 'x', code: 'Validation.Plan' } });
    expect(apiErrorCode(err)).toBe(API_ERROR_CODE.studioPlanLimit);
  });

  it('lit le code d’un corps JSON reçu en texte', () => {
    const err = new HttpErrorResponse({ status: 429, error: '{"success":false,"code":"RATE_LIMIT_EXCEEDED"}' });
    expect(apiErrorCode(err)).toBe(API_ERROR_CODE.rateLimitExceeded);
  });

  it('renvoie undefined sans code, sur corps texte ou vide', () => {
    expect(apiErrorCode(new HttpErrorResponse({ status: 400, error: { message: 'x' } }))).toBeUndefined();
    expect(apiErrorCode(new HttpErrorResponse({ status: 400, error: 'Erreur' }))).toBeUndefined();
    expect(apiErrorCode(new HttpErrorResponse({ status: 400, error: '{pas du json' }))).toBeUndefined();
    expect(apiErrorCode(new HttpErrorResponse({ status: 0 }))).toBeUndefined();
    expect(apiErrorCode(null)).toBeUndefined();
    expect(apiErrorCode({ error: { code: 42 } })).toBeUndefined();
  });
});
