/**
 * Valeurs d'usine et libellés partagés pour le paramétrage d'exercice décalé
 * (plan « Exercices décalés », P4 frontend). Centralisés pour être réutilisés par l'écran de
 * paramétrage et comme repli civil (mois = 1) des composants de run / tableau d'amortissement
 * quand l'API de paramètres n'est pas joignable.
 */

/** Libellés des mois en français (index 0 = janvier), alignés sur l'UI comptable tunisienne. */
export const MONTH_LABELS_FR: readonly string[] = [
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.janvier.7a32ae0f:Janvier`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.fevrier.63fc1803:Février`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.mars.1778011d:Mars`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.avril.4efeee46:Avril`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.mai.afe526a6:Mai`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.juin.8b1e84b6:Juin`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.juillet.e8e0920c:Juillet`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.aout.460b6696:Août`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.septembre.08d23f31:Septembre`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.octobre.0ed28485:Octobre`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.novembre.632580af:Novembre`,
  $localize`:@@accounting.fixed-asset-settings-defaults.ts.decembre.03bcd9b0:Décembre`
];

/** Formats de libellé d'exercice autorisés (décision D2). */
export const FISCAL_YEAR_LABEL_FORMATS = ['N/N+1', 'N'] as const;
export type FiscalYearLabelFormat = (typeof FISCAL_YEAR_LABEL_FORMATS)[number];

/** Forme éditable du paramétrage (consommée par les formulaires UI). */
export interface FixedAssetSettingsForm {
  fiscalYearStartMonth: number;
  fiscalYearLabelFormat: string;
}

/** Valeurs d'usine : exercice civil (janvier) au format N/N+1 — comportement historique préservé. */
export function defaultFiscalYearSettings(): FixedAssetSettingsForm {
  return { fiscalYearStartMonth: 1, fiscalYearLabelFormat: 'N/N+1' };
}

/**
 * Normalise un payload brut (API ou JSON) en `FixedAssetSettingsForm` sûr : borne le mois dans
 * [1, 12] (repli janvier si invalide) et valide le format (repli N/N+1 si invalide).
 */
export function normalizeFiscalYearSettings(raw: {
  fiscalYearStartMonth?: number;
  fiscalYearLabelFormat?: string;
} | null | undefined): FixedAssetSettingsForm {
  const startMonth = raw?.fiscalYearStartMonth;
  const fmt = raw?.fiscalYearLabelFormat;
  return {
    fiscalYearStartMonth:
      typeof startMonth === 'number' && Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12
        ? startMonth
        : 1,
    fiscalYearLabelFormat: fmt === 'N' || fmt === 'N/N+1' ? fmt : 'N/N+1'
  };
}
