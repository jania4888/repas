export const ANOMALY_STATUS_LABELS: Record<number, string> = {
  0: $localize`:@@accounting.audit-control.constants.ts.non.corrige.31c0294c:Non corrigé`,
  1: $localize`:@@accounting.audit-control.constants.ts.en.cours.bc9b533a:En cours`,
  2: $localize`:@@accounting.audit-control.constants.ts.a.surveiller.2e8f415a:À surveiller`,
  3: $localize`:@@accounting.audit-control.constants.ts.corrige.f27d5dca:Corrigé`,
  4: $localize`:@@accounting.audit-control.constants.ts.ignore.2af07447:Ignoré`
};

export const SEVERITY_LABELS: Record<number, string> = {
  2: $localize`:@@accounting.audit-control.constants.ts.bloquant.c05c5176:Bloquant`,
  1: $localize`:@@accounting.audit-control.constants.ts.avertissement.1b3e2777:Avertissement`,
  0: $localize`:@@accounting.audit-control.constants.ts.information.0eb5ed50:Information`
};

export const CATEGORY_LABELS: Record<number, string> = {
  0: $localize`:@@accounting.audit-control.constants.ts.integrite.c39d85b4:Intégrité`,
  1: $localize`:@@accounting.audit-control.constants.ts.ecritures.7bfac2f6:Écritures`,
  2: $localize`:@@accounting.audit-control.constants.ts.comptes.f778ac95:Comptes`,
  3: $localize`:@@accounting.audit-control.constants.ts.lettrage.cfcdd333:Lettrage`,
  4: $localize`:@@accounting.audit-control.constants.ts.rapprochement.ed7c2df9:Rapprochement`,
  5: 'TVA',
  6: $localize`:@@accounting.audit-control.constants.ts.analytique.c5df4dcf:Analytique`,
  7: $localize`:@@accounting.audit-control.constants.ts.fiscalite.0546e952:Fiscalité`,
  8: $localize`:@@accounting.audit-control.constants.ts.immobilisations.1e4cbe01:Immobilisations`,
  9: $localize`:@@accounting.audit-control.constants.ts.budgetaire.aa45f4f1:Budgétaire`,
  10: $localize`:@@accounting.audit-control.constants.ts.liasse.d1843f76:Liasse`,
  11: $localize`:@@accounting.audit-control.constants.ts.banque.2a7302cd:Banque`,
  12: $localize`:@@accounting.audit-control.constants.ts.achats.ee5b078c:Achats`,
  13: $localize`:@@accounting.audit-control.constants.ts.ventes.9087fc4f:Ventes`,
  14: $localize`:@@accounting.audit-control.constants.ts.paie.6ca885f3:Paie`,
  15: $localize`:@@accounting.audit-control.constants.ts.tresorerie.e0e75da7:Trésorerie`,
  16: $localize`:@@accounting.audit-control.constants.ts.documents.687c8286:Documents`
};

export type SeverityTab = 'all' | 'blocking' | 'warning' | 'info' | 'ignored';

export const SEVERITY_TAB_TO_FILTER: Record<SeverityTab, { severity?: number; status?: number }> = {
  all: {},
  blocking: { severity: 2 },
  warning: { severity: 1 },
  info: { severity: 0 },
  ignored: { status: 4 }
};
