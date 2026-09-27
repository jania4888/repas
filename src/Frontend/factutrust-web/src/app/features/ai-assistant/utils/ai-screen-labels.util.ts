const SCREEN_LABELS: Record<string, string> = {
  'accounting-ledger': 'Grand livre',
  'accounting-journal': 'Journal comptable',
  'accounting-balance-sheet': 'Bilan',
  'accounting-income-statement': $localize`:@@ai-assistant.ai-screen-labels.ts.compte.de.resultat.a292527b:Compte de résultat`,
  'accounting-balance': 'Balance',
  'accounting-chart': 'Plan comptable',
  'accounting-sub-journals': 'Journaux auxiliaires',
  'accounting-lettering': 'Lettrage',
  'accounting-closing': $localize`:@@ai-assistant.ai-screen-labels.ts.cloture.comptable.830f58cc:Clôture comptable`,
  'accounting-vat-declaration': $localize`:@@ai-assistant.ai-screen-labels.ts.declaration.tva.4358470d:Déclaration TVA`,
  'accounting-manual-entry': 'Saisie manuelle',
  'accounting-aging': $localize`:@@ai-assistant.ai-screen-labels.ts.balance.agee.f6b2095b:Balance âgée`,
  'invoice-list': $localize`:@@ai-assistant.ai-screen-labels.ts.liste.des.factures.6df70aea:Liste des factures`,
  'credit-note-list': $localize`:@@ai-assistant.ai-screen-labels.ts.liste.des.avoirs.48e6a60e:Liste des avoirs`,
  'cash-desk': 'Caisse',
  'stock-simple': $localize`:@@ai-assistant.ai-screen-labels.ts.stock.bcecf456:Stock`,
  dashboard: $localize`:@@ai-assistant.ai-screen-labels.ts.tableau.de.bord.a524057f:Tableau de bord`,
  'forecasting-replenishment': $localize`:@@ai-assistant.ai-screen-labels.ts.reapprovisionnement.77e72f0b:Réapprovisionnement`,
  'forecasting-revenue': $localize`:@@ai-assistant.ai-screen-labels.ts.prevision.de.revenus.061657da:Prévision de revenus`,
  'treasury-cash-forecast': $localize`:@@ai-assistant.ai-screen-labels.ts.tresorerie.previsionnelle.0fa48711:Trésorerie prévisionnelle`,
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
