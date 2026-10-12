import {
  isRealizedRevenue,
  isUnpaidInvoice,
  parseIssueDateLocal,
  revenueAmountHt,
  RevenueInvoiceLike
} from '@core/utils/invoice-metrics.util';

export interface KpiSparklines {
  revenue: number[];
  salesToday: number[];
  currentMonth: number[];
  pending: number[];
}

/** Re-exported for backward compatibility; the implementation lives in invoice-metrics.util. */
export { parseIssueDateLocal };

export function toLocalDayKey(issueDate: string | Date): string | null {
  const date = parseIssueDateLocal(issueDate);
  if (!date) {
    return null;
  }
  return formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function toLocalMonthKey(issueDate: string | Date): string | null {
  const date = parseIssueDateLocal(issueDate);
  if (!date) {
    return null;
  }
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1);
}

/**
 * 6-month running total of realized revenue (Payée + Validée) HT, including AVO negatives.
 */
export function buildCumulativeMonthlyRealizedRevenue(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  now: Date,
  monthCount = 6
): number[] {
  const keys = monthKeysEndingAt(now, monthCount);
  const totals = zeroedMap(keys);
  for (const invoice of invoices) {
    if (!isRealizedRevenue(invoice.status)) {
      continue;
    }
    const key = toLocalMonthKey(invoice.issueDate);
    if (!key || !totals.has(key)) {
      continue;
    }
    totals.set(key, (totals.get(key) ?? 0) + revenueAmountHt(invoice));
  }
  let running = 0;
  return keys.map(key => {
    running += totals.get(key) ?? 0;
    return running;
  });
}

/**
 * Last N calendar days of issued amount.
 * Matches dashboard `salesToday`: every invoice of the local civil day, no status filter.
 */
export function buildDailyIssuedAmount(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  now: Date,
  dayCount = 7
): number[] {
  const keys = dayKeysEndingAt(now, dayCount);
  const totals = zeroedMap(keys);
  for (const invoice of invoices) {
    const key = toLocalDayKey(invoice.issueDate);
    if (!key || !totals.has(key)) {
      continue;
    }
    totals.set(key, (totals.get(key) ?? 0) + coerceAmount(invoice.totalAmount));
  }
  return keys.map(key => totals.get(key) ?? 0);
}

/**
 * Realized revenue HT per calendar day from the 1st of the current month through today.
 */
export function buildCurrentMonthDailyRealizedRevenue(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  now: Date
): number[] {
  const keys = currentMonthDayKeys(now);
  const totals = zeroedMap(keys);
  for (const invoice of invoices) {
    if (!isRealizedRevenue(invoice.status)) {
      continue;
    }
    const key = toLocalDayKey(invoice.issueDate);
    if (!key || !totals.has(key)) {
      continue;
    }
    totals.set(key, (totals.get(key) ?? 0) + revenueAmountHt(invoice));
  }
  return keys.map(key => totals.get(key) ?? 0);
}

/**
 * Count of currently unpaid invoices grouped by issue month (6-month window).
 * Proxy of today's unpaid stock, not a historical arrears series.
 */
export function buildUnpaidCountByIssueMonth(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  now: Date,
  monthCount = 6
): number[] {
  const keys = monthKeysEndingAt(now, monthCount);
  const counts = zeroedMap(keys);
  for (const invoice of invoices) {
    if (!isUnpaidInvoice(invoice.status)) {
      continue;
    }
    const key = toLocalMonthKey(invoice.issueDate);
    if (!key || !counts.has(key)) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map(key => counts.get(key) ?? 0);
}

export function buildKpiSparklines(
  invoices: ReadonlyArray<RevenueInvoiceLike>,
  now: Date = new Date()
): KpiSparklines {
  return {
    revenue: buildCumulativeMonthlyRealizedRevenue(invoices, now),
    salesToday: buildDailyIssuedAmount(invoices, now),
    currentMonth: buildCurrentMonthDailyRealizedRevenue(invoices, now),
    pending: buildUnpaidCountByIssueMonth(invoices, now)
  };
}

function coerceAmount(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function zeroedMap(keys: string[]): Map<string, number> {
  return new Map(keys.map(key => [key, 0]));
}

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatDayKey(year: number, month: number, day: number): string {
  return `${formatMonthKey(year, month)}-${String(day).padStart(2, '0')}`;
}

function monthKeysEndingAt(now: Date, monthCount: number): string[] {
  const keys: string[] = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(formatMonthKey(date.getFullYear(), date.getMonth() + 1));
  }
  return keys;
}

function dayKeysEndingAt(now: Date, dayCount: number): string[] {
  const keys: string[] = [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i);
    keys.push(formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate()));
  }
  return keys;
}

function currentMonthDayKeys(now: Date): string[] {
  const keys: string[] = [];
  const today = now.getDate();
  for (let day = 1; day <= today; day++) {
    keys.push(formatDayKey(now.getFullYear(), now.getMonth() + 1, day));
  }
  return keys;
}
