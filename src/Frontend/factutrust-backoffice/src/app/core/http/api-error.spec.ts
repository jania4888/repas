import { HttpErrorResponse } from '@angular/common/http';
import { extractApiError } from './api-error';

const FALLBACK = 'Échec générique.';

function httpError(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'Error', error });
}

/**
 * Cet extracteur est le seul point du backoffice qui connaît les trois formes d'enveloppe
 * d'erreur du serveur. Tout ce qu'il laisse passer s'affiche tel quel à l'opérateur.
 */
describe('extractApiError', () => {
  it('préfère le motif métier au message générique de statut', () => {
    const info = extractApiError(
      httpError(409, { success: false, error: 'Ce matricule fiscal est déjà utilisé.' }),
      FALLBACK
    );

    expect(info.message).toBe('Ce matricule fiscal est déjà utilisé.');
    expect(info.httpStatus).toBe(409);
  });

  it('lit `errors[]` de l’enveloppe Application avant `message`', () => {
    const info = extractApiError(
      httpError(400, { errors: ['Le NIF est invalide.'], message: 'Requête invalide' }),
      FALLBACK
    );

    expect(info.message).toBe('Le NIF est invalide.');
  });

  it('lit `detail` renvoyé par le middleware d’exception', () => {
    expect(extractApiError(httpError(500, { detail: 'Panne du service.' }), FALLBACK).message)
      .toBe('Panne du service.');
  });

  it('retombe sur le message de statut quand le corps est vide', () => {
    expect(extractApiError(httpError(429, null), FALLBACK).message).toContain('Trop de requêtes');
    expect(extractApiError(httpError(0, null), FALLBACK).message).toContain('injoignable');
  });

  it('retombe sur le message fourni pour un statut sans libellé dédié', () => {
    expect(extractApiError(httpError(418, null), FALLBACK).message).toBe(FALLBACK);
  });

  it('accepte un corps texte court', () => {
    expect(extractApiError(httpError(400, 'Champ obligatoire manquant.'), FALLBACK).message)
      .toBe('Champ obligatoire manquant.');
  });

  /**
   * Derrière un reverse proxy, un 502 renvoie une page HTML entière. L'afficher noierait
   * l'opérateur sous du balisage au lieu de lui dire que le serveur est en panne.
   */
  it('ignore un corps HTML de passerelle au profit du message de statut', () => {
    const html = '<html><head><title>502 Bad Gateway</title></head><body><h1>502</h1></body></html>';

    const info = extractApiError(httpError(502, html), FALLBACK);

    expect(info.message).not.toContain('<');
    expect(info.message).toBe(FALLBACK);
  });

  it('ignore un corps texte anormalement long', () => {
    const info = extractApiError(httpError(500, 'x'.repeat(400)), FALLBACK);

    expect(info.message).toBe(FALLBACK);
  });

  it('extrait la référence support insérée dans le message', () => {
    const info = extractApiError(
      httpError(500, { error: "L'inscription n'a pas pu être finalisée. (réf. REG-3f2b1a)" }),
      FALLBACK
    );

    expect(info.reference).toBe('REG-3f2b1a');
  });

  /**
   * `code` porte des codes machine (`CHANNELS_DISABLED`), pas des références de corrélation :
   * les présenter comme « référence à communiquer au support » induirait l'opérateur en erreur.
   */
  it('ne prend pas un code machine pour une référence support', () => {
    const info = extractApiError(
      httpError(404, { error: 'Fonctionnalité désactivée.', code: 'CHANNELS_DISABLED' }),
      FALLBACK
    );

    expect(info.reference).toBeUndefined();
  });

  it('accepte `code` lorsqu’il a bien la forme d’une référence', () => {
    const info = extractApiError(
      httpError(500, { error: 'Échec.', code: 'FIRM-9c4e21' }),
      FALLBACK
    );

    expect(info.reference).toBe('FIRM-9c4e21');
  });

  it('gère une erreur JavaScript hors HTTP', () => {
    expect(extractApiError(new Error('Boom'), FALLBACK).message).toBe('Boom');
    expect(extractApiError('pas une erreur', FALLBACK).message).toBe(FALLBACK);
  });
});
