/**
 * Mathématiques pures d'exercice comptable — miroir frontend du backend
 * `FiscalYearMath` / `IFiscalYearResolver` (plan « Exercices décalés », décision D2).
 *
 * Ces fonctions sont déterministes et ne dépendent que de leurs paramètres : aucune lecture
 * de configuration. Le mois de début d'exercice (`fiscalYearStartMonth`) est fourni par l'appelant
 * (récupéré depuis `FixedAssetSettings` via `FixedAssetsService.getSettings()`) ; 1 = exercice civil
 * (comportement historique strictement préservé).
 *
 * La logique est volontairement identique au canonique backend afin que les libellés affichés
 * côté client (« 2026/2027 ») collent à ceux produits par le serveur. Toute divergence doit être
 * considérée comme un bug et corrigée des deux côtés.
 */

/** Mois de début d'exercice invalide (hors 1..12). */
export class InvalidFiscalYearStartMonth extends RangeError {
  constructor(startMonth: number) {
    super($localize`:@@accounting.fiscal-year.ts.le.mois.de.debut.d.exercice.doit.etre.co.468178e3:Le mois de début d'exercice doit être compris entre 1 et 12 (reçu : ${startMonth}:startMonth:).`);
    super.name = 'InvalidFiscalYearStartMonth';
  }
}

function assertStartMonth(fiscalYearStartMonth: number): void {
  if (!Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    throw new InvalidFiscalYearStartMonth(fiscalYearStartMonth);
  }
}

/**
 * Clé logique d'exercice (int = année de début d'exercice) contenant la date donnée.
 * Mois ≥ startMonth → année de la date ; sinon → année précédente. Avec startMonth = 1,
 * retourne toujours `date.getFullYear()` (exercice civil = année civile).
 */
export function fiscalYearKey(date: Date, fiscalYearStartMonth: number): number {
  assertStartMonth(fiscalYearStartMonth);
  return date.getMonth() + 1 >= fiscalYearStartMonth ? date.getFullYear() : date.getFullYear() - 1;
}

/**
 * Libellé d'affichage de l'exercice. Exercice civil (mois 1) → « N » (ex. « 2026 »).
 * Exercice décalé : format `"N/N+1"` → « 2026/2027 » ; format `"N"` → « 2026 » (décision D2).
 * Toute autre valeur de format est traitée comme « N/N+1 ».
 */
export function fiscalYearLabel(
  fiscalYearKey: number,
  fiscalYearStartMonth: number,
  labelFormat: string
): string {
  assertStartMonth(fiscalYearStartMonth);
  if (fiscalYearStartMonth === 1) return String(fiscalYearKey);
  if (labelFormat === 'N') return String(fiscalYearKey);
  return `${fiscalYearKey}/${fiscalYearKey + 1}`;
}

/** Date de début d'exercice (premier jour du mois de début), pour la clé donnée. */
export function fiscalYearStartDateTime(fiscalYearKey: number, fiscalYearStartMonth: number): Date {
  assertStartMonth(fiscalYearStartMonth);
  return new Date(fiscalYearKey, fiscalYearStartMonth - 1, 1);
}

/**
 * Date de fin d'exercice = dernier jour du mois précédant le mois de début de l'exercice
 * suivant (gère les années bissextiles : 28/29 février). Pour un exercice civil (mois 1),
 * retourne le 31/12 de l'année de la clé.
 */
export function fiscalYearEndDateTime(fiscalYearKey: number, fiscalYearStartMonth: number): Date {
  assertStartMonth(fiscalYearStartMonth);
  // day 0 du mois (startMonth-1 en base 0) de l'année suivante = dernier jour du mois précédent.
  return new Date(fiscalYearKey + 1, fiscalYearStartMonth - 1, 0);
}

/** Option de sélecteur d'exercice : clé logique + libellé affiché. */
export interface FiscalYearOption {
  key: number;
  label: string;
}

/**
 * Construit la liste des exercices proposés au sélecteur (run de dotations, filtres), centrée sur
 * l'exercice courant et couvrant un fenêtre passée/future. La clé est l'année de début (entrée
 * acceptée par le backend), le libellé respecte le format paramétré (« N » ou « N/N+1 »).
 *
 * @param currentKey   clé d'exercice courante (ex. `fiscalYearKey(new Date(), startMonth)`).
 * @param startMonth   mois de début d'exercice (1..12).
 * @param labelFormat  format de libellé (`"N/N+1"` ou `"N"`).
 * @param yearsBefore  nombre d'exercices précédents inclus (défaut 4).
 * @param yearsAfter   nombre d'exercices suivants inclus (défaut 1).
 */
export function buildFiscalYearOptions(
  currentKey: number,
  startMonth: number,
  labelFormat: string,
  yearsBefore = 4,
  yearsAfter = 1
): FiscalYearOption[] {
  assertStartMonth(startMonth);
  const options: FiscalYearOption[] = [];
  for (let offset = -yearsBefore; offset <= yearsAfter; offset++) {
    const key = currentKey + offset;
    options.push({ key, label: fiscalYearLabel(key, startMonth, labelFormat) });
  }
  return options;
}
