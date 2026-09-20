/**
 * Helpers HTTP purs des workflows Studio (4.4a2) — AUCUNE dépendance Angular/PrimeNG
 * (utilisable partout, y compris hors injection).
 */

/**
 * Enveloppe réelle des contrôleurs Studio : `{ success, data, message, error }`
 * (ApiResponse.cs l.9–32, `error` SINGULIER) — D-44-02. `err` est typé structurellement
 * (équivalent à `HttpErrorResponse`, dont `error` vaut `any`) pour garder le fichier pur.
 */
export function workflowErrorMessage(err: unknown): string {
  const body = (err as { error?: unknown } | null | undefined)?.error;
  if (!body || typeof body !== 'object') return '';
  const b = body as { error?: unknown; message?: unknown };
  return typeof b.error === 'string' && b.error ? b.error : typeof b.message === 'string' ? b.message : '';
}

/** Borne `max` côté client (sous-ensemble strict des bornes serveur 1..200). */
export function clampMax(max: number, upper = 100): number {
  return Math.min(Math.max(Math.trunc(max) || 1, 1), upper);
}
