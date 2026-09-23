/**
 * Contrat partagé frontend ↔ backend de `POST /api/public/contact-requests` (plan § 4.5, figé).
 * Toute modification doit être reflétée dans `SubmitPublicContactRequestCommandValidator` (lot C).
 */
import type { LandingLocale } from '../content/landing-copy.types';

export type { LandingLocale };

/** Codes d'objet — enum backend `PublicContactSubject { AccesEntreprise=1, DemoCabinet=2, Entreprise=3, Autre=4 }`. */
export type ContactRequestSubject = 'acces-entreprise' | 'demo-cabinet' | 'entreprise' | 'autre';
export const CONTACT_REQUEST_SUBJECTS: readonly ContactRequestSubject[] = [
  'acces-entreprise',
  'demo-cabinet',
  'entreprise',
  'autre'
] as const;

/** Liste blanche unique de `size` (référence lot B, reprise telle quelle par le validateur C). */
export type ContactRequestSize =
  | 'dossiers:1-5'
  | 'dossiers:6-20'
  | 'dossiers:21-50'
  | 'dossiers:50+'
  | 'employes:1-5'
  | 'employes:6-20'
  | 'employes:21-100'
  | 'employes:100+';
export const CONTACT_REQUEST_SIZES: readonly ContactRequestSize[] = [
  'dossiers:1-5',
  'dossiers:6-20',
  'dossiers:21-50',
  'dossiers:50+',
  'employes:1-5',
  'employes:6-20',
  'employes:21-100',
  'employes:100+'
] as const;

/** Bornes du contrat (frontend). Le backend accepte `phone` ≤ 32 après normalisation. */
export const CONTACT_REQUEST_LIMITS = {
  fullName: { min: 2, max: 120 },
  organization: { min: 2, max: 120 },
  email: { max: 254 },
  /** Saisie brute côté frontend. */
  phone: { max: 20 },
  message: { min: 10, max: 2000 },
  turnstileToken: { max: 2048 },
  /** Corps JSON maximal accepté par le contrôleur. */
  bodyBytes: 16 * 1024
} as const;

export interface CreateContactRequestDto {
  subject: ContactRequestSubject;
  /** 2–120 caractères, mono-ligne. */
  fullName: string;
  /** 2–120 caractères, mono-ligne (société ou cabinet). */
  organization: string;
  /** ≤ 254, sans espace ni caractère de contrôle. */
  email: string;
  /** Numéro NORMALISÉ (`normalizeTunisianPhone`) : `^(\+216)?[2-9]\d{7}$`. */
  phone: string;
  size?: ContactRequestSize;
  /** 10–2000 caractères, sauts de ligne autorisés. */
  message: string;
  consent: true;
  locale: LandingLocale;
  /** Champ piège : toujours vide (le frontend n'appelle pas l'API s'il est rempli). */
  honeypot: '';
  /** Entier ≥ 0 : millisecondes écoulées depuis l'affichage du formulaire. */
  elapsedMs: number;
  /** Présent seulement si `environment.turnstileSiteKey` est configurée. ≤ 2048. */
  turnstileToken?: string;
}

/** Corps `data` du 202. */
export interface ContactRequestAccepted {
  /** Ex. `CR-7F3K9Q`. */
  reference: string;
}

export interface PublicApiFieldError {
  code?: string;
  message: string;
  attemptedValue?: unknown;
  severity?: string;
}

/**
 * Enveloppe `Controllers/ApiResponse.cs` (camelCase) ET `ValidationErrorResponse` (400) :
 * le mapper accepte les deux formes.
 */
export interface PublicApiEnvelope<T> {
  success: boolean;
  data?: T | null;
  message?: string | null;
  error?: string | null;
  /** `VALIDATION_FAILED` sur un 400 de validation. */
  code?: string | null;
  /** Clés = noms JSON camelCase (`email`, `fullName`…). */
  fieldErrors?: Record<string, PublicApiFieldError[]> | null;
  globalErrors?: string[] | null;
  /** 429 (`OnRejected`) / erreurs globales legacy. */
  errors?: string[] | null;
}

export type ContactRequestFieldName = keyof CreateContactRequestDto;

export type ContactSubmitError =
  | { kind: 'validation'; fieldErrors: Partial<Record<ContactRequestFieldName, string>>; message?: string }
  | { kind: 'rateLimited'; retryAfterSeconds: number }
  | { kind: 'disabled' }
  | { kind: 'network' }
  | { kind: 'unknown'; status: number };

export function isContactRequestSubject(value: unknown): value is ContactRequestSubject {
  return typeof value === 'string' && (CONTACT_REQUEST_SUBJECTS as readonly string[]).includes(value);
}

export function isContactRequestSize(value: unknown): value is ContactRequestSize {
  return typeof value === 'string' && (CONTACT_REQUEST_SIZES as readonly string[]).includes(value);
}
