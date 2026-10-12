import { apiErrorCode } from '@core/utils/api-error-code';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { LETTERING_ERROR_CODES } from '../models/lettering.models';

/**
 * Traduction des erreurs de lettrage, partagée par `LetteringStore` et `LetteringSuggestionsStore`
 * (Phase 3). Extraction pure de l'ancienne méthode privée de `LetteringStore` : mêmes IDs i18n,
 * mêmes textes, même ordre (code métier, puis 403, puis message du serveur ou repli réseau).
 */

/**
 * Codes qui reflètent un état serveur désynchronisé de ce que l'utilisateur voit (ligne déjà
 * lettrée par quelqu'un d'autre) : l'écran recharge la liste pour redevenir cohérent sans action
 * de l'utilisateur. `LETTERING_PERIOD_LOCKED` n'en fait PAS partie (plan §4.6/§5.5) : le message
 * s'affiche, la sélection est conservée et rien n'est rechargé (les propositions, elles, sont
 * recalculées par `LetteringSuggestionsStore.refresh()`).
 */
export const LETTERING_RELOAD_ON_CODES: readonly string[] = [LETTERING_ERROR_CODES.alreadyLettered];

export function shouldReloadOnLetteringError(err: unknown): boolean {
  const code = apiErrorCode(err);
  return code !== undefined && LETTERING_RELOAD_ON_CODES.includes(code);
}

/** Message traduit d'un code stable `LETTERING_*` ; `null` si le code n'est pas connu. */
export function letteringCodeMessage(code: string | null | undefined): string | null {
  switch (code) {
    case LETTERING_ERROR_CODES.validation:
      return $localize`:@@accounting.lettering.store.erreur.validation:Requête invalide.`;
    case LETTERING_ERROR_CODES.linesNotFound:
      return $localize`:@@accounting.lettering.store.erreur.lignes.introuvables:Une ou plusieurs lignes sont introuvables. La liste a été actualisée.`;
    case LETTERING_ERROR_CODES.alreadyLettered:
      return $localize`:@@accounting.lettering.store.erreur.deja.lettree:Une ligne est déjà lettrée. La liste a été actualisée.`;
    case LETTERING_ERROR_CODES.accountMismatch:
      return $localize`:@@accounting.lettering.store.erreur.compte.incoherent:Les lignes sélectionnées ne portent pas toutes sur le même compte.`;
    case LETTERING_ERROR_CODES.currencyMismatch:
      return $localize`:@@accounting.lettering.store.erreur.devise.incoherente:Les lignes sélectionnées ne sont pas dans la même devise.`;
    case LETTERING_ERROR_CODES.unbalanced:
      return $localize`:@@accounting.lettering.store.erreur.non.equilibre:La sélection n'est pas équilibrée (débit ≠ crédit).`;
    case LETTERING_ERROR_CODES.periodLocked:
      // Texte neutre : il sert aussi à la validation d'une proposition (pas de sélection manuelle).
      return $localize`:@@accounting.lettering.store.erreur.periode.cloturee.v2:Impossible : une des lignes appartient à une période clôturée. Rien n'a été lettré.`;
    case LETTERING_ERROR_CODES.groupNotFound:
      return $localize`:@@accounting.lettering.store.erreur.groupe.introuvable:Ce groupe de lettrage n'existe pas ou plus.`;
    case LETTERING_ERROR_CODES.groupNotPartial:
      return $localize`:@@accounting.lettering.store.erreur.groupe.non.partiel:Ce groupe n'est pas (ou plus) un lettrage partiel.`;
    case LETTERING_ERROR_CODES.exchangeDifference:
      return $localize`:@@accounting.lettering.store.erreur.ecart.de.change:La sélection présente un écart de change : utilisez « Équilibrer ».`;
    case LETTERING_ERROR_CODES.bulkInProgress:
      return $localize`:@@accounting.lettering.store.erreur.lot.en.cours:Ce lot de lettrage est déjà en cours de traitement. Patientez puis actualisez.`;
    case LETTERING_ERROR_CODES.unexpected:
      return $localize`:@@accounting.lettering.store.erreur.inattendue:Erreur inattendue : vérifiez l'état de ce groupe avant de le relancer.`;
    case LETTERING_ERROR_CODES.featureDisabled:
      return $localize`:@@accounting.lettering.store.erreur.fonctionnalite.desactivee:Cette fonctionnalité n'est pas activée.`;
    default:
      return null;
  }
}

/** Centralise la traduction des codes métier `LETTERING_*` (contrat §5) en messages FR. */
export function translateLetteringError(err: unknown, networkFallback: string, errors: ErrorHandlerService): string {
  const message = letteringCodeMessage(apiErrorCode(err));
  if (message !== null) return message;
  if ((err as { status?: number } | null)?.status === 403) {
    return $localize`:@@accounting.lettering.store.erreur.droit.insuffisant:Droit insuffisant pour effectuer cette action.`;
  }
  return errors.extractErrorMessage(err, networkFallback);
}
