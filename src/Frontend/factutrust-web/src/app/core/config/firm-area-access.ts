import { FIRM_DELEGATED_ONLY_SEGMENTS } from '@core/guards/firm-native-redirect.guard';

/**
 * Invariant « zone <-> mode » pour les utilisateurs cabinet.
 *
 * Un cabinet navigue dans DEUX zones exclusives : l'espace cabinet (`/firm/**`) en mode natif, et
 * le dossier client ouvert (comptabilité, fiscal, paie…) en mode délégué. Le jeton est la seule
 * source de vérité du mode ; l'URL peut se désynchroniser de lui (rafraîchissement silencieux,
 * navigation annulée, saisie manuelle). Ce module centralise la règle qui tranche, pour que le
 * garde de route et le service de cohérence appliquent exactement la même.
 *
 * Décision produit : en mode délégué on NE SORT PAS du dossier en atteignant une URL cabinet — on
 * revient dans le dossier. La sortie reste explicite (« Retour au cabinet »).
 */

/**
 * Écran d'accueil d'un dossier client ouvert en mode délégué : le tableau de bord comptable du
 * dossier (KPI, graphiques, comptes principaux, écritures, échéances, documents). Le Plan
 * comptable reste accessible via le hub « Comptabilité ».
 */
export const FIRM_DELEGATED_HOME_ROUTE = '/accounting/dashboard';

/** Accueil de l'espace cabinet en mode natif. */
export const FIRM_NATIVE_HOME_ROUTE = '/firm/dashboard';

/**
 * Segments autorisés au seul mode délégué, en plus de {@link FIRM_DELEGATED_ONLY_SEGMENTS} :
 * l'assistant IA est redirigé vers `/firm/dashboard` pour un cabinet natif
 * (voir `firmNativeRedirectGuard`).
 */
const DELEGATED_ONLY_EXTRA_SEGMENTS = new Set<string>(['ai-assistant']);

/** Retire la requête, l'ancre et le `/` final. */
export function stripRoutePath(url: string): string {
  let path = url.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/** `/firm` ou `/firm/...` : toute page de l'espace cabinet. */
export function isFirmAreaRoute(path: string): boolean {
  return path === '/firm' || path.startsWith('/firm/');
}

/**
 * Route de bascule vers un dossier client : seule page `/firm/**` légitime en mode délégué,
 * puisqu'elle sert précisément à changer de dossier.
 */
export function isFirmOpenDossierRoute(path: string): boolean {
  return /^\/firm\/open\/[^/]+$/.test(path);
}

export interface FirmAreaMode {
  isAccountingFirm: boolean;
  isDelegated: boolean;
}

function firstSegment(path: string): string | undefined {
  return path.split('/').filter(Boolean)[0];
}

/**
 * Route de repli quand l'URL n'appartient pas au périmètre du mode courant, sinon `null`.
 *
 * Volontairement inerte pour toute population non-cabinet (sociétés, portail client) : la règle ne
 * doit jamais rediriger un utilisateur qui n'a pas de notion de dossier délégué.
 */
export function resolveFirmAreaRedirect(url: string, mode: FirmAreaMode): string | null {
  if (!mode.isAccountingFirm) {
    return null;
  }

  const path = stripRoutePath(url);

  if (mode.isDelegated) {
    return isFirmAreaRoute(path) && !isFirmOpenDossierRoute(path)
      ? FIRM_DELEGATED_HOME_ROUTE
      : null;
  }

  const first = firstSegment(path);
  if (first && (FIRM_DELEGATED_ONLY_SEGMENTS.has(first) || DELEGATED_ONLY_EXTRA_SEGMENTS.has(first))) {
    return FIRM_NATIVE_HOME_ROUTE;
  }

  return null;
}
