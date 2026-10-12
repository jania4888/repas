/**
 * Single source of truth for invoice metric computations (status classification,
 * realized-revenue rules, period bounds) shared by the dashboard and the analytics
 * reports. Centralizing this logic prevents the surfaces from drifting apart.
 *
 * The invoice list API serializes status via InvoiceStatus.ToDisplayString() (French
 * labels: "Payée", "Validée", "Signée", "Partiellement payée"…). This normalizer also
 * accepts the numeric enum and English keys so callers never depend on a fragile,
 * exact-case string comparison.
 */

/** Mirrors FactuTrust.Domain.Enums.InvoiceStatus (numeric values must match the backend). */
export enum InvoiceStatusKey {
  Draft = 0,
  Validated = 1,
  Signed = 2,
  Paid = 4,
  PartiallyPaid = 5,
  Overdue = 6,
  Cancelled = 7,
  Archived = 8
}

export type RevenuePeriod = 'day' | 'month' | 'year' | 'all';

export interface PeriodRange {
  currentFrom: Date;
  currentTo: Date;
  previousFrom: Date;
  previousTo: Date;
}

/** Minimal shape needed to compute revenue — keeps this util decoupled from service models. */
export interface RevenueInvoiceLike {
  status: string | number | null | undefined;
  issueDate: string | Date;
  /** Signed total (TTC): positive on FAC, negative on AVO (credit notes). */
  totalAmount: number;
  /**
   * Signed HT (excl. VAT, FODEC and stamp duty), net of global discount: positive on FAC,
   * negative on AVO. Source of every revenue (chiffre d'affaires) figure.
   */
  subTotal?: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses an invoice issue date as a local calendar instant.
 * Date-only `YYYY-MM-DD` strings are treated as local midnight (not UTC, unlike `new Date(string)`).
 */
export function parseIssueDateLocal(issueDate: string | Date): Date | null {
  if (issueDate instanceof Date) {
    return Number.isNaN(issueDate.getTime()) ? null : new Date(issueDate.getTime());
  }
  if (typeof issueDate !== 'string' || !issueDate.trim()) {
    return null;
  }
  const trimmed = issueDate.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const parsed = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formats a date as `YYYY-MM-DD` using local calendar fields (for backend date params). */
export function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Signed HT amount of a document, used for every revenue (CA) figure.
 * Returns 0 when `subTotal` is missing or not finite — never falls back to the TTC
 * `totalAmount`, which would silently mix HT and TTC.
 */
export function revenueAmountHt(invoice: Pick<RevenueInvoiceLike, 'subTotal'>): number {
  const value = invoice.subTotal;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

const STATUS_TOKEN_MAP: Record<string, InvoiceStatusKey> = {
  // French display labels (primary transport, via ToDisplayString)
  brouillon: InvoiceStatusKey.Draft,
  validee: InvoiceStatusKey.Validated,
  signee: InvoiceStatusKey.Signed,
  payee: InvoiceStatusKey.Paid,
  'partiellement payee': InvoiceStatusKey.PartiallyPaid,
  'en retard': InvoiceStatusKey.Overdue,
  annulee: InvoiceStatusKey.Cancelled,
  archivee: InvoiceStatusKey.Archived,
  // English keys (defensive: other DTOs / future transports)
  draft: InvoiceStatusKey.Draft,
  validated: InvoiceStatusKey.Validated,
  signed: InvoiceStatusKey.Signed,
  paid: InvoiceStatusKey.Paid,
  partiallypaid: InvoiceStatusKey.PartiallyPaid,
  'partially paid': InvoiceStatusKey.PartiallyPaid,
  overdue: InvoiceStatusKey.Overdue,
  cancelled: InvoiceStatusKey.Cancelled,
  canceled: InvoiceStatusKey.Cancelled,
  archived: InvoiceStatusKey.Archived
};

/**
 * Normalizes an invoice status (numeric enum, French label, or English key) to a
 * stable {@link InvoiceStatusKey}. Returns null for unrecognized values.
 */
export function normalizeInvoiceStatus(
  status: string | number | null | undefined
): InvoiceStatusKey | null {
  if (status === null || status === undefined) {
    return null;
  }
  if (typeof status === 'number') {
    return status in InvoiceStatusKey ? (status as InvoiceStatusKey) : null;
  }
  const token = stripDiacritics(status).toLowerCase().trim().replace(/\s+/g, ' ');
  return STATUS_TOKEN_MAP[token] ?? null;
}

/** Statuses that count toward realized revenue (chiffre d'affaires): Payée + Validée. */
export const REALIZED_REVENUE_STATUSES: ReadonlyArray<InvoiceStatusKey> = [
  InvoiceStatusKey.Paid,
  InvoiceStatusKey.Validated
];

/** True when an invoice's amount counts as realized revenue (Payée or Validée). */
export function isRealizedRevenue(status: string | number | null | undefined): boolean {
  const key = normalizeInvoiceStatus(status);
  return key === InvoiceStatusKey.Paid || key === InvoiceStatusKey.Validated;
}

/**
 * True when an invoice is unpaid, matching the backend `unpaidOnly` filter
 * (Status != Paid && Status != Cancelled). Notably includes "Partiellement payée".
 */
export function isUnpaidInvoice(status: string | number | null | undefined): boolean {
  const key = normalizeInvoiceStatus(status);
  return key !== null && key !== InvoiceStatusKey.Paid && key !== InvoiceStatusKey.Cancelled;
}

/**
 * Canonical date bounds for a reporting period. Mirrors the analytics service ranges
 * for day/month/year and adds 'all' (from the epoch to end of today, no prior period).
 */
export function getPeriodRange(period: RevenuePeriod, now: Date = new Date()): PeriodRange {
  if (period === 'day') {
    const currentFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const yest = new Date(currentFrom);
    yest.setDate(yest.getDate() - 1);
    return {
      currentFrom,
      currentTo,
      previousFrom: new Date(yest.getFullYear(), yest.getMonth(), yest.getDate()),
      previousTo: new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59)
    };
  }

  if (period === 'month') {
    return {
      currentFrom: new Date(now.getFullYear(), now.getMonth(), 1),
      currentTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
      previousFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      previousTo: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    };
  }

  if (period === 'year') {
    return {
      currentFrom: new Date(now.getFullYear(), 0, 1),
      currentTo: new Date(now.getFullYear(), 11, 31, 23, 59, 59),
      previousFrom: new Date(now.getFullYear() - 1, 0, 1),
      previousTo: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59)
    };
  }

  // 'all' — cumulative from the epoch to the end of today; no comparable prior period.
  return {
    currentFrom: new Date(0),
    currentTo: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59),
    previousFrom: new Date(0),
    previousTo: new Date(0)
  };
}

/** True when a date falls within [from, to] (inclusive). */
export function isWithinRange(date: Date, from: Date, to: Date): boolean {
  return date >= from && date <= to;
}

/**
 * Sums realized-revenue (Payée + Validée) TTC totals, optionally restricted to a date range.
 * Signed `totalAmount` is preserved, so credit notes (negative) correctly reduce the total.
 *
 * TTC — kept for backward compatibility. Do NOT use it for revenue (CA) figures:
 * use {@link sumRealizedRevenueHt}.
 */
export function sumRealizedRevenue(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  range?: { from: Date; to: Date }
): number {
  return invoices.reduce((sum, inv) => {
    if (!isRealizedRevenue(inv.status)) {
      return sum;
    }
    if (range) {
      const d = new Date(inv.issueDate);
      if (d < range.from || d > range.to) {
        return sum;
      }
    }
    return sum + inv.totalAmount;
  }, 0);
}

/**
 * Sums the signed HT (see {@link revenueAmountHt}) of realized-revenue documents
 * (Payée + Validée, invoices and credit notes), optionally restricted to an inclusive
 * date range. Issue dates are parsed as local calendar dates.
 */
export function sumRealizedRevenueHt(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  range?: { from: Date; to: Date }
): number {
  return invoices.reduce((sum, inv) => {
    if (!isRealizedRevenue(inv.status)) {
      return sum;
    }
    if (range) {
      const d = parseIssueDateLocal(inv.issueDate);
      if (!d || !isWithinRange(d, range.from, range.to)) {
        return sum;
      }
    }
    return sum + revenueAmountHt(inv);
  }, 0);
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MonthToDateRanges {
  /** 1st of the current month 00:00:00.000 → today 23:59:59.999. */
  current: DateRange;
  /**
   * 1st of the previous month 00:00:00.000 → same day-of-month of the previous month
   * (capped to its last day) 23:59:59.999.
   */
  previous: DateRange;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Month-to-date range (1st → today) and the comparable range of the previous month
 * (same number of elapsed days, capped to the previous month's last day so that
 * e.g. March 31 compares with February 1 → 28/29 and never overflows into March).
 */
export function getMonthToDateRange(now: Date = new Date()): MonthToDateRanges {
  const year = now.getFullYear();
  const month = now.getMonth();
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevDay = Math.min(now.getDate(), lastDayOfMonth(prevYear, prevMonth));
  return {
    current: {
      from: new Date(year, month, 1, 0, 0, 0, 0),
      to: new Date(year, month, now.getDate(), 23, 59, 59, 999)
    },
    previous: {
      from: new Date(prevYear, prevMonth, 1, 0, 0, 0, 0),
      to: new Date(prevYear, prevMonth, prevDay, 23, 59, 59, 999)
    }
  };
}

/**
 * Period-to-date range for revenue reports, with a comparable previous range.
 * - `month`: {@link getMonthToDateRange}.
 * - `year`: January 1st → today, compared with the same dates of last year
 *   (February 29 capped to February 28).
 * - `day` / `all`: identical to {@link getPeriodRange}.
 */
export function getPeriodToDateRange(period: RevenuePeriod, now: Date = new Date()): PeriodRange {
  if (period === 'month') {
    const { current, previous } = getMonthToDateRange(now);
    return {
      currentFrom: current.from,
      currentTo: current.to,
      previousFrom: previous.from,
      previousTo: previous.to
    };
  }
  if (period === 'year') {
    const year = now.getFullYear();
    const month = now.getMonth();
    const prevDay = Math.min(now.getDate(), lastDayOfMonth(year - 1, month));
    return {
      currentFrom: new Date(year, 0, 1, 0, 0, 0, 0),
      currentTo: new Date(year, month, now.getDate(), 23, 59, 59, 999),
      previousFrom: new Date(year - 1, 0, 1, 0, 0, 0, 0),
      previousTo: new Date(year - 1, month, prevDay, 23, 59, 59, 999)
    };
  }
  return getPeriodRange(period, now);
}

/**
 * Percent change between two revenue values. Revenue can be negative (credit notes),
 * so the base is |previous| to keep the sign of the trend meaningful.
 * - both 0 → undefined; previous 0 → 100 when current > 0, otherwise undefined.
 */
export function computeRevenuePercentChange(previous: number, current: number): number | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return current > 0 ? 100 : undefined;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
