import {
  InvoiceStatusKey,
  normalizeInvoiceStatus,
  isRealizedRevenue,
  isUnpaidInvoice,
  getPeriodRange,
  sumRealizedRevenue,
  sumRealizedRevenueHt,
  revenueAmountHt,
  parseIssueDateLocal,
  toIsoDateLocal,
  getMonthToDateRange,
  getPeriodToDateRange,
  computeRevenuePercentChange,
  RevenueInvoiceLike
} from './invoice-metrics.util';

describe('invoice-metrics.util', () => {
  describe('normalizeInvoiceStatus', () => {
    it('maps French display labels (case/diacritic-insensitive)', () => {
      expect(normalizeInvoiceStatus('Payée')).toBe(InvoiceStatusKey.Paid);
      expect(normalizeInvoiceStatus('Validée')).toBe(InvoiceStatusKey.Validated);
      // Regression guard: the old analytics code compared against 'VALIDÉE' (uppercase),
      // which never matched the real 'Validée' value.
      expect(normalizeInvoiceStatus('VALIDÉE')).toBe(InvoiceStatusKey.Validated);
      expect(normalizeInvoiceStatus('Partiellement payée')).toBe(InvoiceStatusKey.PartiallyPaid);
      expect(normalizeInvoiceStatus('Signée')).toBe(InvoiceStatusKey.Signed);
      expect(normalizeInvoiceStatus('Annulée')).toBe(InvoiceStatusKey.Cancelled);
    });

    it('maps English keys defensively', () => {
      expect(normalizeInvoiceStatus('paid')).toBe(InvoiceStatusKey.Paid);
      expect(normalizeInvoiceStatus('validated')).toBe(InvoiceStatusKey.Validated);
      expect(normalizeInvoiceStatus('partiallyPaid')).toBe(InvoiceStatusKey.PartiallyPaid);
    });

    it('maps numeric enum values', () => {
      expect(normalizeInvoiceStatus(4)).toBe(InvoiceStatusKey.Paid);
      expect(normalizeInvoiceStatus(1)).toBe(InvoiceStatusKey.Validated);
      expect(normalizeInvoiceStatus(0)).toBe(InvoiceStatusKey.Draft);
    });

    it('returns null for unknown values', () => {
      expect(normalizeInvoiceStatus('badStatus')).toBeNull();
      expect(normalizeInvoiceStatus(999)).toBeNull();
      expect(normalizeInvoiceStatus(3)).toBeNull();
      expect(normalizeInvoiceStatus(null)).toBeNull();
      expect(normalizeInvoiceStatus(undefined)).toBeNull();
    });
  });

  describe('isRealizedRevenue', () => {
    it('counts Payée and Validée only', () => {
      expect(isRealizedRevenue('Payée')).toBe(true);
      expect(isRealizedRevenue('Validée')).toBe(true);
    });

    it('excludes Signée, drafts, partial, overdue, cancelled', () => {
      expect(isRealizedRevenue('Signée')).toBe(false);
      expect(isRealizedRevenue('Brouillon')).toBe(false);
      expect(isRealizedRevenue('Partiellement payée')).toBe(false);
      expect(isRealizedRevenue('En retard')).toBe(false);
      expect(isRealizedRevenue('Annulée')).toBe(false);
    });
  });

  describe('isUnpaidInvoice', () => {
    it('matches backend unpaidOnly: everything except Paid and Cancelled', () => {
      expect(isUnpaidInvoice('Brouillon')).toBe(true);
      expect(isUnpaidInvoice('Validée')).toBe(true);
      expect(isUnpaidInvoice('Signée')).toBe(true);
      expect(isUnpaidInvoice('En retard')).toBe(true);
      // Critical: partially paid IS unpaid (the dashboard previously excluded it).
      expect(isUnpaidInvoice('Partiellement payée')).toBe(true);
    });

    it('excludes Paid and Cancelled', () => {
      expect(isUnpaidInvoice('Payée')).toBe(false);
      expect(isUnpaidInvoice('Annulée')).toBe(false);
    });

    it('excludes unrecognized statuses', () => {
      expect(isUnpaidInvoice('???')).toBe(false);
    });
  });

  describe('getPeriodRange', () => {
    const now = new Date(2026, 5, 18, 10, 0, 0); // 18 June 2026

    it('computes month bounds', () => {
      const r = getPeriodRange('month', now);
      expect(r.currentFrom).toEqual(new Date(2026, 5, 1));
      expect(r.currentTo).toEqual(new Date(2026, 6, 0, 23, 59, 59));
      expect(r.previousFrom).toEqual(new Date(2026, 4, 1));
    });

    it('computes year bounds', () => {
      const r = getPeriodRange('year', now);
      expect(r.currentFrom).toEqual(new Date(2026, 0, 1));
      expect(r.currentTo).toEqual(new Date(2026, 11, 31, 23, 59, 59));
      expect(r.previousFrom).toEqual(new Date(2025, 0, 1));
    });

    it('computes cumulative (all) bounds from the epoch with no prior period', () => {
      const r = getPeriodRange('all', now);
      expect(r.currentFrom).toEqual(new Date(0));
      expect(r.currentTo).toEqual(new Date(2026, 5, 18, 23, 59, 59));
      expect(r.previousFrom).toEqual(new Date(0));
      expect(r.previousTo).toEqual(new Date(0));
    });
  });

  describe('sumRealizedRevenue', () => {
    const invoices: RevenueInvoiceLike[] = [
      { status: 'Payée', issueDate: '2026-06-10', totalAmount: 1000 },
      { status: 'Validée', issueDate: '2026-06-12', totalAmount: 500 },
      { status: 'Signée', issueDate: '2026-06-12', totalAmount: 9999 },     // excluded
      { status: 'Brouillon', issueDate: '2026-06-12', totalAmount: 9999 },  // excluded
      { status: 'Payée', issueDate: '2025-01-01', totalAmount: 200 },       // out of range
      { status: 'Payée', issueDate: '2026-06-15', totalAmount: -300 }       // credit note (AVO)
    ];

    it('sums Payée + Validée, signed, all-time when no range', () => {
      expect(sumRealizedRevenue(invoices)).toBe(1000 + 500 + 200 - 300);
    });

    it('restricts to a date range and keeps credit notes negative', () => {
      const total = sumRealizedRevenue(invoices, {
        from: new Date(2026, 5, 1),
        to: new Date(2026, 5, 30, 23, 59, 59)
      });
      expect(total).toBe(1000 + 500 - 300);
    });
  });

  describe('revenueAmountHt', () => {
    it('returns the signed subTotal when finite', () => {
      expect(revenueAmountHt({ subTotal: 115.84 })).toBe(115.84);
      expect(revenueAmountHt({ subTotal: -2759.013 })).toBe(-2759.013);
    });

    it('returns 0 (never the TTC total) when subTotal is missing or not finite', () => {
      expect(revenueAmountHt({})).toBe(0);
      expect(revenueAmountHt({ subTotal: NaN })).toBe(0);
      expect(revenueAmountHt({ subTotal: Infinity })).toBe(0);
    });
  });

  describe('parseIssueDateLocal / toIsoDateLocal', () => {
    it('parses YYYY-MM-DD as local midnight and formats back with local fields', () => {
      const d = parseIssueDateLocal('2026-10-01');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(9);
      expect(d!.getDate()).toBe(1);
      expect(d!.getHours()).toBe(0);
      expect(toIsoDateLocal(d!)).toBe('2026-10-01');
    });

    it('returns null for empty or invalid input', () => {
      expect(parseIssueDateLocal('')).toBeNull();
      expect(parseIssueDateLocal('not-a-date')).toBeNull();
    });
  });

  describe('sumRealizedRevenueHt', () => {
    const docs: RevenueInvoiceLike[] = [
      { status: 'Payée', issueDate: '2026-10-04', totalAmount: 137.85, subTotal: 115.84 },
      { status: 'Validée', issueDate: '2026-10-02', totalAmount: -3283.225, subTotal: -2759.013 },
      // Not counted: Signée / Brouillon / Annulée
      { status: 'Signée', issueDate: '2026-10-05', totalAmount: 13751.45, subTotal: 11555.84 },
      { status: 'Brouillon', issueDate: '2026-10-05', totalAmount: 100, subTotal: 84 },
      { status: 'Annulée', issueDate: '2026-10-05', totalAmount: 100, subTotal: 84 },
      // Outside the month (local date at the month boundary)
      { status: 'Payée', issueDate: '2026-09-30', totalAmount: 50, subTotal: 42 },
      { status: 'Payée', issueDate: '2026-11-01', totalAmount: 50, subTotal: 42 }
    ];

    it('sums signed HT of Payée + Validée invoices and credit notes', () => {
      const range = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31, 23, 59, 59, 999) };
      expect(sumRealizedRevenueHt(docs, range)).toBeCloseTo(115.84 - 2759.013, 3);
    });

    it('sums all dates when no range is given', () => {
      expect(sumRealizedRevenueHt(docs)).toBeCloseTo(115.84 - 2759.013 + 42 + 42, 3);
    });
  });

  describe('getMonthToDateRange', () => {
    it('covers the 1st → today and the same days of the previous month', () => {
      const { current, previous } = getMonthToDateRange(new Date(2026, 2, 15, 10, 30));
      expect(current.from).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
      expect(current.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
      expect(previous.from).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
      expect(previous.to).toEqual(new Date(2026, 1, 15, 23, 59, 59, 999));
    });

    it('caps the previous range to the last day of a shorter month', () => {
      expect(getMonthToDateRange(new Date(2026, 2, 31)).previous.to).toEqual(
        new Date(2026, 1, 28, 23, 59, 59, 999)
      );
      expect(getMonthToDateRange(new Date(2028, 2, 31)).previous.to).toEqual(
        new Date(2028, 1, 29, 23, 59, 59, 999)
      );
    });

    it('wraps January to December of the previous year', () => {
      const { previous } = getMonthToDateRange(new Date(2026, 0, 1));
      expect(previous.from).toEqual(new Date(2025, 11, 1, 0, 0, 0, 0));
      expect(previous.to).toEqual(new Date(2025, 11, 1, 23, 59, 59, 999));
    });
  });

  describe('getPeriodToDateRange', () => {
    it('month delegates to getMonthToDateRange', () => {
      const now = new Date(2026, 9, 11);
      const r = getPeriodToDateRange('month', now);
      const m = getMonthToDateRange(now);
      expect(r.currentFrom).toEqual(m.current.from);
      expect(r.currentTo).toEqual(m.current.to);
      expect(r.previousFrom).toEqual(m.previous.from);
      expect(r.previousTo).toEqual(m.previous.to);
    });

    it('year compares January 1st → today with the same dates last year (Feb 29 capped)', () => {
      const r = getPeriodToDateRange('year', new Date(2028, 1, 29));
      expect(r.currentFrom).toEqual(new Date(2028, 0, 1, 0, 0, 0, 0));
      expect(r.currentTo).toEqual(new Date(2028, 1, 29, 23, 59, 59, 999));
      expect(r.previousFrom).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0));
      expect(r.previousTo).toEqual(new Date(2027, 1, 28, 23, 59, 59, 999));
    });

    it('day and all are unchanged from getPeriodRange', () => {
      const now = new Date(2026, 9, 11, 12);
      expect(getPeriodToDateRange('day', now)).toEqual(getPeriodRange('day', now));
      expect(getPeriodToDateRange('all', now)).toEqual(getPeriodRange('all', now));
    });
  });

  describe('computeRevenuePercentChange', () => {
    it('keeps the previous-zero behaviour', () => {
      expect(computeRevenuePercentChange(0, 0)).toBeUndefined();
      expect(computeRevenuePercentChange(0, 50)).toBe(100);
      expect(computeRevenuePercentChange(0, -50)).toBeUndefined();
    });

    it('uses |previous| as base so a negative previous month keeps a meaningful sign', () => {
      expect(computeRevenuePercentChange(100, 150)).toBe(50);
      expect(computeRevenuePercentChange(100, -3)).toBe(-103);
      // From -100 to -50 revenue improved: the trend must be positive.
      expect(computeRevenuePercentChange(-100, -50)).toBe(50);
    });
  });
});
