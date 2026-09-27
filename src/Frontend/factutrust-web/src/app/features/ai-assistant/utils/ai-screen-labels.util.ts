const SCREEN_LABELS: Record<string, string> = {
  'accounting-ledger': 'Grand livre',
  'accounting-journal': 'Journal comptable',
  'accounting-balance-sheet': 'Bilan',
  'accounting-income-statement': 'Compte de résultat',
  'accounting-balance': 'Balance',
  'accounting-chart': 'Plan comptable',
  'accounting-sub-journals': 'Journaux auxiliaires',
  'accounting-lettering': 'Lettrage',
  'accounting-closing': 'Clôture comptable',
  'accounting-vat-declaration': 'Déclaration TVA',
  'accounting-manual-entry': 'Saisie manuelle',
  'accounting-aging': 'Balance âgée',
  'invoice-list': 'Liste des factures',
  'credit-note-list': 'Liste des avoirs',
  'cash-desk': 'Caisse',
  'stock-simple': 'Stock',
  dashboard: 'Tableau de bord',
  'forecasting-replenishment': 'Réapprovisionnement',
  'forecasting-revenue': 'Prévision de revenus',
  'treasury-cash-forecast': 'Trésorerie prévisionnelle',
  'forecasting-abc-xyz': 'Matrice ABC/XYZ',
  'forecasting-promotions': 'Promotions'
};

/** Human-readable label for a known screen id (without the analysis prefix). */
export function resolveScreenLabel(screenId: string): string {
  const trimmed = screenId.trim();
  if (!trimmed) {
    return $localize`:@@ai-assistant.ai-screen-labels.ts.ecran.32ad662e:écran`;
  }
  return SCREEN_LABELS[trimmed] ?? humanizeScreenId(trimmed);
}

/** User-facing bubble text when launching screen analysis from a business screen. */
export function buildScreenAnalysisDisplayLabel(screenId: string): string {
  return $localize`:@@ai-assistant.ai-screen-labels.ts.analyse.de.l.ecran.resolvescreenlabel.d8e572d2:Analyse de l'écran : ${resolveScreenLabel(screenId)}:resolveScreenLabel:`;
}

function humanizeScreenId(screenId: string): string {
  return screenId
    .split('-')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
