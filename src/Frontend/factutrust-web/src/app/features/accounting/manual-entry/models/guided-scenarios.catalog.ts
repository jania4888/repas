import { EntryLine, createEmptyLine } from './entry-form.model';

export type GuidedScenarioId =
  | 'achats'
  | 'ventes'
  | 'banque'
  | 'caisse'
  | 'od'
  | 'immobilisations'
  | 'paie'
  | 'od-regularisation';

export type AmountSource = 'ht' | 'tva' | 'ttc';
export type LineSide = 'debit' | 'credit';
export type VatSide = 'deductible' | 'collected' | null;

export interface GuidedLineTemplate {
  role: 'base' | 'vat' | 'counterpart';
  accountCandidates: readonly string[];
  side: LineSide;
  amountSource: AmountSource;
  labelTemplate?: string;
}

export interface GuidedScenario {
  id: GuidedScenarioId;
  label: string;
  description: string;
  icon: string;
  defaultJournalCode: string;
  thirdPartyKind: 1 | 2 | null;
  vatSide: VatSide;
  lineTemplates: readonly GuidedLineTemplate[];
}

export const GUIDED_SCENARIOS: readonly GuidedScenario[] = [
  {
    id: 'achats',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.achats.ee5b078c:Achats`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.une.facture.fournisseur.un.a.5b3766db:Enregistrer une facture fournisseur, un avoir ou un règlement.`,
    icon: 'pi pi-shopping-cart',
    defaultJournalCode: 'JA',
    thirdPartyKind: 2,
    vatSide: 'deductible',
    lineTemplates: [
      { role: 'base', accountCandidates: ['607', '606', '601', '604', '605'], side: 'debit', amountSource: 'ht', labelTemplate: 'Achat HT' },
      { role: 'vat', accountCandidates: ['43666', '43662'], side: 'debit', amountSource: 'tva', labelTemplate: 'TVA déductible' },
      { role: 'counterpart', accountCandidates: ['4011'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Fournisseur' }
    ]
  },
  {
    id: 'ventes',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.ventes.9087fc4f:Ventes`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.une.facture.client.un.avoir.197c0c64:Enregistrer une facture client, un avoir ou un règlement.`,
    icon: 'pi pi-shopping-bag',
    defaultJournalCode: 'JV',
    thirdPartyKind: 1,
    vatSide: 'collected',
    lineTemplates: [
      { role: 'counterpart', accountCandidates: ['4111'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Client' },
      { role: 'base', accountCandidates: ['707', '701', '705'], side: 'credit', amountSource: 'ht', labelTemplate: 'Vente HT' },
      { role: 'vat', accountCandidates: ['436711'], side: 'credit', amountSource: 'tva', labelTemplate: 'TVA collectée' }
    ]
  },
  {
    id: 'banque',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.banque.2a7302cd:Banque`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.un.paiement.un.encaissement.a1babf9e:Enregistrer un paiement, un encaissement ou un virement bancaire.`,
    icon: 'pi pi-building',
    defaultJournalCode: 'JB',
    thirdPartyKind: null,
    vatSide: null,
    lineTemplates: [
      { role: 'base', accountCandidates: ['5321'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Banque' },
      { role: 'counterpart', accountCandidates: ['4011', '4111', '607', '606'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Contrepartie' }
    ]
  },
  {
    id: 'caisse',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.caisse.ce5a5c98:Caisse`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.une.operation.de.caisse.65afbd4e:Enregistrer une opération de caisse.`,
    icon: 'pi pi-money-bill',
    defaultJournalCode: 'JC',
    thirdPartyKind: null,
    vatSide: null,
    lineTemplates: [
      { role: 'base', accountCandidates: ['5411'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Caisse' },
      { role: 'counterpart', accountCandidates: ['607', '606', '638'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Contrepartie' }
    ]
  },
  {
    id: 'od',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.operations.diverses.1735f774:Opérations diverses`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.saisir.une.ecriture.manuelle.od.diverse.d35b3283:Saisir une écriture manuelle (OD diverse).`,
    icon: 'pi pi-pencil',
    defaultJournalCode: 'JOD',
    thirdPartyKind: null,
    vatSide: null,
    lineTemplates: [
      { role: 'base', accountCandidates: ['638', '758'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Charge / produit' },
      { role: 'counterpart', accountCandidates: ['4011', '4111', '5321', '5411'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Contrepartie' }
    ]
  },
  {
    id: 'immobilisations',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.immobilisations.1e4cbe01:Immobilisations`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.l.acquisition.la.mise.en.ser.37aa25c4:Enregistrer l'acquisition, la mise en service ou la cession d'un bien.`,
    icon: 'pi pi-building-columns',
    defaultJournalCode: 'JIM',
    thirdPartyKind: 2,
    vatSide: 'deductible',
    lineTemplates: [
      { role: 'base', accountCandidates: ['221', '223', '228'], side: 'debit', amountSource: 'ht', labelTemplate: 'Immobilisation' },
      { role: 'vat', accountCandidates: ['43662', '43666'], side: 'debit', amountSource: 'tva', labelTemplate: 'TVA déductible immo' },
      { role: 'counterpart', accountCandidates: ['4011', '5321'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Fournisseur / Banque' }
    ]
  },
  {
    id: 'paie',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.paie.6ca885f3:Paie`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.les.ecritures.de.paie.et.cha.de8fdd9a:Enregistrer les écritures de paie et charges sociales.`,
    icon: 'pi pi-users',
    defaultJournalCode: 'JOD',
    thirdPartyKind: null,
    vatSide: null,
    lineTemplates: [
      { role: 'base', accountCandidates: ['640', '641', '645', '646'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Charges de personnel' },
      { role: 'counterpart', accountCandidates: ['425', '422', '423', '432'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Dettes sociales / salariales' }
    ]
  },
  {
    id: 'od-regularisation',
    label: $localize`:@@accounting.guided-scenarios.catalog.ts.od.de.regularisation.7d97d767:OD de régularisation`,
    description: $localize`:@@accounting.guided-scenarios.catalog.ts.enregistrer.les.ecritures.de.regularisat.d33b1a72:Enregistrer les écritures de régularisation (frais, produits, etc.).`,
    icon: 'pi pi-sync',
    defaultJournalCode: 'JOD',
    thirdPartyKind: null,
    vatSide: null,
    lineTemplates: [
      { role: 'base', accountCandidates: ['486', '487'], side: 'debit', amountSource: 'ttc', labelTemplate: 'Charges constatées d\'avance / PCA' },
      { role: 'counterpart', accountCandidates: ['481', '491'], side: 'credit', amountSource: 'ttc', labelTemplate: 'Produits constatés d\'avance / CCA' }
    ]
  }
];

export function getScenarioById(id: GuidedScenarioId): GuidedScenario | undefined {
  return GUIDED_SCENARIOS.find(s => s.id === id);
}

export function resolveAmount(source: AmountSource, ht: number, tva: number, ttc: number): number {
  switch (source) {
    case 'ht': return ht;
    case 'tva': return tva;
    case 'ttc': return ttc;
  }
}

export function buildScenarioLines(
  scenario: GuidedScenario,
  resolveAccount: (candidates: readonly string[]) => string | null,
  amounts: { ht: number; tva: number; ttc: number },
  generalLabel: string
): EntryLine[] {
  return scenario.lineTemplates.map(tpl => {
    const account = resolveAccount(tpl.accountCandidates);
    const amount = resolveAmount(tpl.amountSource, amounts.ht, amounts.tva, amounts.ttc);
    const line: EntryLine = {
      ...createEmptyLine(),
      accountNumber: account ?? '',
      lineLabel: tpl.labelTemplate ? `${tpl.labelTemplate} — ${generalLabel}` : generalLabel,
      debit: tpl.side === 'debit' && amount > 0 ? amount : null,
      credit: tpl.side === 'credit' && amount > 0 ? amount : null
    };
    return line;
  });
}

export function formatPeriodLabel(fiscalYear: number, month: number): string {
  const months = [
    $localize`:@@accounting.guided-scenarios.catalog.ts.janvier.7a32ae0f:Janvier`, $localize`:@@accounting.guided-scenarios.catalog.ts.fevrier.63fc1803:Février`, $localize`:@@accounting.guided-scenarios.catalog.ts.mars.1778011d:Mars`, $localize`:@@accounting.guided-scenarios.catalog.ts.avril.4efeee46:Avril`, $localize`:@@accounting.guided-scenarios.catalog.ts.mai.afe526a6:Mai`, $localize`:@@accounting.guided-scenarios.catalog.ts.juin.8b1e84b6:Juin`,
    $localize`:@@accounting.guided-scenarios.catalog.ts.juillet.e8e0920c:Juillet`, $localize`:@@accounting.guided-scenarios.catalog.ts.aout.460b6696:Août`, $localize`:@@accounting.guided-scenarios.catalog.ts.septembre.08d23f31:Septembre`, $localize`:@@accounting.guided-scenarios.catalog.ts.octobre.0ed28485:Octobre`, $localize`:@@accounting.guided-scenarios.catalog.ts.novembre.632580af:Novembre`, $localize`:@@accounting.guided-scenarios.catalog.ts.decembre.03bcd9b0:Décembre`
  ];
  return `${months[month - 1] ?? month} ${fiscalYear}`;
}
