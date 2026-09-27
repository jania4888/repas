/**
 * Contrat JSON des statuts vitrine côté tenant / plateforme.
 * L’API InstaFact sérialise `StorefrontStatus` en chaînes camelCase (`draft`, `pendingReview`, …)
 * via `JsonStringEnumConverter(JsonNamingPolicy.CamelCase)` (`Program.cs`).
 * Le parseur accepte aussi le PascalCase historique (`Draft`, …) pour compatibilité avec d’anciens déploiements.
 */
export type StorefrontWorkflowStatus = 'draft' | 'pendingReview' | 'published' | 'suspended';

export const STOREFRONT_WORKFLOW_STATUS_VALUES: readonly StorefrontWorkflowStatus[] = [
  'draft',
  'pendingReview',
  'published',
  'suspended'
];

const STRING_TO_STATUS: Record<string, StorefrontWorkflowStatus> = {
  draft: 'draft',
  pendingReview: 'pendingReview',
  published: 'published',
  suspended: 'suspended'
};

const INT_TO_STATUS: Record<number, StorefrontWorkflowStatus> = {
  0: 'draft',
  1: 'pendingReview',
  2: 'published',
  3: 'suspended'
};

export type ParseStorefrontWorkflowStatusResult =
  | { ok: true; value: StorefrontWorkflowStatus }
  | { ok: false };

/**
 * Interprète la valeur `status` renvoyée par l’API.
 * Tolère : entiers 0–3 ; chaînes camelCase (`draft`, `pendingReview`, …) ; chaînes PascalCase
 * (`Draft`, `PendingReview`, …) telles que produites par `JsonStringEnumConverter` sans naming policy
 * sur les déploiements existants.
 */
export function parseStorefrontWorkflowStatus(raw: unknown): ParseStorefrontWorkflowStatusResult {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false };
    }
    const direct = STRING_TO_STATUS[trimmed];
    if (direct) {
      return { ok: true, value: direct };
    }
    const fromPascal = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
    const v = STRING_TO_STATUS[fromPascal];
    return v ? { ok: true, value: v } : { ok: false };
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3) {
    const v = INT_TO_STATUS[raw];
    return v ? { ok: true, value: v } : { ok: false };
  }
  return { ok: false };
}

export function workflowStatusLabel(value: StorefrontWorkflowStatus): string {
  switch (value) {
    case 'draft':
      return 'Brouillon';
    case 'pendingReview':
      return $localize`:@@settings.storefront-workflow-status.ts.en.attente.de.validation.a553ea16:En attente de validation`;
    case 'published':
      return $localize`:@@settings.storefront-workflow-status.ts.publiee.ebef6edc:Publiée`;
    case 'suspended':
      return 'Suspendue';
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

/** Libellé court pour tags table (back-office). */
export function workflowStatusTagLabel(value: StorefrontWorkflowStatus): string {
  return value === 'pendingReview' ? 'En attente' : workflowStatusLabel(value);
}

export function isDraft(s: StorefrontWorkflowStatus): boolean {
  return s === 'draft';
}

export function isPendingReview(s: StorefrontWorkflowStatus): boolean {
  return s === 'pendingReview';
}

export function isPublished(s: StorefrontWorkflowStatus): boolean {
  return s === 'published';
}

export function isSuspended(s: StorefrontWorkflowStatus): boolean {
  return s === 'suspended';
}
