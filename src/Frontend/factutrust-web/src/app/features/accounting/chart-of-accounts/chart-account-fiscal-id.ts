/// <reference types="@angular/localize" />
/**
 * Matricule fiscal des comptes auxiliaires Client/Fournisseur du plan comptable.
 *
 * Fonctions pures réutilisées par le dialogue de création (`chart-of-accounts.component.ts`)
 * et le dialogue d'édition (`chart-account-edit-dialog.component.ts`). Le serveur reste
 * l'autorité finale (unicité, format) — les vérifications ici ne sont que des pré-contrôles
 * côté client pour un retour immédiat.
 */
import { canonicalizeNif, isValidNif } from '@shared/validation/validation-rules';
import { ChartOfAccountDto } from '../services/accounting.service';

/** 1 = Client, 2 = Fournisseur (cf. `ChartOfAccountDto.accountType`). */
const CLIENT_ACCOUNT_TYPE = 1;
const SUPPLIER_ACCOUNT_TYPE = 2;

/** Seuls les comptes auxiliaires Client ou Fournisseur peuvent porter un matricule fiscal. */
export function accountSupportsFiscalId(accountType: number | null | undefined, isAuxiliary: boolean | null | undefined): boolean {
  if (!isAuxiliary) return false;
  return accountType === CLIENT_ACCOUNT_TYPE || accountType === SUPPLIER_ACCOUNT_TYPE;
}

/** Forme canonique (`1234567A/B/M/000`) ou chaîne vide si la saisie est vide/illisible. */
export function normalizeFiscalIdInput(raw: string | null | undefined): string {
  return canonicalizeNif(raw);
}

/** `null` si vide ou valide, sinon message localisé expliquant le format attendu. */
export function fiscalIdFormatError(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (isValidNif(trimmed)) return null;
  return $localize`:@@accounting.chart-of-accounts.matricule.fiscal.invalide.format.attendu.7.chiffres:Matricule fiscal invalide. Format attendu : 7 chiffres, une lettre, puis code TVA / catégorie / établissement (ex. 1234567A/B/M/000).`;
}

/**
 * Compte déjà porteur du même matricule fiscal, pour le même type de compte (Client ou
 * Fournisseur — deux comptes de types différents peuvent partager un matricule fiscal).
 * Pré-contrôle client ; le serveur refait la vérification côté base.
 */
export function findFiscalIdDuplicate(
  rows: readonly ChartOfAccountDto[],
  accountType: number | null | undefined,
  fiscalId: string | null | undefined,
  excludeId?: string | null
): ChartOfAccountDto | null {
  const target = canonicalizeNif(fiscalId);
  if (!target) return null;
  return (
    rows.find(
      r =>
        r.id !== excludeId &&
        r.accountType === accountType &&
        !!r.fiscalId &&
        canonicalizeNif(r.fiscalId) === target
    ) ?? null
  );
}

/** Message localisé pour un matricule fiscal déjà utilisé par `account`. */
export function fiscalIdDuplicateMessage(account: Pick<ChartOfAccountDto, 'accountNumber' | 'label'>): string {
  return $localize`:@@accounting.chart-of-accounts.ce.matricule.fiscal.est.deja.utilise.par.le:Ce matricule fiscal est déjà utilisé par le compte ${account.accountNumber}:accountNumber: — ${account.label}:label:.`;
}

/**
 * Erreur à afficher sous le champ matricule fiscal, par priorité : erreur serveur > format >
 * doublon local. `null` si la saisie est vide (champ facultatif) ou sans problème.
 * Chaîne unique partagée par le dialogue de création et celui d'édition.
 */
export function fiscalIdFieldError(
  serverError: string | null,
  raw: string | null | undefined,
  rows: readonly ChartOfAccountDto[],
  accountType: number | null | undefined,
  excludeId?: string | null
): string | null {
  if (serverError) return serverError;
  const formatError = fiscalIdFormatError(raw);
  if (formatError) return formatError;
  const normalized = canonicalizeNif(raw);
  if (!normalized) return null;
  const duplicate = findFiscalIdDuplicate(rows, accountType, normalized, excludeId);
  return duplicate ? fiscalIdDuplicateMessage(duplicate) : null;
}

/** Codes d'erreur métier §4.2 du contrat matricule fiscal. */
const FISCAL_ID_DUPLICATE_CODE = 'ChartAccount.FiscalIdDuplicate';
const FISCAL_ID_VALIDATION_CODE = 'Validation.FiscalId';

interface ServerErrorBody {
  error?: string;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, Array<string | { message?: string }>>;
}

function extractErrorBody(err: unknown): ServerErrorBody | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as Record<string, unknown>;
  // HttpErrorResponse : le corps JSON parsé vit dans `.error`.
  if (anyErr['error'] && typeof anyErr['error'] === 'object') {
    return anyErr['error'] as ServerErrorBody;
  }
  // Corps d'ApiResponse (success: false) passé directement — `.error` y est une chaîne.
  return anyErr as ServerErrorBody;
}

/**
 * Message à afficher sous le champ matricule fiscal si `err` porte une erreur FluentValidation
 * sur `FiscalId`/`Request.FiscalId`, ou un code métier `ChartAccount.FiscalIdDuplicate` /
 * `Validation.FiscalId`. `null` si l'erreur ne concerne pas le matricule fiscal : l'appelant
 * retombe alors sur son affichage d'erreur générique habituel.
 */
export function extractFiscalIdServerError(err: unknown): string | null {
  const body = extractErrorBody(err);
  if (!body) return null;

  const fieldErrors = body.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    for (const [key, errors] of Object.entries(fieldErrors)) {
      if (key !== 'FiscalId' && !key.endsWith('.FiscalId')) continue;
      if (!Array.isArray(errors) || errors.length === 0) continue;
      const first = errors[0];
      const message = typeof first === 'string' ? first : first?.message;
      if (message) return message;
    }
  }

  if (body.code === FISCAL_ID_DUPLICATE_CODE || body.code === FISCAL_ID_VALIDATION_CODE) {
    return body.error ?? body.message ?? null;
  }

  return null;
}
