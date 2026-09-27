import { VatDeclarationDto } from '../services/accounting.service';
import { Company } from '@core/services/company.service';
import { User } from '@core/services/auth.service';

export type VatExtrasKey = 'fodec' | 'droitTimbre' | 'tcl' | 'tfp' | 'foprolos' | 'withholdingTax' | 'acomptes';

export interface CompanyDisplayInfo {
  companyName: string;
  nif: string | null;
  taxRegimeDisplay: string | null;
  tradeName: string | null;
}

export interface VatDeclarationExtras {
  fodec: number;
  droitTimbre: number;
  tcl: number;
  tfp: number;
  foprolos: number;
  withholdingTax: number;
  acomptes: number;
}

export interface VatTaxTableRow {
  taxLabel: string;
  taxableBase: number | null;
  ratePercent: number | null;
  amountToPay: number | null;
  deductibleAmount: number | null;
  netAmount: number | null;
  highlight?: boolean;
  bold?: boolean;
  editableKey?: VatExtrasKey;
  /**
   * Montant que les modules produiraient aujourd'hui pour cette ligne, tel que calculé par le
   * backend. Unique source de la suggestion : la recalculer ici à partir de « base × taux »
   * donnerait un second chiffre, forcément divergent dès que les deux ne lisent pas la même
   * donnée — c'était le cas du FODEC.
   */
  suggestedAmount?: number | null;
}

/** Une ligne dont le montant déclaré s'écarte de ce que les modules produiraient. */
export interface VatDivergenceRow {
  label: string;
  declared: number;
  computed: number;
}

export interface VatDocLinkRow {
  label: string;
  route: string;
  queryParams?: Record<string, string>;
  status: 'ok' | 'neutral' | 'warning';
  statusLabel: string;
}

export interface VatChartSegment {
  label: string;
  value: number;
}

const MONTH_NAMES_FR = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export function formatPeriodLabel(year: number, month: number): string {
  const name = month >= 1 && month <= 12 ? MONTH_NAMES_FR[month] : String(month);
  return `${name} ${year}`;
}

export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function periodDateRange(year: number, month: number): { from: string; to: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(start), to: fmt(end) };
}

export function computeTotalToPay(d: VatDeclarationDto, extras: VatDeclarationExtras): number {
  const total = d.vatDue + extras.fodec + extras.droitTimbre + extras.tcl + extras.tfp
    + extras.foprolos + extras.withholdingTax - extras.acomptes;
  return Math.max(0, total);
}

export function computeTotalCollected(d: VatDeclarationDto): number {
  return d.collectedVat19 + d.collectedVat13 + d.collectedVat7;
}

export function computeTotalDeductible(d: VatDeclarationDto): number {
  return d.deductibleVatGoods + d.deductibleVatAssets;
}

export function statusLabel(status: number): string {
  switch (status) {
    case 1: return 'Soumise';
    case 2: return $localize`:@@accounting.vat-declaration.view-model.ts.verrouillee.af142775:Verrouillée`;
    default: return 'Brouillon';
  }
}

/**
 * Une déclaration n'est soumettable que si elle est au statut Brouillon (0). Une déclaration
 * déjà soumise (1) ou verrouillée (2) se corrige via « Rectificative », pas par re-soumission.
 */
export function canSubmitDeclaration(status: number): boolean {
  return status === 0;
}

/** Statuts visibles pour la société (Soumise / Verrouillée). */
export function isSubmittedOrLocked(status: number): boolean {
  return status === 1 || status === 2;
}

export function statusClass(status: number): string {
  switch (status) {
    case 1: return 'vat-status--submitted';
    case 2: return 'vat-status--locked';
    default: return 'vat-status--draft';
  }
}

export function clampExtrasValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Arrondi comptable à 3 décimales (millimes), aligné sur l'arrondi backend des taxes. */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Valeur suggérée = base × taux%/100, arrondie au millime ; null si base ou taux absent.
 *
 * Conservée pour l'affichage pédagogique du couple « base × taux » à l'écran. Elle ne sert
 * <b>plus</b> à produire la suggestion d'une ligne : celle-ci vient du backend, seul à connaître
 * la source réelle de chaque taxe.
 */
export function suggestedTaxAmount(base: number | null | undefined, ratePercent: number | null | undefined): number | null {
  if (base == null || ratePercent == null) return null;
  return round3(base * (ratePercent / 100));
}

/**
 * Écarts entre les montants déposés et le recalcul temps réel des modules.
 *
 * Vide tant qu'aucune déclaration n'a été enregistrée : les deux jeux de valeurs sont alors
 * identiques par construction.
 */
export function buildDivergenceRows(d: VatDeclarationDto): VatDivergenceRow[] {
  const s = d.suggested;
  if (!s || !d.monthlyDeclarationV2Enabled) return [];

  const candidates: VatDivergenceRow[] = [
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.collectee.19.4fb0b2e4:TVA collectée 19 %`, declared: d.collectedVat19, computed: s.collectedVat19 },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.collectee.13.4a1e8169:TVA collectée 13 %`, declared: d.collectedVat13, computed: s.collectedVat13 },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.collectee.7.f619e8c4:TVA collectée 7 %`, declared: d.collectedVat7, computed: s.collectedVat7 },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.deductible.biens.et.services.1af09997:TVA déductible — biens et services`, declared: d.deductibleVatGoods, computed: s.deductibleVatGoods },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.deductible.immobilisations.4bb099e3:TVA déductible — immobilisations`, declared: d.deductibleVatAssets, computed: s.deductibleVatAssets },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.credit.anterieur.cd16b0d7:Crédit antérieur`, declared: d.previousCredit, computed: s.previousCredit },
    { label: 'FODEC', declared: d.fodec, computed: s.fodec },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.droit.de.timbre.01f26054:Droit de timbre`, declared: d.droitTimbre, computed: s.droitTimbre },
    { label: 'TCL', declared: d.tcl, computed: s.tcl },
    { label: 'TFP', declared: d.tfp, computed: s.tfp },
    { label: 'FOPROLOS', declared: d.foprolos, computed: s.foprolos },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.retenues.a.la.source.rs.04dda5ef:Retenues à la source (RS)`, declared: d.withholdingTax, computed: s.withholdingTax }
  ];

  return candidates.filter(r => hasSuggestionMismatch(r.declared, r.computed));
}

/**
 * Message expliquant l'état du cycle de paie du mois, ou `null` s'il n'y a rien à signaler.
 * Un cycle non validé est la cause la plus fréquente d'une TFP et d'un FOPROLOS à zéro.
 */
export function payrollHint(d: VatDeclarationDto): string | null {
  const s = d.suggested;
  if (!s || !d.monthlyDeclarationV2Enabled) return null;

  if (!s.payrollRunExists)
    return $localize`:@@accounting.vat-declaration.view-model.ts.aucun.cycle.de.paie.pour.cette.periode.l.e1691c85:Aucun cycle de paie pour cette période : la TFP et le FOPROLOS restent à saisir manuellement.`;

  if (!s.payrollRunUsable) {
    return $localize`:@@accounting.vat-declaration.view-model.ts.le.cycle.de.paie.de.la.periode.est.au.st.81b23f76:Le cycle de paie de la période est au statut « ${s.payrollRunStatusDisplay ?? 'Brouillon'}:p: » : ses montants TFP et FOPROLOS ne sont pas repris. Validez le cycle pour les intégrer.`;
  }

  return null;
}

/** Écart significatif (> 0,001) entre le montant saisi et la valeur suggérée Base × Taux. */
export function hasSuggestionMismatch(amount: number | null | undefined, suggested: number | null | undefined): boolean {
  if (amount == null || suggested == null) return false;
  return Math.abs(amount - suggested) > 0.001;
}

export function shiftPeriod(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function buildTaxRows(
  d: VatDeclarationDto,
  extras: VatDeclarationExtras,
  totalToPay: number,
  fodecRatePercent = 1,
  tclRatePercent = 0.2
): VatTaxTableRow[] {
  const rows: VatTaxTableRow[] = [];

  for (const rate of [19, 13, 7]) {
    const breakdown = d.collectedVatBreakdown?.find(r => r.ratePercent === rate);
    const vat = rate === 19 ? d.collectedVat19 : rate === 13 ? d.collectedVat13 : d.collectedVat7;
    rows.push({
      taxLabel: `TVA collectée ${rate} %`,
      taxableBase: breakdown?.taxableBase ?? null,
      ratePercent: rate,
      amountToPay: vat,
      deductibleAmount: null,
      netAmount: vat
    });
  }

  rows.push({
    taxLabel: 'TVA déductible — biens et services',
    taxableBase: d.deductiblePurchasesTaxableBase ?? null,
    ratePercent: null,
    amountToPay: null,
    deductibleAmount: d.deductibleVatGoods,
    netAmount: null
  });

  rows.push({
    taxLabel: 'TVA déductible — immobilisations',
    taxableBase: null,
    ratePercent: null,
    amountToPay: null,
    deductibleAmount: d.deductibleVatAssets,
    netAmount: null
  });

  rows.push({
    taxLabel: 'Crédit antérieur',
    taxableBase: null,
    ratePercent: null,
    amountToPay: null,
    deductibleAmount: d.previousCredit,
    netAmount: null
  });

  rows.push({
    taxLabel: 'TVA due',
    taxableBase: null,
    ratePercent: null,
    amountToPay: d.vatDue,
    deductibleAmount: null,
    netAmount: d.vatDue,
    highlight: true,
    bold: true
  });

  // Quand la TVA déductible dépasse la TVA collectée, la TVA due est nulle et le solde est un
  // crédit reporté sur la période suivante : le rendre visible à l'écran (jusqu'ici seul le PDF le montrait).
  if (d.creditToCarry > 0) {
    rows.push({
      taxLabel: 'Crédit de TVA à reporter',
      taxableBase: null,
      ratePercent: null,
      amountToPay: null,
      deductibleAmount: d.creditToCarry,
      netAmount: null
    });
  }

  if (d.monthlyDeclarationV2Enabled) {
    // La suggestion vient du backend : c'est le montant qu'il préremplirait, donc exactement ce
    // que « Aligner » doit poser. Absente (backend antérieur), la ligne n'affiche pas d'écart.
    const s = d.suggested;

    rows.push({
      taxLabel: 'FODEC',
      taxableBase: d.fodecTaxableBase ?? d.salesTaxableBase,
      ratePercent: fodecRatePercent,
      amountToPay: extras.fodec,
      deductibleAmount: null,
      netAmount: extras.fodec,
      editableKey: 'fodec',
      suggestedAmount: s?.fodec ?? null
    });
    rows.push({
      taxLabel: 'Droit de timbre',
      taxableBase: null,
      ratePercent: null,
      amountToPay: extras.droitTimbre,
      deductibleAmount: null,
      netAmount: extras.droitTimbre,
      editableKey: 'droitTimbre',
      suggestedAmount: s?.droitTimbre ?? null
    });
    rows.push({
      taxLabel: 'TCL',
      taxableBase: d.salesGrossBase,
      ratePercent: tclRatePercent,
      amountToPay: extras.tcl,
      deductibleAmount: null,
      netAmount: extras.tcl,
      editableKey: 'tcl',
      suggestedAmount: s?.tcl ?? null
    });
    // TFP et FOPROLOS portent désormais leur assiette réelle (masse salariale) et leur taux,
    // issus du cycle de paie : la ligne devient vérifiable au lieu d'afficher « — ».
    rows.push({
      taxLabel: 'TFP',
      taxableBase: d.payrollTaxBase || null,
      ratePercent: d.tfpRatePercent || null,
      amountToPay: extras.tfp,
      deductibleAmount: null,
      netAmount: extras.tfp,
      editableKey: 'tfp',
      suggestedAmount: s?.tfp ?? null
    });
    rows.push({
      taxLabel: 'FOPROLOS',
      taxableBase: d.payrollTaxBase || null,
      ratePercent: d.foprolosRatePercent || null,
      amountToPay: extras.foprolos,
      deductibleAmount: null,
      netAmount: extras.foprolos,
      editableKey: 'foprolos',
      suggestedAmount: s?.foprolos ?? null
    });
    rows.push({
      taxLabel: 'Retenues à la source (RS)',
      taxableBase: null,
      ratePercent: null,
      amountToPay: extras.withholdingTax,
      deductibleAmount: null,
      netAmount: extras.withholdingTax,
      highlight: true,
      editableKey: 'withholdingTax',
      suggestedAmount: s?.withholdingTax ?? null
    });
    rows.push({
      taxLabel: 'Acomptes provisionnels (déduits)',
      taxableBase: null,
      ratePercent: null,
      amountToPay: null,
      deductibleAmount: extras.acomptes,
      netAmount: extras.acomptes > 0 ? -extras.acomptes : 0,
      editableKey: 'acomptes'
    });
  }

  rows.push({
    taxLabel: 'TOTAL À PAYER',
    taxableBase: null,
    ratePercent: null,
    amountToPay: null,
    deductibleAmount: null,
    netAmount: totalToPay,
    bold: true,
    highlight: true
  });

  return rows;
}

export function buildChartSegments(
  d: VatDeclarationDto,
  extras: VatDeclarationExtras,
  totalToPay: number
): VatChartSegment[] {
  if (!d.monthlyDeclarationV2Enabled) {
    return [{ label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.due.dcfce644:TVA due`, value: d.vatDue }];
  }
  const segments: VatChartSegment[] = [
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.tva.due.dcfce644:TVA due`, value: d.vatDue },
    { label: 'FODEC', value: extras.fodec },
    { label: $localize`:@@accounting.vat-declaration.view-model.ts.droit.de.timbre.01f26054:Droit de timbre`, value: extras.droitTimbre },
    { label: 'TCL', value: extras.tcl },
    { label: 'TFP', value: extras.tfp },
    { label: 'FOPROLOS', value: extras.foprolos },
    { label: 'RS', value: extras.withholdingTax }
  ];
  return segments.filter(s => s.value > 0).length > 0
    ? segments.filter(s => s.value > 0)
    : [{ label: $localize`:@@accounting.vat-declaration.view-model.ts.total.b25928c6:Total`, value: totalToPay }];
}

export function buildDocLinks(d: VatDeclarationDto, year: number, month: number): VatDocLinkRow[] {
  const range = periodDateRange(year, month);
  const totalCollected = computeTotalCollected(d);
  const hasPurchases = (d.deductiblePurchasesTaxableBase ?? 0) > 0 || d.deductibleVatGoods > 0;

  return [
    {
      label: $localize`:@@accounting.vat-declaration.view-model.ts.journal.des.ventes.923d6129:Journal des ventes`,
      route: '/accounting/journal',
      queryParams: { from: range.from, to: range.to },
      status: totalCollected > 0 ? 'ok' : 'neutral',
      statusLabel: totalCollected > 0 ? 'OK' : '—'
    },
    {
      label: $localize`:@@accounting.vat-declaration.view-model.ts.journal.des.achats.c6758504:Journal des achats`,
      route: '/accounting/journal',
      queryParams: { from: range.from, to: range.to },
      status: hasPurchases ? 'ok' : 'neutral',
      statusLabel: hasPurchases ? 'OK' : '—'
    },
    {
      label: $localize`:@@accounting.vat-declaration.view-model.ts.retenues.a.la.source.d52de9c1:Retenues à la source`,
      route: '/withholding-tax',
      status: d.withholdingTax > 0 ? 'ok' : 'neutral',
      statusLabel: d.withholdingTax > 0 ? 'OK' : '—'
    },
    {
      label: $localize`:@@accounting.vat-declaration.view-model.ts.echeancier.fiscal.193d9cef:Échéancier fiscal`,
      route: '/accounting/fiscal-schedule',
      queryParams: { fiscalYear: String(year), periodMonth: String(month) },
      status: d.status === 1 ? 'ok' : 'neutral',
      statusLabel: d.status === 1 ? 'Déposée' : 'À suivre'
    },
    {
      label: $localize`:@@accounting.vat-declaration.view-model.ts.controles.de.pre.cloture.e6b9bc87:Contrôles de pré-clôture`,
      route: '/accounting/pre-closing',
      status: 'neutral',
      statusLabel: 'Info'
    }
  ];
}

export function shouldShowFilingAlert(d: VatDeclarationDto): boolean {
  if (!d.filingDeadline) return false;
  const deadline = new Date(d.filingDeadline);
  if (Number.isNaN(deadline.getTime())) return false;
  if (d.status === 1 || d.status === 2) {
    return deadline.getTime() >= Date.now();
  }
  return true;
}

export function buildCompanyFromAuth(auth: User | null): CompanyDisplayInfo {
  return {
    companyName: auth?.contextCompanyName ?? auth?.companyName ?? '—',
    nif: null,
    taxRegimeDisplay: null,
    tradeName: null
  };
}

/** Priorité : DTO TVA → company settings → contexte auth. */
export function resolveCompanyDisplay(
  d: VatDeclarationDto | null,
  company: Company | null,
  auth: User | null
): CompanyDisplayInfo {
  if (d?.companyName) {
    return {
      companyName: d.companyName,
      nif: d.nif ?? null,
      taxRegimeDisplay: d.taxRegimeDisplay ?? null,
      tradeName: d.tradeName ?? null
    };
  }
  if (company) {
    return {
      companyName: company.companyName,
      nif: company.nif,
      taxRegimeDisplay: company.taxRegimeDisplay,
      tradeName: company.tradeName
    };
  }
  return buildCompanyFromAuth(auth);
}
