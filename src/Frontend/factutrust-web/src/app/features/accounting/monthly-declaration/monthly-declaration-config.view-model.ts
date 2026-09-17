import {
  AccountBalanceSide,
  ChartOfAccountDto,
  CreateMonthlyDeclarationRubricRequest,
  MonthlyDeclarationFamily,
  MonthlyDeclarationFamilySettingDto,
  MonthlyDeclarationMode,
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
    label: 'Retenue à la source',
    title: 'Retenue à la source',
    hint: 'Articles 1 à 31 du formulaire officiel. Le code rapport porte le numéro d’article (ex. « 17.2 »).'
  },
  {
    family: MonthlyDeclarationFamily.Tfp,
    label: 'T.F.P',
    title: 'Taxe de formation professionnelle',
    hint: 'Assiette et taux repris du cycle de paie du mois, ou des comptes de charges de personnel.'
  },
  {
    family: MonthlyDeclarationFamily.Foprolos,
    label: 'FOPROLOS',
    title: 'Fonds de promotion des logements pour salariés',
    hint: 'Même assiette que la T.F.P dans le cas général.'
  },
  {
    family: MonthlyDeclarationFamily.ConsumptionDuty,
    label: 'Droit de consommation',
    title: 'Droit de consommation',
    hint: 'Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.'
  },
  {
    family: MonthlyDeclarationFamily.Vat,
    label: 'T.V.A',
    title: 'Taxe sur la valeur ajoutée',
    hint: 'Affichée pour mémoire : la T.V.A reste dérivée des factures et du chaînage de crédit, hors moteur paramétré.'
  },
  {
    family: MonthlyDeclarationFamily.OtherTurnoverTaxes,
    label: 'Autres taxes C.A',
    title: 'Autres taxes sur le chiffre d’affaires',
    hint: 'FODEC et assimilées.'
  },
  {
    family: MonthlyDeclarationFamily.StampDuty,
    label: 'Droit de timbre',
    title: 'Droit de timbre',
    hint: 'Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.'
  },
  {
    family: MonthlyDeclarationFamily.HotelTax,
    label: 'Taxe hôtelière',
    title: 'Taxe hôtelière',
    hint: 'Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.'
  },
  {
    family: MonthlyDeclarationFamily.Tcl,
    label: 'T.C.L',
    title: 'Taxe sur les établissements à caractère industriel, commercial ou professionnel',
    hint: 'Typiquement « brut = comptes de produits, sens créditeur » et « retenue = brut × taux ».'
  },
  {
    family: MonthlyDeclarationFamily.LicenceFee,
    label: 'Droit de licence',
    title: 'Droit de licence',
    hint: 'Aucune case de détail cartographiée en 2026 : le montant ne rejoint que le récapitulatif.'
  },
  {
    family: MonthlyDeclarationFamily.OtherInformation,
    label: 'Autres informations',
    title: 'Autres informations',
    hint: 'Déclaratif : achats en suspension, exportations, chiffre d’affaires exonéré… Aucun montant à payer.'
  }
];

export function familyTab(family: MonthlyDeclarationFamily): DmFamilyTab | undefined {
  return DM_FAMILY_TABS.find(t => t.family === family);
}

export function familyLabel(family: MonthlyDeclarationFamily): string {
  return familyTab(family)?.label ?? `Famille ${family}`;
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
  { label: 'Valeur fixe / saisie', value: RubricGrossKind.Fixed },
  { label: 'Valeur de paie', value: RubricGrossKind.Payroll },
  { label: 'Solde de comptes', value: RubricGrossKind.Account },
  { label: 'Retenue ÷ taux', value: RubricGrossKind.WithheldOverRate }
];

export const DM_WITHHELD_KIND_OPTIONS: readonly DmOption<RubricWithheldKind>[] = [
  { label: 'Valeur fixe / saisie', value: RubricWithheldKind.Fixed },
  { label: 'Solde de comptes', value: RubricWithheldKind.Account },
  { label: 'Brut × taux', value: RubricWithheldKind.GrossTimesRate },
  { label: 'Valeur de paie', value: RubricWithheldKind.Payroll },
  { label: 'Retenue ÷ taux (non pris en charge)', value: RubricWithheldKind.WithheldOverRate }
];

export const DM_SIDE_OPTIONS: readonly DmOption<AccountBalanceSide>[] = [
  { label: 'Débiteur', value: AccountBalanceSide.Debit },
  { label: 'Créditeur', value: AccountBalanceSide.Credit }
];

export const DM_PAYROLL_COMPONENT_OPTIONS: readonly DmOption<PayrollContributionComponent>[] = [
  { label: 'Masse salariale brute', value: PayrollContributionComponent.SalariesGrossBase },
  { label: 'Net imposable', value: PayrollContributionComponent.SalariesNetTaxableBase },
  { label: 'Assiette taxes sur salaires', value: PayrollContributionComponent.PayrollTaxBase },
  { label: 'IRPP retenu', value: PayrollContributionComponent.WithholdingIrpp },
  { label: 'CSS retenue', value: PayrollContributionComponent.WithholdingCss },
  { label: 'IRPP + CSS', value: PayrollContributionComponent.WithholdingTotal },
  { label: 'T.F.P du cycle', value: PayrollContributionComponent.Tfp },
  { label: 'FOPROLOS du cycle', value: PayrollContributionComponent.Foprolos }
];

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
    return 'Le code de la rubrique est obligatoire.';
  }
  if (!form.id && !DM_CODE_PATTERN.test(code)) {
    return 'Le code est invalide : lettres majuscules, chiffres et « _ » uniquement, 20 caractères au plus.';
  }
  if (!form.label.trim()) {
    return 'Le libellé est obligatoire.';
  }
  if (form.label.trim().length > 200) {
    return 'Le libellé ne peut pas dépasser 200 caractères.';
  }

  const reportCode = form.reportCode.trim();
  if (!reportCode) {
    return 'Le code rapport est obligatoire.';
  }
  if (reportCode.length > 16 || !DM_REPORT_CODE_PATTERN.test(reportCode)) {
    return 'Le code rapport doit être un numéro d’article (ex. « 17.2 »), ou « * » pour un repli de famille.';
  }

  const rate = Number(form.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return 'Le taux doit être compris entre 0 et 100 %.';
  }

  if (
    form.grossKind === RubricGrossKind.WithheldOverRate &&
    form.withheldKind === RubricWithheldKind.GrossTimesRate
  ) {
    return 'Combinaison impossible : le brut serait déduit de la retenue et la retenue déduite du brut. Fixez l’une des deux colonnes.';
  }
  if (needsRate(form) && rate <= 0) {
    return 'Ce mode de calcul exige un taux strictement positif.';
  }
  if (needsPayrollComponent(form) && form.payrollComponent === null) {
    return 'Un brut issu de la paie doit désigner la valeur du cycle à reprendre.';
  }
  if (needsWithheldPayrollComponent(form) && form.withheldPayrollComponent === null) {
    return 'Une retenue issue de la paie doit désigner la valeur du cycle à reprendre.';
  }

  if (needsGrossAccounts(form) && countSelectedAccounts(form.grossAccounts) === 0) {
    return 'Un montant brut calculé sur comptes exige au moins un compte ou une racine.';
  }
  if (needsWithheldAccounts(form) && countSelectedAccounts(form.withheldAccounts) === 0) {
    return 'Une retenue calculée sur comptes exige au moins un compte ou une racine.';
  }
  if (countSelectedAccounts(form.grossAccounts) > DM_MAX_ACCOUNTS_PER_ROLE) {
    return `La colonne brut ne peut pas retenir plus de ${DM_MAX_ACCOUNTS_PER_ROLE} comptes.`;
  }
  if (countSelectedAccounts(form.withheldAccounts) > DM_MAX_ACCOUNTS_PER_ROLE) {
    return `La colonne retenue ne peut pas retenir plus de ${DM_MAX_ACCOUNTS_PER_ROLE} comptes.`;
  }

  if (form.effectiveFrom && form.effectiveTo && form.effectiveFrom > form.effectiveTo) {
    return 'La date maximale d’application précède la date de début.';
  }

  return null;
}

// ── Lecture d'une rubrique en clair ──────────────────────────────────────────

function sideLabel(side: AccountBalanceSide): string {
  return side === AccountBalanceSide.Debit ? 'débits' : 'crédits';
}

function accountsSummary(
  accounts: readonly MonthlyDeclarationRubricAccountDto[],
  role: RubricAccountRole
): string {
  const ofRole = accounts.filter(a => a.role === role);
  if (ofRole.length === 0) {
    return 'aucun compte';
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
        : `Valeur fixe ${rubric.fixedGrossAmount}`;
    case RubricGrossKind.Payroll:
      return `Paie — ${optionLabel(DM_PAYROLL_COMPONENT_OPTIONS, rubric.payrollComponent)}`;
    case RubricGrossKind.Account:
      return `${sideLabel(rubric.grossSide)} de ${accountsSummary(rubric.accounts, RubricAccountRole.Gross)}`;
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
        : `Valeur fixe ${rubric.fixedWithheldAmount}`;
    case RubricWithheldKind.Account:
      return `${sideLabel(rubric.withheldSide)} de ${accountsSummary(rubric.accounts, RubricAccountRole.Withheld)}`;
    case RubricWithheldKind.GrossTimesRate:
      return `Brut × ${rubric.ratePercent} %`;
    case RubricWithheldKind.Payroll:
      return `Paie — ${optionLabel(DM_PAYROLL_COMPONENT_OPTIONS, rubric.withheldPayrollComponent)}`;
    case RubricWithheldKind.WithheldOverRate:
      return 'Non pris en charge';
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
    return 'Toutes périodes';
  }
  if (from && to) {
    return `${from} → ${to}`;
  }
  return from ? `À partir du ${from}` : `Jusqu’au ${to}`;
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
 * Une famille incluse sans rubrique active bloque l'enregistrement en mode configuré ; le
 * signaler dès l'onglet évite de livrer un dossier qui refusera son propre dépôt.
 */
export function familyNeedsAttention(
  families: readonly MonthlyDeclarationFamilySettingDto[],
  rubrics: readonly MonthlyDeclarationRubricDto[],
  family: MonthlyDeclarationFamily
): boolean {
  return isFamilyIncluded(families, family) && countActiveRubrics(rubrics, family) === 0;
}

export function modeLabel(mode: MonthlyDeclarationMode): string {
  switch (mode) {
    case MonthlyDeclarationMode.Legacy:
      return 'Calcul historique';
    case MonthlyDeclarationMode.Parity:
      return 'Contrôle de parité';
    case MonthlyDeclarationMode.Configured:
      return 'Calcul paramétré';
    default:
      return 'Inconnu';
  }
}

/** Phrase d'état affichée sous le titre : ce que le dossier calcule aujourd'hui, et pourquoi. */
export function describeMode(settings: MonthlyDeclarationSettingsDto): string {
  switch (settings.mode) {
    case MonthlyDeclarationMode.Legacy:
      return 'La déclaration est produite par le calcul historique. La configuration du dossier est enregistrée mais ne déplace aucun montant.';
    case MonthlyDeclarationMode.Parity:
      return `Les deux calculs tournent ; les montants déclarés restent ceux du calcul historique. ${settings.parityCleanStreak} période(s) sans écart sur les ${settings.requiredCleanParityPeriods} requises.`;
    case MonthlyDeclarationMode.Configured:
      return settings.configuredSince
        ? `Le calcul paramétré fait foi depuis le ${toDateInputValue(settings.configuredSince)}.`
        : 'Le calcul paramétré fait foi.';
    default:
      return '';
  }
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
