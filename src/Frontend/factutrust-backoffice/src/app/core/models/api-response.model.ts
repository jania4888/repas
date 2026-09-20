/**
 * Enveloppe de réponse de l'API FactuTrust.
 *
 * Deux enveloppes coexistent côté serveur et ce modèle doit couvrir les deux :
 *  - `FactuTrust.Application.DTOs.ApiResponse<T>` → `message`, `code`, `errors[]`
 *  - `FactuTrust.API.Controllers.ApiResponse<T>` → `message`, `error` (singulier), qui masque
 *    volontairement la précédente pour tous les contrôleurs du namespace `FactuTrust.API.Controllers`
 *    (comportement documenté et verrouillé par `ApiResponseConventionTests`).
 *
 * Sur un échec, la plupart des contrôleurs ne renseignent que `error` : utiliser
 * `extractApiError()` (`@core/http/api-error`) plutôt que de lire ces champs à la main.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
  /** Renseigné par l'enveloppe `Application.DTOs`. */
  errors?: string[];
  /** Renseigné par l'enveloppe `API.Controllers` (singulier). */
  error?: string | null;
  /** Code stable pour le support, renseigné par l'enveloppe `Application.DTOs`. */
  code?: string | null;
}
