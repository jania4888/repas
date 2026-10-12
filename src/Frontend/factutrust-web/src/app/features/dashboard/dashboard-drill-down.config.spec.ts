import {
  canNavigateToTarget,
  formatIsoDate,
  getDrillDownTarget,
  INVOICE_STATUS_OVERDUE,
  type DrillDownAuthChecker
} from './dashboard-drill-down.config';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';
import { DeliveryNoteStatus } from '../delivery-notes/models/delivery-note.model';

function makeAuth(overrides: Partial<DrillDownAuthChecker> = {}): DrillDownAuthChecker {
  return {
    hasPermission: () => true,
    hasModule: () => true,
    ...overrides
  };
}

describe('dashboard-drill-down.config', () => {
  const fixedNow = new Date(2026, 5, 16);

  describe('formatIsoDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      expect(formatIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
  });

  describe('getDrillDownTarget', () => {
    it('maps totalRevenue to revenue analytics cumulative view', () => {
      const target = getDrillDownTarget('totalRevenue');
      expect(target.route).toBe('/reports/analytics/revenue');
      expect(target.queryParams).toEqual({ period: 'all' });
      expect(target.requiredPermission).toBe(PERMISSIONS.reports.view);
    });

    it('maps salesToday to invoices with today date range', () => {
      const target = getDrillDownTarget('salesToday', { now: fixedNow });
      expect(target.route).toBe('/invoices');
      expect(target.queryParams).toEqual({ fromDate: '2026-06-16', toDate: '2026-06-16' });
    });

    it('maps pendingInvoices to unpaid route', () => {
      const target = getDrillDownTarget('pendingInvoices');
      expect(target.route).toBe('/invoices/unpaid');
    });

    it('maps currentMonthRevenue to the "Factures et avoirs" view, HT-restricted, month-to-date', () => {
      const target = getDrillDownTarget('currentMonthRevenue', { now: fixedNow });
      expect(target.route).toBe('/invoices/revenue');
      expect(target.queryParams).toEqual({
        fromDate: '2026-06-01',
        toDate: '2026-06-16',
        realizedRevenueOnly: 'true'
      });
    });

    it('maps chartMonth to the "Factures et avoirs" view for the selected month, HT-restricted', () => {
      const target = getDrillDownTarget('chartMonth', {
        month: { month: 'Mars', monthShort: 'Mar', year: 2026, revenue: 100, invoiceCount: 2 }
      });
      expect(target.route).toBe('/invoices/revenue');
      expect(target.queryParams).toEqual({
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
        realizedRevenueOnly: 'true'
      });
    });
  });

  describe('canNavigateToTarget', () => {
    it('denies navigation when permission is missing', () => {
      const target = getDrillDownTarget('totalRevenue');
      expect(
        canNavigateToTarget(
          target,
          makeAuth({ hasPermission: (p) => p !== PERMISSIONS.reports.view })
        )
      ).toBe(false);
    });
  });
});