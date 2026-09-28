/**
 * Validation côté client (T10 / bug C1) des comptes comptables d'une immobilisation.
 *
 * Reproduit à l'identique les règles serveur `FixedAssetAccountRules` (T8 / B5) pour garantir la
 * parité client/serveur : format, préfixes NCT et cohérence corporel/incorporel entre le compte
 * d'actif, le compte d'amortissement cumulé et le compte de dotation. Mêmes messages et codes
 * d'erreur stables que le serveur (champ + message).
 */

const ACCOUNT_FORMAT_REGEX = /^\d{2,20}$/;

export type FixedAssetAccountField = 'assetAccount' | 'depreciationAccount' | 'expenseAccount';

export interface FixedAssetAccountValidationResult {
  valid: boolean;
  field: FixedAssetAccountField | null;
  message: string;
}

/** Chiffres uniquement, 2 à 20 caractères — invariant minimal partagé avec le domaine serveur. */
export function isValidAccountFormat(account: string | null | undefined): boolean {
  return !!account && ACCOUNT_FORMAT_REGEX.test(account);
}

/**
 * Compte d'actif valide : classe 2 en 21x/22x (271 — frais préliminaires — toléré),
 * jamais 28x (amortissements) ni 29x (provisions).
 */
export function isValidAssetAccount(account: string | null | undefined): boolean {
  if (!isValidAccountFormat(account)) {
    return false;
  }
  const a = account as string;
  if (a.startsWith('28') || a.startsWith('29')) {
    return false;
  }
  return a.startsWith('21') || a.startsWith('22') || a.startsWith('271');
}

/** Compte d'amortissement cumulé valide : préfixe 281x ou 282x. */
export function isValidDepreciationAccount(account: string | null | undefined): boolean {
  return isValidAccountFormat(account) && (account!.startsWith('281') || account!.startsWith('282'));
}

/**
 * Compte de dotation valide : 68111/68112 exacts, ou préfixe 6811 toléré
 * (sous-comptes de dotation plus fins).
 */
export function isValidExpenseAccount(account: string | null | undefined): boolean {
  return isValidAccountFormat(account) && account!.startsWith('6811');
}

/**
 * Cohérence corporel/incorporel : un actif 21x doit être amorti en 281x avec une dotation 68111 ;
 * un actif 22x doit être amorti en 282x avec une dotation 68112. Le compte 271 (frais préliminaires,
 * classe 27) n'est ni corporel ni incorporel : aucune règle de cohérence ne s'applique à ce préfixe.
 */
export function isCoherentTriplet(
  assetAccount: string,
  depreciationAccount: string,
  expenseAccount: string
): boolean {
  if (assetAccount.startsWith('21')) {
    return depreciationAccount.startsWith('281') && expenseAccount.startsWith('68111');
  }
  if (assetAccount.startsWith('22')) {
    return depreciationAccount.startsWith('282') && expenseAccount.startsWith('68112');
  }
  return true;
}

/**
 * Valide le triplet complet (format + préfixes + cohérence) et renvoie la première violation
 * rencontrée, avec un code d'erreur stable par champ — miroir de `FixedAssetAccountRules.Validate`.
 */
export function validateAccountTriplet(
  assetAccount: string | null | undefined,
  depreciationAccount: string | null | undefined,
  expenseAccount: string | null | undefined
): FixedAssetAccountValidationResult {
  if (!isValidAssetAccount(assetAccount)) {
    return {
      valid: false,
      field: 'assetAccount',
      message:
        $localize`:@@accounting.fixed-asset-account-rules.ts.compte.d.actif.invalide.chiffres.uniquem.42f02442:Compte d'actif invalide : chiffres uniquement, préfixe attendu 21x ou 22x (271 toléré), jamais 28x ni 29x.`
    };
  }

  if (!isValidDepreciationAccount(depreciationAccount)) {
    return {
      valid: false,
      field: 'depreciationAccount',
      message:
        $localize`:@@accounting.fixed-asset-account-rules.ts.compte.d.amortissement.invalide.chiffres.da667d4b:Compte d'amortissement invalide : chiffres uniquement, préfixe attendu 281x ou 282x.`
    };
  }

  if (!isValidExpenseAccount(expenseAccount)) {
    return {
      valid: false,
      field: 'expenseAccount',
      message:
        $localize`:@@accounting.fixed-asset-account-rules.ts.compte.de.dotation.invalide.chiffres.uni.d91de68c:Compte de dotation invalide : chiffres uniquement, préfixe attendu 68111/68112 (6811 toléré).`
    };
  }

  if (!isCoherentTriplet(assetAccount as string, depreciationAccount as string, expenseAccount as string)) {
    return {
      valid: false,
      field: 'assetAccount',
      message:
        $localize`:@@accounting.fixed-asset-account-rules.ts.incoherence.comptable.un.actif.21x.doit.1e6937d9:Incohérence comptable : un actif 21x doit être amorti en 281x avec une dotation 68111 ; un actif 22x doit être amorti en 282x avec une dotation 68112.`
    };
  }

  return { valid: true, field: null, message: '' };
}

/** Vrai si les trois comptes forment un triplet valide (format + préfixes + cohérence). */
export function isValidAccountTriplet(
  assetAccount: string | null | undefined,
  depreciationAccount: string | null | undefined,
  expenseAccount: string | null | undefined
): boolean {
  return validateAccountTriplet(assetAccount, depreciationAccount, expenseAccount).valid;
}
