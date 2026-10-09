/**
 * Lecture du contexte porté par l'ACCESS TOKEN.
 *
 * Le jeton est la seule autorité sur le mode de la session (cabinet natif ou dossier délégué) :
 * une réponse `/auth/me` qui le contredit décrit une session qui n'existe pas et ne doit pas
 * écraser l'état local. Les noms de claims vivent ici, et non dans `auth.service.ts`.
 */

export interface AccessTokenContext {
  accessMode: 'native' | 'delegated';
  contextTenantId?: string;
}

interface AccessTokenPayload {
  access_mode?: unknown;
  context_tenant_id?: unknown;
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
}

/** `null` quand le jeton est absent ou illisible : on ne bloque alors aucune mise à jour. */
export function readAccessTokenContext(token: string | null | undefined): AccessTokenContext | null {
  if (!token) {
    return null;
  }
  const segment = token.split('.')[1];
  if (!segment) {
    return null;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(segment)) as AccessTokenPayload;
    const mode = payload.access_mode === 'delegated' ? 'delegated' : 'native';
    const contextTenantId =
      typeof payload.context_tenant_id === 'string' ? payload.context_tenant_id : undefined;
    return { accessMode: mode, contextTenantId };
  } catch {
    return null;
  }
}

/**
 * Faux quand la charge utile `/auth/me` contredit le jeton vivant, sur le mode ou sur le dossier.
 * Jeton illisible : on laisse passer (pas de régression hors cabinet).
 */
export function isUserPayloadCoherentWithToken(
  payload: { accessMode?: string | null; contextTenantId?: string | null } | null | undefined,
  tokenContext: AccessTokenContext | null
): boolean {
  if (!tokenContext || !payload) {
    return true;
  }

  const payloadMode = payload.accessMode === 'delegated' ? 'delegated' : 'native';
  if (payloadMode !== tokenContext.accessMode) {
    return false;
  }

  if (tokenContext.accessMode === 'delegated') {
    return (payload.contextTenantId ?? undefined) === tokenContext.contextTenantId;
  }

  return true;
}
