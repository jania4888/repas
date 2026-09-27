/**
 * Codes d'erreur stables renvoyés par l'API (champ `code` de l'enveloppe).
 *
 * Toute logique qui dépend de la nature d'une erreur lit le code, jamais le texte du message :
 * en interface arabe, l'API traduit les messages (`X-UI-Locale: ar`), pas les codes.
 */
export const API_ERROR_CODE = {
  tenantContextInvalid: 'TENANT_CONTEXT_INVALID',
  delegatedContextInvalid: 'DELEGATED_CONTEXT_INVALID',
  rateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  /** Statut du document incompatible avec l'action (ex. bon de livraison déjà confirmé). */
  statusNotAllowed: 'Validation.Status',
  cnssEmployerNumberMissing: 'Validation.CnssEmployerNumber',
  /** Passage CMUP → FIFO/LIFO refusé : une couche d'ouverture est nécessaire. */
  openingLayerRequired: 'Validation.CostingMethod.OpeningLayerRequired',
  /** Limite du plan d'abonnement atteinte (Studio). */
  studioPlanLimit: 'Validation.Plan'
} as const;

/** Code de l'erreur API (`error.code`), y compris quand le corps est une chaîne JSON. */
export function apiErrorCode(error: unknown): string | undefined {
  let body = (error as { error?: unknown } | null | undefined)?.error;
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}
