import { API_ERROR_CODE, apiErrorCode } from '@core/utils/api-error-code';

/**
 * Limite du plan d'abonnement atteinte (création de table, champ, vue, workflow…).
 * Le code `Validation.Plan` fait foi ; le texte « Limite du plan » ne sert que de repli pour une
 * réponse sans code (le message est traduit en interface arabe).
 */
export function isStudioPlanLimitError(err: unknown, message: string): boolean {
  const code = apiErrorCode(err);
  return code ? code === API_ERROR_CODE.studioPlanLimit : message.startsWith('Limite du plan');
}
