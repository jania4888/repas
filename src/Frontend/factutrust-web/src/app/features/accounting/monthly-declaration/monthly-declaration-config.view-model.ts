import {
  AccountBalanceSide,
  ChartOfAccountDto,
  CreateMonthlyDeclarationRubricRequest,
  DeclarationDocumentSource,
  MonthlyDeclarationFamily,
  MonthlyDeclarationFamilySettingDto,
  MonthlyDeclarationRubricAccountDto,
  MonthlyDeclarationRubricDto,
  MonthlyDeclarationSettingsDto,
  PayrollContributionComponent,
  RubricAccountMatchMode,
  RubricAccountRole,
  RubricGrossKind,
  RubricWithheldKind,
  UpdateMonthlyDeclarationRubricRequest
} from '../services/accounting.service';

/**
 * Logique d'affichage de l'écran Configuration DM — fonctions pures, sans Angular ni HTTP.
 *
 * Les règles reproduites ici (taux obligatoire, comptes obligatoires, couple de types interdit…)
 * sont un CONFORT DE SAISIE, pas une autorisation : le serveur revalide tout et reste seul juge.
 * Elles existent en miroir de `MonthlyDeclarationRubric.Validate` pour éviter l'aller-retour d'une
 * erreur évidente, jamais pour s'y substituer.
 */

// ── Catalogue des onglets ────────────────────────────────────────────────────

export interface DmFamilyTab {
  family: MonthlyDeclarationFamily;
  /** Libellé de l'onglet — court, il doit tenir dans une barre de onze onglets. */
  label: string;
  /** Intitulé complet, affiché en tête du panneau. */
  title: string;
  hint: string;
}

/**
 * Les onze familles, dans l'ordre du formulaire officiel. « Autres informations » ferme la liste
 * parce que ce n'est pas un impôt : la famille ne porte aucun montant à payer.
 */
export const DM_FAMILY_TABS: readonly DmFamilyTab[] = [
  {
    family: MonthlyDeclarationFamily.Withholding,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.a.la.source.340b5d5f:Retenue à la source`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.a.la.source.340b5d5f:Retenue à la source`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.articles.1.a.31.du.formulaire.officiel.l.b4f0f9c2:Articles 1 à 31 du formulaire officiel. Le code rapport porte le numéro d’article (ex. « 17.2 »).`
  },
  {
    family: MonthlyDeclarationFamily.Tfp,
    label: 'T.F.P',
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.taxe.de.formation.professionnelle.70811e15:Taxe de formation professionnelle`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.assiette.et.taux.repris.du.cycle.de.paie.560851c3:Assiette et taux repris du cycle de paie du mois, ou des comptes de charges de personnel.`
  },
  {
    family: MonthlyDeclarationFamily.Foprolos,
    label: 'FOPROLOS',
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.fonds.de.promotion.des.logements.pour.sa.837ea8d6:Fonds de promotion des logements pour salariés`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.meme.assiette.que.la.t.f.p.dans.le.cas.g.aa5b5210:Même assiette que la T.F.P dans le cas général.`
  },
  {
    family: MonthlyDeclarationFamily.ConsumptionDuty,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.consommation.97da36c0:Droit de consommation`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.consommation.97da36c0:Droit de consommation`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.aucune.case.de.detail.cartographiee.en.2.58f44eac:Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.`
  },
  {
    family: MonthlyDeclarationFamily.Vat,
    label: 'T.V.A',
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.taxe.sur.la.valeur.ajoutee.46687b10:Taxe sur la valeur ajoutée`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.affichee.pour.memoire.la.t.v.a.reste.der.094084ef:Affichée pour mémoire : la T.V.A reste dérivée des factures et du chaînage de crédit, hors moteur paramétré.`
  },
  {
    family: MonthlyDeclarationFamily.OtherTurnoverTaxes,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.autres.taxes.c.a.50a65ce8:Autres taxes C.A`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.autres.taxes.sur.le.chiffre.d.affaires.1775df3d:Autres taxes sur le chiffre d’affaires`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.fodec.et.assimilees.faa4d057:FODEC et assimilées.`
  },
  {
    family: MonthlyDeclarationFamily.StampDuty,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.timbre.01f26054:Droit de timbre`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.timbre.01f26054:Droit de timbre`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.aucune.case.de.detail.cartographiee.en.2.58f44eac:Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.`
  },
  {
    family: MonthlyDeclarationFamily.HotelTax,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.taxe.hoteliere.90f43822:Taxe hôtelière`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.taxe.hoteliere.90f43822:Taxe hôtelière`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.aucune.case.de.detail.cartographiee.en.2.58f44eac:Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.`
  },
  {
    family: MonthlyDeclarationFamily.Tcl,
    label: 'T.C.L',
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.taxe.sur.les.etablissements.a.caractere.416445d7:Taxe sur les établissements à caractère industriel, commercial ou professionnel`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.typiquement.brut.comptes.de.produits.sen.647d289b:Typiquement « brut = comptes de produits, sens créditeur » et « retenue = brut × taux ».`
  },
  {
    family: MonthlyDeclarationFamily.LicenceFee,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.licence.925640a2:Droit de licence`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.licence.925640a2:Droit de licence`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.aucune.case.de.detail.cartographiee.en.2.58f44eac:Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.`
  },
  {
    family: MonthlyDeclarationFamily.OtherInformation,
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.autres.informations.ac5ce77d:Autres informations`,
    title: $localize`:@@accounting.monthly-declaration-config.view-model.ts.autres.informations.ac5ce77d:Autres informations`,
    hint: $localize`:@@accounting.monthly-declaration-config.view-model.ts.declaratif.achats.en.suspension.exportat.467f6b3a:Déclaratif : achats en suspension, exportations, chiffre d’affaires exonéré… Aucun montant à payer.`
  }
];

export function familyTab(family: MonthlyDeclarationFamily): DmFamilyTab | undefined {
  return DM_FAMILY_TABS.find(t => t.family === family);
}

export function familyLabel(family: MonthlyDeclarationFamily): string {
  return familyTab(family)?.label ?? $localize`:@@accounting.monthly-declaration-config.view-model.ts.famille.family.e5385090:Famille ${family}:family:`;
}

/**
 * La T.V.A est volontairement hors du moteur : ses montants viennent des documents de facture et
 * le chaînage de crédit reste porté par l'entité. Ses rubriques s'affichent, mais l'écran le dit.
 */
export function isFamilyOutOfEngineScope(family: MonthlyDeclarationFamily): boolean {
  return family === MonthlyDeclarationFamily.Vat;
}

// ── Listes déroulantes ───────────────────────────────────────────────────────

export interface DmOption<T> {
  label: string;
  value: T;
}

export const DM_GROSS_KIND_OPTIONS: readonly DmOption<RubricGrossKind>[] = [
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.fixe.saisie.5355f54c:Valeur fixe / saisie`, value: RubricGrossKind.Fixed },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.de.paie.00856faf:Valeur de paie`, value: RubricGrossKind.Payroll },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.solde.de.comptes.095ae5f3:Solde de comptes`, value: RubricGrossKind.Account },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.documents.de.la.periode.f4b7e6b9:Documents de la période`, value: RubricGrossKind.Document },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.taux.53769d11:Retenue ÷ taux`, value: RubricGrossKind.WithheldOverRate }
];

export const DM_WITHHELD_KIND_OPTIONS: readonly DmOption<RubricWithheldKind>[] = [
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.fixe.saisie.5355f54c:Valeur fixe / saisie`, value: RubricWithheldKind.Fixed },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.solde.de.comptes.095ae5f3:Solde de comptes`, value: RubricWithheldKind.Account },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.brut.taux.adedfda6:Brut × taux`, value: RubricWithheldKind.GrossTimesRate },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.de.paie.00856faf:Valeur de paie`, value: RubricWithheldKind.Payroll },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.documents.de.la.periode.f4b7e6b9:Documents de la période`, value: RubricWithheldKind.Document },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.taux.non.pris.en.charge.180ce782:Retenue ÷ taux (non pris en charge)`, value: RubricWithheldKind.WithheldOverRate }
];

export const DM_SIDE_OPTIONS: readonly DmOption<AccountBalanceSide>[] = [
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.debiteur.53ef5606:Débiteur`, value: AccountBalanceSide.Debit },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.crediteur.7bdc1af0:Créditeur`, value: AccountBalanceSide.Credit }
];

export const DM_PAYROLL_COMPONENT_OPTIONS: readonly DmOption<PayrollContributionComponent>[] = [
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.masse.salariale.brute.7083b525:Masse salariale brute`, value: PayrollContributionComponent.SalariesGrossBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.net.imposable.2439110f:Net imposable`, value: PayrollContributionComponent.SalariesNetTaxableBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.assiette.taxes.sur.salaires.2f68e583:Assiette taxes sur salaires`, value: PayrollContributionComponent.PayrollTaxBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.irpp.retenu.7cc73d3d:IRPP retenu`, value: PayrollContributionComponent.WithholdingIrpp },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.css.retenue.034ee1f0:CSS retenue`, value: PayrollContributionComponent.WithholdingCss },
  { label: 'IRPP + CSS', value: PayrollContributionComponent.WithholdingTotal },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.t.f.p.du.cycle.d85aaf4d:T.F.P du cycle`, value: PayrollContributionComponent.Tfp },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.foprolos.du.cycle.3fa66678:FOPROLOS du cycle`, value: PayrollContributionComponent.Foprolos },
  {
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.assiette.taxes.sur.salaires.industries.m.a72878ec:Assiette taxes sur salaires — industries manufacturières (TFP 1 %)`,
    value: PayrollContributionComponent.PayrollTaxBaseManufacturing
  },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.t.f.p.industries.manufacturieres.1.23b056f3:T.F.P — industries manufacturières (1 %)`, value: PayrollContributionComponent.TfpManufacturing },
  {
    label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.assiette.taxes.sur.salaires.autres.activ.ad9876d9:Assiette taxes sur salaires — autres activités (TFP 2 %)`,
    value: PayrollContributionComponent.PayrollTaxBaseOtherActivities
  },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.t.f.p.autres.activites.2.3e083695:T.F.P — autres activités (2 %)`, value: PayrollContributionComponent.TfpOtherActivities }
];

/** Libellés des valeurs documentaires. Miroir de `DeclarationDocumentSources.Label` côté serveur. */
export const DM_DOCUMENT_SOURCE_OPTIONS: readonly DmOption<DeclarationDocumentSource>[] = [
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.chiffre.d.affaires.ht.facture.b50c678b:Chiffre d’affaires HT facturé`, value: DeclarationDocumentSource.SalesTaxableBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.chiffre.d.affaires.ttc.facture.d29ca31f:Chiffre d’affaires TTC facturé`, value: DeclarationDocumentSource.SalesGrossBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.assiette.fodec.8e76c995:Assiette FODEC`, value: DeclarationDocumentSource.FodecFormBase },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.fodec.facture.2fa816a6:FODEC facturé`, value: DeclarationDocumentSource.FodecAmount },
  { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.droit.de.timbre.facture.096df710:Droit de timbre facturé`, value: DeclarationDocumentSource.FiscalStampAmount },
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.salaires.hors.paie.0a505b88:salaires hors paie`, DeclarationDocumentSource.WithholdingSalariesBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.honoraires.3.3be5a3a8:honoraires 3 %`, DeclarationDocumentSource.WithholdingFeesRealRegimeBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.honoraires.autres.taux.05770351:honoraires autres taux`, DeclarationDocumentSource.WithholdingFeesOtherBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.commissions.et.loyers.5912b973:commissions et loyers`, DeclarationDocumentSource.WithholdingCommissionsAndRentsBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.acquisitions.1.ccaa091c:acquisitions 1 %`, DeclarationDocumentSource.WithholdingPurchasesRate1Base),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.acquisitions.0.5.57727617:acquisitions 0,5 %`, DeclarationDocumentSource.WithholdingPurchasesRate05Base),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.acquisitions.1.5.47e8bd5c:acquisitions 1,5 %`, DeclarationDocumentSource.WithholdingPurchasesRate15Base),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.revenus.de.capitaux.mobiliers.492d44bd:revenus de capitaux mobiliers`, DeclarationDocumentSource.WithholdingCapitalIncomeBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.dividendes.30d4a062:dividendes`, DeclarationDocumentSource.WithholdingDividendsBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.revenus.immobiliers.b5438475:revenus immobiliers`, DeclarationDocumentSource.WithholdingRealEstateBase),
  ...withholdingPair('TVA 100 %', DeclarationDocumentSource.WithholdingVatFullBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.tva.autres.taux.24814f07:TVA autres taux`, DeclarationDocumentSource.WithholdingVatOtherBase),
  ...withholdingPair('plus-values', DeclarationDocumentSource.WithholdingCapitalGainsBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.non.residents.245e3131:non-résidents`, DeclarationDocumentSource.WithholdingNonResidentsBase),
  ...withholdingPair($localize`:@@accounting.monthly-declaration-config.view-model.ts.reliquat.sans.ligne.dediee.d86737a8:reliquat sans ligne dédiée`, DeclarationDocumentSource.WithholdingRemainderBase)
];

/** Assiette (numéro pair) et retenue (le suivant) d'un compartiment du rapport RS. */
function withholdingPair(label: string, base: DeclarationDocumentSource): DmOption<DeclarationDocumentSource>[] {
  return [
    { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.a.la.source.label.assiette.ccf6a09d:Retenue à la source — ${label}:label: (assiette)`, value: base },
    { label: $localize`:@@accounting.monthly-declaration-config.view-model.ts.retenue.a.la.source.label.retenue.b66cd8b9:Retenue à la source — ${label}:label: (retenue)`, value: (base + 1) as DeclarationDocumentSource }
  ];
}

/**
 * Une assiette n'alimente que le brut, un montant que la retenue : lire le chiffre d'affaires comme
 * une retenue produirait un impôt égal au chiffre d'affaires. Miroir de
 * `DeclarationDocumentSources.IsBase` côté serveur.
 */
export function isDocumentBase(source: DeclarationDocumentSource): boolean {
  switch (source) {
    case DeclarationDocumentSource.SalesTaxableBase:
    case DeclarationDocumentSource.SalesGrossBase:
    case DeclarationDocumentSource.FodecFormBase:
      return true;
    case DeclarationDocumentSource.FodecAmount:
    case DeclarationDocumentSource.FiscalStampAmount:
      return false;
    default:
      return source % 2 === 0;
  }
}

export const DM_GROSS_DOCUMENT_OPTIONS: readonly DmOption<DeclarationDocumentSource>[] =
  DM_DOCUMENT_SOURCE_OPTIONS.filter(o => isDocumentBase(o.value));

export const DM_WITHHELD_DOCUMENT_OPTIONS: readonly DmOption<DeclarationDocumentSource>[] =
  DM_DOCUMENT_SOURCE_OPTIONS.filter(o => !isDocumentBase(o.value));

function optionLabel<T>(options: readonly DmOption<T>[], value: T | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return options.find(o => o.value === value)?.label ?? String(value);
}

// ── Modèle de formulaire ─────────────────────────────────────────────────────

/**
 * Comptes d'une colonne. Deux champs et non un seul : un compte exact se choisit dans le plan,
 * une racine (« 61 ») n'y figure pas forcément — l'imposer dans le sélecteur interdirait le cas
 * le plus courant.
 */
export interface DmAccountSelection {
  /** Comptes du plan, rapprochés à l'identique. */
  exact: string[];
  /** Racines saisies à la main, séparées par « ; » — même convention que les postes budgétaires. */
  prefixes: string;
}

export interface DmRubricForm {
  /** `null` pour une création : le code et la famille ne sont plus modifiables ensuite. */
  id: string | null;
  family: MonthlyDeclarationFamily;
  code: string;
  label: string;
  reportCode: string;
  grossKind: RubricGrossKind;
  withheldKind: RubricWithheldKind;
  grossSide: AccountBalanceSide;
  withheldSide: AccountBalanceSide;
  ratePercent: number;
  fixedGrossAmount: number | null;
  fixedWithheldAmount: number | null;
  payrollComponent: PayrollContributionComponent | null;
  withheldPayrollComponent: PayrollContributionComponent | null;
  grossDocumentSource: DeclarationDocumentSource | null;
  withheldDocumentSource: DeclarationDocumentSource | null;
  /** Format `yyyy-MM-dd` (input type="date"). */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  displayOrder: number;
  grossAccounts: DmAccountSelection;
  withheldAccounts: DmAccountSelection;
}

export const DM_CODE_PATTERN = /^[A-Z0-9_]{1,20}$/;
export const DM_REPORT_CODE_PATTERN = /^(\*|[0-9]+(\.[0-9]+)*)$/;
export const DM_MAX_ACCOUNTS_PER_ROLE = 20;

/**
 * Découpe une date ISO en `yyyy-MM-dd` sans passer par `Date` : construire une date pour la
 * reformater déplacerait le jour d'un cran dans les fuseaux négatifs.
 */
export function toDateInputValue(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const ymd = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

export function parsePrefixList(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  return text
    .split(';')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

export function readAccountSelection(
  accounts: readonly MonthlyDeclarationRubricAccountDto[] | undefined,
  role: RubricAccountRole
): DmAccountSelection {
  const ofRole = (accounts ?? []).filter(a => a.role === role);
  return {
    exact: ofRole.filter(a => a.matchMode === RubricAccountMatchMode.Exact).map(a => a.accountNumber),
    prefixes: ofRole
      .filter(a => a.matchMode === RubricAccountMatchMode.Prefix)
      .map(a => a.accountNumber)
      .join(';')
  };
}

function selectionToDtos(
  selection: DmAccountSelection,
  role: RubricAccountRole
): MonthlyDeclarationRubricAccountDto[] {
  const exact = selection.exact
    .map(accountNumber => accountNumber.trim())
    .filter(accountNumber => accountNumber.length > 0)
    .map(accountNumber => ({ role, accountNumber, matchMode: RubricAccountMatchMode.Exact }));
  const prefixes = parsePrefixList(selection.prefixes).map(accountNumber => ({
    role,
    accountNumber,
    matchMode: RubricAccountMatchMode.Prefix
  }));
  return [...exact, ...prefixes];
}

export function countSelectedAccounts(selection: DmAccountSelection): number {
  return (
    selection.exact.filter(a => a.trim().length > 0).length + parsePrefixList(selection.prefixes).length
  );
}

export function buildRubricAccounts(form: DmRubricForm): MonthlyDeclarationRubricAccountDto[] {
  return [
    ...selectionToDtos(form.grossAccounts, RubricAccountRole.Gross),
    ...selectionToDtos(form.withheldAccounts, RubricAccountRole.Withheld)
  ];
}

export function nextDisplayOrder(
  rubrics: readonly MonthlyDeclarationRubricDto[],
  family: MonthlyDeclarationFamily
): number {
  const orders = rubrics.filter(r => r.family === family).map(r => r.displayOrder);
  return orders.length === 0 ? 10 : Math.max(...orders) + 10;
}

export function newRubricForm(family: MonthlyDeclarationFamily, displayOrder: number): DmRubricForm {
  return {
    id: null,
    family,
    code: '',
    label: '',
    reportCode: '*',
    grossKind: RubricGrossKind.Account,
    withheldKind: RubricWithheldKind.GrossTimesRate,
    grossSide: AccountBalanceSide.Credit,
    withheldSide: AccountBalanceSide.Credit,
    ratePercent: 0,
    fixedGrossAmount: null,
    fixedWithheldAmount: null,
    payrollComponent: null,
    withheldPayrollComponent: null,
    grossDocumentSource: null,
    withheldDocumentSource: null,
    effectiveFrom: null,
    effectiveTo: null,
    displayOrder,
    grossAccounts: { exact: [], prefixes: '' },
    withheldAccounts: { exact: [], prefixes: '' }
  };
}

export function toRubricForm(rubric: MonthlyDeclarationRubricDto): DmRubricForm {
  return {
    id: rubric.id,
    family: rubric.family,
    code: rubric.code,
    label: rubric.label,
    reportCode: rubric.reportCode,
    grossKind: rubric.grossKind,
    withheldKind: rubric.withheldKind,
    grossSide: rubric.grossSide,
    withheldSide: rubric.withheldSide,
    ratePercent: rubric.ratePercent,
    fixedGrossAmount: rubric.fixedGrossAmount,
    fixedWithheldAmount: rubric.fixedWithheldAmount,
    payrollComponent: rubric.payrollComponent,
    withheldPayrollComponent: rubric.withheldPayrollComponent,
    grossDocumentSource: rubric.grossDocumentSource ?? null,
    withheldDocumentSource: rubric.withheldDocumentSource ?? null,
    effectiveFrom: toDateInputValue(rubric.effectiveFrom),
    effectiveTo: toDateInputValue(rubric.effectiveTo),
    displayOrder: rubric.displayOrder,
    grossAccounts: readAccountSelection(rubric.accounts, RubricAccountRole.Gross),
    withheldAccounts: readAccountSelection(rubric.accounts, RubricAccountRole.Withheld)
  };
}

function commonPayload(form: DmRubricForm): UpdateMonthlyDeclarationRubricRequest {
  return {
    label: form.label.trim(),
    reportCode: form.reportCode.trim(),
    grossKind: form.grossKind,
    withheldKind: form.withheldKind,
    grossSide: form.grossSide,
    withheldSide: form.withheldSide,
    ratePercent: Number(form.ratePercent) || 0,
    fixedGrossAmount: form.fixedGrossAmount ?? null,
    fixedWithheldAmount: form.fixedWithheldAmount ?? null,
    // Les composants de paie ne partent que si la colonne les utilise : conserver le résidu d'une
    // sélection abandonnée ferait mentir la fiche enregistrée.
    payrollComponent: needsPayrollComponent(form) ? form.payrollComponent : null,
    withheldPayrollComponent: needsWithheldPayrollComponent(form) ? form.withheldPayrollComponent : null,
    grossDocumentSource: needsGrossDocumentSource(form) ? form.grossDocumentSource : null,
    withheldDocumentSource: needsWithheldDocumentSource(form) ? form.withheldDocumentSource : null,
    effectiveFrom: form.effectiveFrom || null,
    effectiveTo: form.effectiveTo || null,
    displayOrder: Number(form.displayOrder) || 0,
    accounts: buildRubricAccounts(form)
  };
}

export function toUpdateRequest(form: DmRubricForm): UpdateMonthlyDeclarationRubricRequest {
  return commonPayload(form);
}

export function toCreateRequest(form: DmRubricForm): CreateMonthlyDeclarationRubricRequest {
  return {
    family: form.family,
    code: form.code.trim().toUpperCase(),
    ...commonPayload(form)
  };
}

// ── Champs exigés par le type choisi ─────────────────────────────────────────

export function needsGrossAccounts(form: DmRubricForm): boolean {
  return form.grossKind === RubricGrossKind.Account;
}

export function needsWithheldAccounts(form: DmRubricForm): boolean {
  return form.withheldKind === RubricWithheldKind.Account;
}

export function needsPayrollComponent(form: DmRubricForm): boolean {
  return form.grossKind === RubricGrossKind.Payroll;
}

export function needsWithheldPayrollComponent(form: DmRubricForm): boolean {
  return form.withheldKind === RubricWithheldKind.Payroll;
}

export function needsGrossDocumentSource(form: DmRubricForm): boolean {
  return form.grossKind === RubricGrossKind.Document;
}

export function needsWithheldDocumentSource(form: DmRubricForm): boolean {
  return form.withheldKind === RubricWithheldKind.Document;
}

export function needsRate(form: DmRubricForm): boolean {
  return (
    form.grossKind === RubricGrossKind.WithheldOverRate ||
    form.withheldKind === RubricWithheldKind.GrossTimesRate
  );
}

export function needsFixedGross(form: DmRubricForm): boolean {
  return form.grossKind === RubricGrossKind.Fixed;
}

export function needsFixedWithheld(form: DmRubricForm): boolean {
  return form.withheldKind === RubricWithheldKind.Fixed;
}

// ── Validation de confort ────────────────────────────────────────────────────

/** Rend le premier message d'erreur, ou `null` si la fiche est envoyable. */
export function validateRubricForm(form: DmRubricForm): string | null {
  const code = form.code.trim().toUpperCase();
  if (!form.id && !code) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.code.de.la.rubrique.est.obligatoire.b3ed4041:Le code de la rubrique est obligatoire.`;
  }
  if (!form.id && !DM_CODE_PATTERN.test(code)) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.code.est.invalide.lettres.majuscules.37d55247:Le code est invalide : lettres majuscules, chiffres et « _ » uniquement, 20 caractères au plus.`;
  }
  if (!form.label.trim()) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.libelle.est.obligatoire.e312d2ca:Le libellé est obligatoire.`;
  }
  if (form.label.trim().length > 200) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.libelle.ne.peut.pas.depasser.200.cara.1c8b3c83:Le libellé ne peut pas dépasser 200 caractères.`;
  }

  const reportCode = form.reportCode.trim();
  if (!reportCode) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.code.rapport.est.obligatoire.060e5725:Le code rapport est obligatoire.`;
  }
  if (reportCode.length > 16 || !DM_REPORT_CODE_PATTERN.test(reportCode)) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.code.rapport.doit.etre.un.numero.d.ar.68421715:Le code rapport doit être un numéro d’article (ex. « 17.2 »), ou « * » pour un repli de famille.`;
  }

  const rate = Number(form.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.le.taux.doit.etre.compris.entre.0.et.100.af09f376:Le taux doit être compris entre 0 et 100 %.`;
  }

  if (
    form.grossKind === RubricGrossKind.WithheldOverRate &&
    form.withheldKind === RubricWithheldKind.GrossTimesRate
  ) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.combinaison.impossible.le.brut.serait.de.dcf5c4fd:Combinaison impossible : le brut serait déduit de la retenue et la retenue déduite du brut. Fixez l’une des deux colonnes.`;
  }
  if (needsRate(form) && rate <= 0) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.ce.mode.de.calcul.exige.un.taux.strictem.296fbdde:Ce mode de calcul exige un taux strictement positif.`;
  }
  if (needsPayrollComponent(form) && form.payrollComponent === null) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.un.brut.issu.de.la.paie.doit.designer.la.14453e3a:Un brut issu de la paie doit désigner la valeur du cycle à reprendre.`;
  }
  if (needsWithheldPayrollComponent(form) && form.withheldPayrollComponent === null) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.une.retenue.issue.de.la.paie.doit.design.330f35c5:Une retenue issue de la paie doit désigner la valeur du cycle à reprendre.`;
  }
  if (needsGrossDocumentSource(form)) {
    if (form.grossDocumentSource === null) {
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.un.brut.issu.des.documents.doit.designer.53bd867c:Un brut issu des documents doit désigner la valeur à reprendre.`;
    }
    if (!isDocumentBase(form.grossDocumentSource)) {
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.cette.valeur.documentaire.n.est.pas.une.923d13d9:Cette valeur documentaire n’est pas une assiette : elle ne peut pas alimenter le montant brut.`;
    }
  }
  if (needsWithheldDocumentSource(form)) {
    if (form.withheldDocumentSource === null) {
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.une.retenue.issue.des.documents.doit.des.2127399a:Une retenue issue des documents doit désigner la valeur à reprendre.`;
    }
    if (isDocumentBase(form.withheldDocumentSource)) {
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.cette.valeur.documentaire.est.une.assiet.a40859dd:Cette valeur documentaire est une assiette : elle ne peut pas alimenter la retenue.`;
    }
  }

  if (needsGrossAccounts(form) && countSelectedAccounts(form.grossAccounts) === 0) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.un.montant.brut.calcule.sur.comptes.exig.f0d240e9:Un montant brut calculé sur comptes exige au moins un compte ou une racine.`;
  }
  if (needsWithheldAccounts(form) && countSelectedAccounts(form.withheldAccounts) === 0) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.une.retenue.calculee.sur.comptes.exige.a.193f0d0b:Une retenue calculée sur comptes exige au moins un compte ou une racine.`;
  }
  if (countSelectedAccounts(form.grossAccounts) > DM_MAX_ACCOUNTS_PER_ROLE) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.la.colonne.brut.ne.peut.pas.retenir.plus.24963b2e:La colonne brut ne peut pas retenir plus de ${DM_MAX_ACCOUNTS_PER_ROLE}:DM_MAX_ACCOUNTS_PER_ROLE: comptes.`;
  }
  if (countSelectedAccounts(form.withheldAccounts) > DM_MAX_ACCOUNTS_PER_ROLE) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.la.colonne.retenue.ne.peut.pas.retenir.p.815d9745:La colonne retenue ne peut pas retenir plus de ${DM_MAX_ACCOUNTS_PER_ROLE}:DM_MAX_ACCOUNTS_PER_ROLE: comptes.`;
  }

  if (form.effectiveFrom && form.effectiveTo && form.effectiveFrom > form.effectiveTo) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.la.date.maximale.d.application.precede.l.7d934043:La date maximale d’application précède la date de début.`;
  }

  return null;
}

// ── Lecture d'une rubrique en clair ──────────────────────────────────────────

function sideLabel(side: AccountBalanceSide): string {
  return side === AccountBalanceSide.Debit ? $localize`:@@accounting.monthly-declaration-config.view-model.ts.debits.259795bd:débits` : $localize`:@@accounting.monthly-declaration-config.view-model.ts.credits.8269ea49:crédits`;
}

function accountsSummary(
  accounts: readonly MonthlyDeclarationRubricAccountDto[],
  role: RubricAccountRole
): string {
  const ofRole = accounts.filter(a => a.role === role);
  if (ofRole.length === 0) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.aucun.compte.9f74e0b8:aucun compte`;
  }
  return ofRole
    .map(a => (a.matchMode === RubricAccountMatchMode.Prefix ? `${a.accountNumber}…` : a.accountNumber))
    .join(', ');
}

/** Phrase courte décrivant l'origine du montant brut, affichée dans la table. */
export function describeGross(rubric: MonthlyDeclarationRubricDto): string {
  switch (rubric.grossKind) {
    case RubricGrossKind.Fixed:
      return rubric.fixedGrossAmount === null
        ? 'Saisie au Calcul DM'
        : $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.fixe.fixedgrossamount.95780a00:Valeur fixe ${rubric.fixedGrossAmount}:fixedGrossAmount:`;
    case RubricGrossKind.Payroll:
      return `Paie — ${optionLabel(DM_PAYROLL_COMPONENT_OPTIONS, rubric.payrollComponent)}`;
    case RubricGrossKind.Account:
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.sidelabel.de.accountssummary.9c9031a1:${sideLabel(rubric.grossSide)}:sideLabel: de ${accountsSummary(rubric.accounts, RubricAccountRole.Gross)}:accountsSummary:`;
    case RubricGrossKind.Document:
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.documents.optionlabel.1fe300d3:Documents — ${optionLabel(DM_DOCUMENT_SOURCE_OPTIONS, rubric.grossDocumentSource)}:optionLabel:`;
    case RubricGrossKind.WithheldOverRate:
      return `Retenue ÷ ${rubric.ratePercent} %`;
    default:
      return '—';
  }
}

/** Phrase courte décrivant l'origine de la retenue, affichée dans la table. */
export function describeWithheld(rubric: MonthlyDeclarationRubricDto): string {
  switch (rubric.withheldKind) {
    case RubricWithheldKind.Fixed:
      return rubric.fixedWithheldAmount === null
        ? 'Saisie au Calcul DM'
        : $localize`:@@accounting.monthly-declaration-config.view-model.ts.valeur.fixe.fixedwithheldamount.994a92e3:Valeur fixe ${rubric.fixedWithheldAmount}:fixedWithheldAmount:`;
    case RubricWithheldKind.Account:
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.sidelabel.de.accountssummary.9c9031a1:${sideLabel(rubric.withheldSide)}:sideLabel: de ${accountsSummary(rubric.accounts, RubricAccountRole.Withheld)}:accountsSummary:`;
    case RubricWithheldKind.GrossTimesRate:
      return `Brut × ${rubric.ratePercent} %`;
    case RubricWithheldKind.Payroll:
      return `Paie — ${optionLabel(DM_PAYROLL_COMPONENT_OPTIONS, rubric.withheldPayrollComponent)}`;
    case RubricWithheldKind.Document:
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.documents.optionlabel.1fe300d3:Documents — ${optionLabel(DM_DOCUMENT_SOURCE_OPTIONS, rubric.withheldDocumentSource)}:optionLabel:`;
    case RubricWithheldKind.WithheldOverRate:
      return $localize`:@@accounting.monthly-declaration-config.view-model.ts.non.pris.en.charge.2c0f420c:Non pris en charge`;
    default:
      return '—';
  }
}

/**
 * Une rubrique dont le moteur ne saura rien produire : la ligne restera à 0 et signalée au
 * Calcul DM. Le dire ici évite de le découvrir le jour du dépôt.
 */
export function isRubricUnsupported(rubric: MonthlyDeclarationRubricDto): boolean {
  return rubric.withheldKind === RubricWithheldKind.WithheldOverRate;
}

export function describeApplicability(rubric: MonthlyDeclarationRubricDto): string {
  const from = toDateInputValue(rubric.effectiveFrom);
  const to = toDateInputValue(rubric.effectiveTo);
  if (!from && !to) {
    return $localize`:@@accounting.monthly-declaration-config.view-model.ts.toutes.periodes.fa4932c5:Toutes périodes`;
  }
  if (from && to) {
    return `${from} → ${to}`;
  }
  return from ? $localize`:@@accounting.monthly-declaration-config.view-model.ts.a.partir.du.from.802ed9bb:À partir du ${from}:from:` : $localize`:@@accounting.monthly-declaration-config.view-model.ts.jusqu.au.to.5b249dfe:Jusqu’au ${to}:to:`;
}

// ── Lecture de la configuration ──────────────────────────────────────────────

export function rubricsOfFamily(
  rubrics: readonly MonthlyDeclarationRubricDto[],
  family: MonthlyDeclarationFamily
): MonthlyDeclarationRubricDto[] {
  return rubrics
    .filter(r => r.family === family)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));
}

export function isFamilyIncluded(
  families: readonly MonthlyDeclarationFamilySettingDto[],
  family: MonthlyDeclarationFamily
): boolean {
  return families.find(f => f.family === family)?.isIncluded ?? false;
}

export function countActiveRubrics(
  rubrics: readonly MonthlyDeclarationRubricDto[],
  family: MonthlyDeclarationFamily
): number {
  return rubrics.filter(r => r.family === family && r.isActive).length;
}

/**
 * Une famille incluse sans rubrique active bloque l'enregistrement de la déclaration ; le signaler
 * dès l'onglet évite de livrer un dossier qui refusera son propre dépôt.
 */
export function familyNeedsAttention(
  families: readonly MonthlyDeclarationFamilySettingDto[],
  rubrics: readonly MonthlyDeclarationRubricDto[],
  family: MonthlyDeclarationFamily
): boolean {
  return isFamilyIncluded(families, family) && countActiveRubrics(rubrics, family) === 0;
}

/**
 * La configuration du dossier est-elle modifiable ? Il y faut l'interrupteur serveur ET le catalogue
 * posé : tant qu'il ne l'est pas, le serveur refuse toute écriture, parce qu'une configuration posée
 * à la main serait effacée par la pose réussie juste après. Des réglages pas encore chargés valent
 * « indisponible ». Confort d'affichage seulement — le serveur revérifie à chaque écriture.
 */
export function isConfigurableLinesActive(
  settings: MonthlyDeclarationSettingsDto | null | undefined
): boolean {
  return settings?.enabled === true && settings.catalogApplied === true;
}

/** Ce qui empêche d'écrire, quand quelque chose l'empêche : le drapeau, ou le catalogue. */
export function describeWriteBlocker(
  settings: MonthlyDeclarationSettingsDto | null | undefined
): string | null {
  if (!settings || settings.enabled !== true) return null;
  return settings.catalogApplied === true
    ? null
    : $localize`:@@accounting.monthly-declaration-config.view-model.ts.catalogue.non.pose.e9d41c37:La configuration de ce dossier n'est pas encore initialisée : elle n'est pas modifiable et aucune déclaration ne peut être enregistrée. Rouvrez le dossier dans un instant ; si le message persiste, contactez l'administrateur de la plateforme.`;
}

// ── Sélecteur de comptes ─────────────────────────────────────────────────────

/**
 * Options du sélecteur de comptes. Les comptes inactifs sont écartés : les proposer inviterait à
 * bâtir une rubrique sur un compte que le plan n'alimente plus.
 */
export function accountPickerOptions(chart: readonly ChartOfAccountDto[]): DmOption<string>[] {
  return chart
    .filter(a => a.isActive)
    .slice()
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
    .map(a => ({ label: `${a.accountNumber} — ${a.label}`, value: a.accountNumber }));
}

/** Comptes exacts cités par une rubrique qui ne figurent plus au plan du dossier. */
export function unknownAccountsOf(
  rubric: MonthlyDeclarationRubricDto,
  knownAccountNumbers: ReadonlySet<string>
): string[] {
  return rubric.accounts
    .filter(a => a.matchMode === RubricAccountMatchMode.Exact && !knownAccountNumbers.has(a.accountNumber))
    .map(a => a.accountNumber);
}
