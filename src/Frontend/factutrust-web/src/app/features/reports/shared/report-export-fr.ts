/**
 * Libellés des exports CSV/Excel de rapports : les documents exportés restent en français quelle que
 * soit la langue de l'interface (décision du chantier i18n). Les graphiques et tableaux affichés
 * utilisent, eux, les mois traduits des services de rapports.
 */
export const REPORT_EXPORT_MONTHS_SHORT_FR: readonly string[] = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
];

/** Index 1 = janvier (index 0 vide), comme les objectifs CRM. */
export const REPORT_EXPORT_MONTHS_FR: readonly string[] = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];
