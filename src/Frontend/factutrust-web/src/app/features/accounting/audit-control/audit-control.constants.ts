export const ANOMALY_STATUS_LABELS: Record<number, string> = {
  0: $localize`:@@accounting.audit-control.constants.ts.non.corrige.31c0294c:Non corrigé`,
  1: 'En cours',
  2: $localize`:@@accounting.audit-control.constants.ts.a.surveiller.2e8f415a:À surveiller`,
  3: $localize`:@@accounting.audit-control.constants.ts.corrige.f27d5dca:Corrigé`,
  4: $localize`:@@accounting.audit-control.constants.ts.ignore.2af07447:Ignoré`
};

export const SEVERITY_LABELS: Record<number, string> = {
  2: 'Bloquant',
  1: 'Avertissement',
  0: 'Information'
};

export const CATEGORY_LABELS: Record<number, string> = {
  0: $localize`:@@accounting.audit-control.constants.ts.integrite.c39d85b4:Intégrité`,
  1: $localize`:@@accounting.audit-control.constants.ts.ecritures.7bfac2f6:Écritures`,
  2: 'Comptes',
  3: 'Lettrage',
  4: 'Rapprochement',
  5: 'TVA',
  6: 'Analytique',
  7: $localize`:@@accounting.audit-control.constants.ts.fiscalite.0546e952:Fiscalité`,
  8: 'Immobilisations',
  9: $localize`:@@accounting.audit-control.constants.ts.budgetaire.aa45f4f1:Budgétaire`,
  10: 'Liasse',
  11: 'Banque',
  12: 'Achats',
  13: 'Ventes',
  14: 'Paie',
  15: $localize`:@@accounting.audit-control.constants.ts.tresorerie.e0e75da7:Trésorerie`,
  16: 'Documents'
};

export type SeverityTab = 'all' | 'blocking' | 'warning' | 'info' | 'ignored';

export const SEVERITY_TAB_TO_FILTER: Record<SeverityTab, { severity?: number; status?: number }> = {
  all: {},
  blocking: { severity: 2 },
  warning: { severity: 1 },
  info: { severity: 0 },
  ignored: { status: 4 }
};
