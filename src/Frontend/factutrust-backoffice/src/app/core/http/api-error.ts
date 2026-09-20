import { HttpErrorResponse } from '@angular/common/http';

/**
 * Message d'erreur exploitable extrait d'une réponse d'API.
 *
 * `reference` est l'identifiant de corrélation à communiquer au support (ex. `REG-3f2b…`),
 * quand le serveur en fournit un.
 */
export interface ApiErrorInfo {
  message: string;
  reference?: string;
  httpStatus?: number;
}

/**
 * Deux enveloppes `ApiResponse<T>` coexistent côté serveur :
 *  - `FactuTrust.Application.DTOs.ApiResponse<T>`  → `{ success, data, message, code, errors[] }`
 *  - `FactuTrust.API.Controllers.ApiResponse<T>`   → `{ success, data, message, error }` (singulier)
 * La seconde masque volontairement la première pour tous les contrôleurs du namespace
 * `FactuTrust.API.Controllers` (cf. ApiResponseConventionTests). Le middleware d'exception
 * peut par ailleurs renvoyer une forme `{ detail }`.
 *
 * Cet extracteur couvre les trois formes : c'est le seul point du backoffice qui doit
 * connaître ces différences.
 */
interface ServerErrorBody {
  message?: string | null;
  error?: string | null;
  errors?: string[] | null;
  detail?: string | null;
  code?: string | null;
}

/** Capture `(réf. REG-xxxx)` / `(réf. FIRM-xxxx)` inséré dans le message par l'API. */
const REFERENCE_PATTERN = /\(réf\.\s*([A-Z]+-[0-9a-fA-F]+)\)/;

/**
 * Forme d'une vraie référence support : `REG-3f2b…`. Le champ `code` de l'enveloppe porte en
 * réalité des codes machine (`CHANNELS_DISABLED`, `POS_SESSION_CLOSED`) qu'il ne faut jamais
 * afficher comme « référence à communiquer au support ».
 */
const REFERENCE_SHAPE = /^[A-Z]+-[0-9a-fA-F]{6,}$/;

/**
 * Un corps d'erreur en texte brut n'est exploitable que s'il s'agit d'un message court. Derrière
 * un reverse proxy, un 502/504 renvoie une page HTML entière : l'afficher telle quelle noierait
 * l'opérateur sous du balisage.
 */
function usableAsMessage(body: string | null): string | null {
  if (body === null) return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  if (/<[a-z!/]/i.test(trimmed)) return null;
  return trimmed;
}

function firstNonEmpty(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function messageForStatus(status: number): string | null {
  switch (status) {
    case 0:
      return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
    case 401:
      return 'Session expirée. Reconnectez-vous puis réessayez.';
    case 403:
      return "Vous n'avez pas la permission d'effectuer cette action.";
    case 404:
      return 'Ressource introuvable ou fonctionnalité désactivée sur cette instance.';
    case 409:
      return 'Conflit : cette ressource existe déjà.';
    case 429:
      return 'Trop de requêtes en peu de temps. Patientez une minute puis réessayez.';
    default:
      return null;
  }
}

/**
 * Convertit n'importe quelle erreur HTTP en message affichable.
 *
 * Ordre de résolution : `errors[0]` → `message` → `error` → `detail` → message générique
 * lié au statut → `fallback`. Le message métier renvoyé par le serveur prime toujours sur
 * le message générique : c'est lui qui explique à l'opérateur ce qu'il doit corriger.
 */
export function extractApiError(err: unknown, fallback: string): ApiErrorInfo {
  if (err instanceof HttpErrorResponse) {
    const body = (typeof err.error === 'object' && err.error !== null ? err.error : {}) as ServerErrorBody;
    const bodyAsString = typeof err.error === 'string' ? err.error : null;

    const message =
      firstNonEmpty(
        body.errors?.length ? body.errors.join(' ') : null,
        body.message,
        body.error,
        body.detail,
        usableAsMessage(bodyAsString)
      ) ??
      messageForStatus(err.status) ??
      fallback;

    return {
      message,
      reference:
        firstNonEmpty(
          REFERENCE_PATTERN.exec(message)?.[1],
          body.code && REFERENCE_SHAPE.test(body.code.trim()) ? body.code : null
        ) ?? undefined,
      httpStatus: err.status
    };
  }

  if (err instanceof Error && err.message.trim().length > 0) {
    return { message: err.message };
  }

  return { message: fallback };
}
