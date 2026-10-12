import { RevenueInvoiceLike } from '@core/utils/invoice-metrics.util';
import {
  buildCumulativeMonthlyRealizedRevenue,
  buildCurrentMonthDailyRealizedRevenue,
  buildDailyIssuedAmount,
  buildKpiSparklines,
  buildUnpaidCountByIssueMonth,
  parseIssueDateLocal,
  toLocalDayKey
} from './dashboard-kpi-series.util';

const NOW = new Date(2026, 7, 17, 15, 0, 0); // 17 August 2026

function inv(
  issueDate: string,
  totalAmount: number,
  status: string,
  subTotal: number = totalAmount
): RevenueInvoiceLike {
  return { issueDate, totalAmount, status, subTotal };
}

describe('dashboard-kpi-series.util', () => {
  describe('parseIssueDateLocal / toLocalDayKey', () => {
    it('treats YYYY-MM-DD as a local calendar day', () => {
      const parsed = parseIssueDateLocal('2026-08-17');
      expect(parsed).not.toBeNull();
      expect(parsed!.getFullYear()).toBe(2026);
      expect(parsed!.getMonth()).toBe(7);
      expect(parsed!.getDate()).toBe(17);
      expect(toLocalDayKey('2026-08-17')).toBe('2026-08-17');
    });

    it('returns null for empty or invalid values', () => {
      expect(parseIssueDateLocal('')).toBeNull();
      expect(parseIssueDateLocal('not-a-date')).toBeNull();
      expect(toLocalDayKey('')).toBeNull();
    });
  });

  describe('buildCumulativeMonthlyRealizedRevenue', () => {
    it('accumulates realized revenue over 6 months and ignores out-of-window / non-realized', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-05-10', 100, 'Payée'),
        inv('2026-07-01', 50, 'Validée'),
        inv('2026-08-17', 200, 'Payée'),
        inv('2026-08-17', -30, 'Payée'), // AVO
        inv('2026-08-02', 999, 'Signée'), // not realized
        inv('2026-01-15', 5000, 'Payée') // outside 6-month window (Mar–Aug)
      ];
      // Window: Mar, Apr, May, Jun, Jul, Aug
      expect(buildCumulativeMonthlyRealizedRevenue(invoices, NOW)).toEqual([
        0,
        0,
        100,
        100,
        150,
        320
      ]);
    });

    it('sums the HT (subTotal), not the TTC (totalAmount)', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-08-17', 119, 'Payée', 100) // TTC 119, HT 100
      ];
      expect(buildCumulativeMonthlyRealizedRevenue(invoices, NOW)).toEqual([
        0, 0, 0, 0, 0, 100
      ]);
    });
  });

  describe('buildDailyIssuedAmount', () => {
    it('sums every invoice of each of the last 7 local days, regardless of status', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-08-17', 100, 'Brouillon'),
        inv('2026-08-17', 50, 'Payée'),
        inv('2026-08-16', 20, 'Signée'),
        inv('2026-08-10', 999, 'Payée') // 8 days ago, out of window
      ];
      // 11, 12, 13, 14, 15, 16, 17 August
      expect(buildDailyIssuedAmount(invoices, NOW)).toEqual([
        0, 0, 0, 0, 0, 20, 150
      ]);
    });
  });

  describe('buildCurrentMonthDailyRealizedRevenue', () => {
    it('returns one point per day from the 1st through today, realized only', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-08-01', 10, 'Payée'),
        inv('2026-08-17', 40, 'Validée'),
        inv('2026-08-17', 99, 'Brouillon'),
        inv('2026-07-31', 80, 'Payée')
      ];
      const series = buildCurrentMonthDailyRealizedRevenue(invoices, NOW);
      expect(series.length).toBe(17);
      expect(series[0]).toBe(10);
      expect(series[16]).toBe(40);
      expect(series.slice(1, 16).every(value => value === 0)).toBeTrue();
    });

    it('sums the HT (subTotal), not the TTC (totalAmount)', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-08-17', 119, 'Validée', 100) // TTC 119, HT 100
      ];
      const series = buildCurrentMonthDailyRealizedRevenue(invoices, NOW);
      expect(series[16]).toBe(100);
    });
  });

  describe('buildUnpaidCountByIssueMonth', () => {
    it('counts currently unpaid invoices by issue month, including partially paid', () => {
      const invoices: RevenueInvoiceLike[] = [
        inv('2026-08-01', 10, 'Partiellement payée'),
        inv('2026-08-02', 10, 'En retard'),
        inv('2026-07-15', 10, 'Signée'),
        inv('2026-08-03', 10, 'Payée'),
        inv('2026-08-04', 10, 'Annulée'),
        inv('2026-01-01', 10, 'En retard')
      ];
      // Mar–Aug
      expect(buildUnpaidCountByIssueMonth(invoices, NOW)).toEqual([
        0, 0, 0, 0, 1, 2
      ]);
    });
  });

  describe('buildKpiSparklines', () => {
    it('returns the four series with expected lengths', () => {
      const sparklines = buildKpiSparklines([], NOW);
      expect(sparklines.revenue).toEqual([0, 0, 0, 0, 0, 0]);
      expect(sparklines.salesToday.length).toBe(7);
      expect(sparklines.currentMonth.length).toBe(17);
      expect(sparklines.pending.length).toBe(6);
    });
  });
});
