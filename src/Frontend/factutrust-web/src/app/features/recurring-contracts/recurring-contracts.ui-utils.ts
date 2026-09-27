import { StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import {
  BillingFrequency,
  BillingRunStatus,
  ImportUsageRecordRow,
  RecurringContractDetail,
  RecurringContractLinePayload,
  RecurringContractLineType,
  RecurringContractStatus,
  ScheduleEntryStatus,
  UpsertRecurringContractPayload
} from '@core/services/recurring-contract.service';

/**
 * Mappings statuts → app-status-badge, centralisés pour tout le module Contrats récurrents.
 * `app-status-badge` n'est PAS étendu (risque de régression globale) : on mappe sur les
 * statuts existants et on force toujours `[label]` (statusDisplay fourni par l'API).
 */

export function contractBadgeStatus(s: RecurringContractStatus): StatusBadgeStatus {
  switch (s) {
    case 'Draft': return 'draft';
    case 'Active': return 'active';
    case 'Suspended': return 'pending';     // rendu orange « en attente », label forcé
    case 'Cancelled': return 'cancelled';
    case 'Expired': return 'overdue';       // rendu rouge « attention », label forcé
  }
}

export function contractStatusLabel(s: RecurringContractStatus, display?: string | null): string {
  return display ?? ({
    Draft: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.brouillon.57d2d7a7:Brouillon`,
    Active: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.actif.2eb75f84:Actif`,
    Suspended: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.suspendu.e9a8be4e:Suspendu`,
    Cancelled: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.resilie.3578b2e9:Résilié`,
    Expired: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.expire.57dde607:Expiré`
  } as const)[s];
}

export function runBadgeStatus(s: BillingRunStatus): StatusBadgeStatus {
  switch (s) {
    case 'Pending': return 'pending';
    case 'DraftCreated': return 'draft';
    case 'Invoiced': return 'paid';
    case 'Failed': return 'overdue';
    case 'Skipped': return 'inactive';
  }
}

export function scheduleBadgeStatus(s: ScheduleEntryStatus): StatusBadgeStatus {
  switch (s) {
    case 'Upcoming': return 'pending';
    case 'DraftGenerated': return 'draft';
    case 'Invoiced': return 'paid';
    case 'Overdue': return 'overdue';
    case 'Failed': return 'overdue';
    case 'Skipped': return 'inactive';
  }
}

/**
 * Statuts facture (endpoint linked-invoices) → badge. Les statuts du module invoices
 * existent déjà dans StatusBadgeStatus ; on rabat l'inconnu sur 'pending'.
 */
export function invoiceBadgeStatus(status: string): StatusBadgeStatus {
  const known: StatusBadgeStatus[] = [
    'paid', 'partial', 'pending', 'overdue', 'draft', 'sent', 'cancelled',
    'validated', 'signed', 'accepted', 'rejected', 'expired', 'converted', 'active', 'inactive'
  ];
  const lowered = (status ?? '').toLowerCase() as StatusBadgeStatus;
  return known.includes(lowered) ? lowered : 'pending';
}

/** Formatage montant calculé en TS (KPI, tooltips) — convention client-detail. */
const AMOUNT_FORMATTER = new Intl.NumberFormat('fr-TN', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3
});

export function formatContractAmount(value: number | null | undefined, currency = 'TND'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${AMOUNT_FORMATTER.format(value)} ${currency}`;
}

/** Forme minimale d'une ligne éditable (détail API ou ligne de formulaire local). */
export interface ContractLinePayloadSource {
  id?: string | null;
  lineType: RecurringContractLineType;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  usageMetricId?: string | null;
  includedQuantity?: number | null;
  overageUnitPriceHT?: number | null;
}

/**
 * Mapping lignes → payload d'upsert. Factorisé entre le formulaire et le dialog d'avenant :
 * tout champ oublié ici serait une perte de données de la même classe que le bug B3.
 * Les champs usage* sont normalisés à null pour les types de ligne non concernés.
 */
export function toLinePayloads(lines: ContractLinePayloadSource[]): RecurringContractLinePayload[] {
  return lines.map((l, i) => ({
    id: l.id ?? null,
    lineType: l.lineType,
    productId: l.productId ?? null,
    description: (l.description ?? '').trim(),
    quantity: l.quantity,
    unitPriceHT: l.unitPriceHT,
    vatRate: l.vatRate,
    usageMetricId: l.lineType === 'UsageMetered' ? (l.usageMetricId ?? null) : null,
    includedQuantity: l.lineType === 'UsageMetered' ? (l.includedQuantity ?? null) : null,
    overageUnitPriceHT: l.lineType === 'UsageMetered' ? (l.overageUnitPriceHT ?? null) : null,
    sortOrder: i
  }));
}

/**
 * Σ des lignes « récurrent fixe » ramenée au mois selon la périodicité (÷3 trimestriel,
 * ÷12 annuel). Partagée entre le formulaire (estimation live) et la VM de détail (repli local).
 */
/**
 * Ramène le HT d'une échéance (brouillon) au mois selon la périodicité du contrat.
 * Distinct de {@link fixedLinesMonthlyEstimate} : ici on n'a plus de type de ligne contrat.
 */
export function periodAmountMonthlyEstimate(amountHT: number, frequency: BillingFrequency): number {
  const divisor = frequency === 'Quarterly' ? 3 : frequency === 'Annual' ? 12 : 1;
  return (amountHT || 0) / divisor;
}

export function fixedLinesMonthlyEstimate(
  lines: ReadonlyArray<Pick<ContractLinePayloadSource, 'lineType' | 'quantity' | 'unitPriceHT'> & { isActive?: boolean | null }>,
  frequency: BillingFrequency
): number {
  const divisor = frequency === 'Quarterly' ? 3 : frequency === 'Annual' ? 12 : 1;
  // isActive !== false : les lignes clôturées par un avenant (fenêtre d'effet terminée)
  // ne doivent pas entrer dans l'estimation ; les lignes de formulaire n'ont pas ce champ.
  return lines
    .filter(l => l.lineType === 'FixedRecurring' && l.isActive !== false)
    .reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPriceHT || 0), 0) / divisor;
}

/**
 * Payload d'upsert complet reconstruit depuis le détail courant (utilisé par l'avenant de
 * lignes sur contrat actif : `updatedContract` repart toujours de l'état connu, jamais de
 * valeurs codées en dur).
 */
export function toUpsertPayload(
  detail: RecurringContractDetail,
  lines: RecurringContractLinePayload[]
): UpsertRecurringContractPayload {
  return {
    clientId: detail.clientId,
    billingFrequency: detail.billingFrequency,
    billingDayOfMonth: detail.billingDayOfMonth,
    startDate: detail.startDate.slice(0, 10),
    endDate: detail.endDate?.slice(0, 10) ?? null,
    autoRenew: detail.autoRenew,
    noticePeriodDays: detail.noticePeriodDays,
    paymentTermTemplateId: detail.paymentTermTemplateId ?? null,
    sourceQuoteId: detail.sourceQuoteId ?? null,
    reference: detail.reference ?? null,
    notes: detail.notes ?? null,
    lines
  };
}

// ---- Import CSV des consommations (onglet Services) ----

export interface UsageCsvParseResult {
  rows: ImportUsageRecordRow[];
  /** Message d'erreur avec n° de ligne (1-based) — null si tout est valide. */
  error: string | null;
}

/** Date ISO « yyyy-MM-dd » ou française « dd/MM/yyyy » → ISO. null si invalide. */
export function parseUsageCsvDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (iso.test(raw)) return raw;
  const mFr = raw.match(fr);
  if (mFr) return `${mFr[3]}-${mFr[2]}-${mFr[1]}`;
  return null;
}

/**
 * Parse un CSV « metricCode;periodFrom;periodTo;quantity;notes » (séparateur « ; »,
 * en-tête tolérée, quantité au séparateur décimal « , » ou « . »).
 * Ne jette jamais : toute ligne fautive est rapportée dans `error`.
 */
export function parseUsageRecordsCsv(text: string): UsageCsvParseResult {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const rows: ImportUsageRecordRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(';').map(c => c.trim());
    const quantity = Number(cells[3]?.replace(',', '.'));
    // En-tête tolérée : première ligne à quantité non numérique ET dates non parsables
    // (sinon une vraie ligne fautive en tête serait silencieusement ignorée).
    const looksLikeHeader =
      Number.isNaN(quantity) &&
      (!parseUsageCsvDate(cells[1] ?? '') || !parseUsageCsvDate(cells[2] ?? ''));
    if (i === 0 && looksLikeHeader) continue;

    if (cells.length < 4) {
      return { rows: [], error: `Ligne ${i + 1} : 4 colonnes minimum attendues (metricCode;du;au;quantité).` };
    }
    const [metricCode, rawFrom, rawTo] = cells;
    const periodFrom = parseUsageCsvDate(rawFrom);
    const periodTo = parseUsageCsvDate(rawTo);
    if (!metricCode) return { rows: [], error: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.ligne.p.code.metrique.manquant.b12247a3:Ligne ${i + 1}:p: : code métrique manquant.` };
    if (!periodFrom || !periodTo) {
      return { rows: [], error: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.ligne.p.dates.invalides.attendu.yyyy.mm.e2597064:Ligne ${i + 1}:p: : dates invalides (attendu yyyy-MM-dd ou jj/MM/aaaa).` };
    }
    if (Number.isNaN(quantity) || quantity <= 0) {
      return { rows: [], error: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.ligne.p.quantite.invalide.p1.1481b217:Ligne ${i + 1}:p: : quantité invalide (« ${cells[3]}:p1: »).` };
    }
    rows.push({ metricCode, periodFrom, periodTo, quantity, notes: cells[4] || null });
  }

  if (rows.length === 0) return { rows: [], error: $localize`:@@recurring-contracts.recurring-contracts.ui-utils.ts.le.fichier.ne.contient.aucune.ligne.expl.9130bf5b:Le fichier ne contient aucune ligne exploitable.` };
  return { rows, error: null };
}
