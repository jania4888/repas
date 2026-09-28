const SCREEN_LABELS: Record<string, string> = {
  'accounting-ledger': $localize`:@@ai-assistant.ai-screen-labels.ts.grand.livre.7eef7547:Grand livre`,
  'accounting-journal': $localize`:@@ai-assistant.ai-screen-labels.ts.journal.comptable.cc13c236:Journal comptable`,
  'accounting-balance-sheet': $localize`:@@ai-assistant.ai-screen-labels.ts.bilan.a80c4623:Bilan`,
  'accounting-income-statement': $localize`:@@ai-assistant.ai-screen-labels.ts.compte.de.resultat.a292527b:Compte de résultat`,
  'accounting-balance': $localize`:@@ai-assistant.ai-screen-labels.ts.balance.90eef613:Balance`,
  'accounting-chart': $localize`:@@ai-assistant.ai-screen-labels.ts.plan.comptable.b3f54c09:Plan comptable`,
  'accounting-sub-journals': $localize`:@@ai-assistant.ai-screen-labels.ts.journaux.auxiliaires.a7120594:Journaux auxiliaires`,
  'accounting-lettering': $localize`:@@ai-assistant.ai-screen-labels.ts.lettrage.cfcdd333:Lettrage`,
  'accounting-closing': $localize`:@@ai-assistant.ai-screen-labels.ts.cloture.comptable.830f58cc:Clôture comptable`,
  'accounting-vat-declaration': $localize`:@@ai-assistant.ai-screen-labels.ts.declaration.tva.4358470d:Déclaration TVA`,
  'accounting-manual-entry': $localize`:@@ai-assistant.ai-screen-labels.ts.saisie.manuelle.da81002e:Saisie manuelle`,
  'accounting-aging': $localize`:@@ai-assistant.ai-screen-labels.ts.balance.agee.f6b2095b:Balance âgée`,
  'invoice-list': $localize`:@@ai-assistant.ai-screen-labels.ts.liste.des.factures.6df70aea:Liste des factures`,
  'credit-note-list': $localize`:@@ai-assistant.ai-screen-labels.ts.liste.des.avoirs.48e6a60e:Liste des avoirs`,
  'cash-desk': $localize`:@@ai-assistant.ai-screen-labels.ts.caisse.ce5a5c98:Caisse`,
  'stock-simple': $localize`:@@ai-assistant.ai-screen-labels.ts.stock.bcecf456:Stock`,
  dashboard: $localize`:@@ai-assistant.ai-screen-labels.ts.tableau.de.bord.a524057f:Tableau de bord`,
  'forecasting-replenishment': $localize`:@@ai-assistant.ai-screen-labels.ts.reapprovisionnement.77e72f0b:Réapprovisionnement`,
  'forecasting-revenue': $localize`:@@ai-assistant.ai-screen-labels.ts.prevision.de.revenus.061657da:Prévision de revenus`,
  'treasury-cash-forecast': $localize`:@@ai-assistant.ai-screen-labels.ts.tresorerie.previsionnelle.0fa48711:Trésorerie prévisionnelle`,
  'forecasting-abc-xyz': $localize`:@@ai-assistant.ai-screen-labels.ts.matrice.abc.xyz.631bd4b2:Matrice ABC/XYZ`,
  'forecasting-promotions': $localize`:@@ai-assistant.ai-screen-labels.ts.promotions.086e09b4:Promotions`
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
