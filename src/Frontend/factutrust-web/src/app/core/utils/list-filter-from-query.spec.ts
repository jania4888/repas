import {
  applyDeliveryNoteListFiltersFromQuery,
  applyInvoiceListFiltersFromQuery,
  applyQuoteListFiltersFromQuery,
  applySupplierInvoiceListFiltersFromQuery,
  isActiveQuoteStatus,
  parseDateQueryParam,
  parseSearchQueryParam
} from './list-filter-from-query';
import { DeliveryNoteStatus } from '../../features/delivery-notes/models/delivery-note.model';

function paramMap(values: Record<string, string>): { get: (key: string) => string | null } {
  return {
    get: (key: string) => values[key] ?? null
  };
}

describe('list-filter-from-query', () => {
  describe('parseDateQueryParam', () => {
    it('parses valid ISO date', () => {
      const date = parseDateQueryParam('2026-06-16');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2026);
      expect(date!.getMonth()).toBe(5);
      expect(date!.getDate()).toBe(16);
    });

    it('returns null for invalid value', () => {
      expect(parseDateQueryParam('not-a-date')).toBeNull();
      expect(parseDateQueryParam(null)).toBeNull();
    });
  });

  describe('parseSearchQueryParam', () => {
    it('parses trimmed search term', () => {
      expect(parseSearchQueryParam(paramMap({ search: '  factures  ' }) as any)).toBe('factures');
    });

    it('returns null for empty search', () => {
      expect(parseSearchQueryParam(paramMap({ search: '   ' }) as any)).toBeNull();
      expect(parseSearchQueryParam(paramMap({}) as any)).toBeNull();
    });
  });

  describe('applyInvoiceListFiltersFromQuery', () => {
    it('applies search query param', () => {
      const result = applyInvoiceListFiltersFromQuery(
        paramMap({ search: 'FAC-2026' }) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null }
      );
      expect(result.search).toBe('FAC-2026');
    });

    it('applies status and date range', () => {
      const result = applyInvoiceListFiltersFromQuery(
        paramMap({ status: '6', fromDate: '2026-01-01', toDate: '2026-01-31' }) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null }
      );
      expect(result.selectedStatus).toBe(6);
      expect(result.dateRange?.[0]?.getFullYear()).toBe(2026);
      expect(result.dateRange?.[0]?.getMonth()).toBe(0);
      expect(result.dateRange?.[0]?.getDate()).toBe(1);
      expect(result.dateRange?.[1]?.getFullYear()).toBe(2026);
      expect(result.dateRange?.[1]?.getMonth()).toBe(0);
      expect(result.dateRange?.[1]?.getDate()).toBe(31);
    });

    it('keeps realizedRevenueOnly at the current state when the param is absent (default true)', () => {
      const result = applyInvoiceListFiltersFromQuery(
        paramMap({}) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null, realizedRevenueOnly: true }
      );
      expect(result.realizedRevenueOnly).toBe(true);
    });

    it('disables realizedRevenueOnly only on the explicit value false', () => {
      const off = applyInvoiceListFiltersFromQuery(
        paramMap({ realizedRevenueOnly: 'false' }) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null, realizedRevenueOnly: true }
      );
      expect(off.realizedRevenueOnly).toBe(false);

      const explicitTrue = applyInvoiceListFiltersFromQuery(
        paramMap({ realizedRevenueOnly: 'true' }) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null, realizedRevenueOnly: false }
      );
      expect(explicitTrue.realizedRevenueOnly).toBe(true);

      const otherValue = applyInvoiceListFiltersFromQuery(
        paramMap({ realizedRevenueOnly: '0' }) as any,
        { selectedStatus: null, dateRange: [], selectedClientId: null, search: null, realizedRevenueOnly: false }
      );
      expect(otherValue.realizedRevenueOnly).toBe(true);
    });
  });

  describe('applySupplierInvoiceListFiltersFromQuery', () => {
    it('applies supplierId and search', () => {
      const result = applySupplierInvoiceListFiltersFromQuery(
        paramMap({ supplierId: 'sup-123', search: 'FS-2026' }) as any,
        { selectedStatus: null, selectedSupplierId: null, search: null }
      );
      expect(result.selectedSupplierId).toBe('sup-123');
      expect(result.search).toBe('FS-2026');
    });

    it('applies numeric status', () => {
      const result = applySupplierInvoiceListFiltersFromQuery(
        paramMap({ status: '3' }) as any,
        { selectedStatus: null, selectedSupplierId: null, search: null }
      );
      expect(result.selectedStatus).toBe(3);
    });
  });

  describe('applyDeliveryNoteListFiltersFromQuery', () => {
    it('applies confirmed status', () => {
      const result = applyDeliveryNoteListFiltersFromQuery(
        paramMap({ status: DeliveryNoteStatus.Confirmed }) as any,
        { selectedStatus: null, search: null }
      );
      expect(result.selectedStatus).toBe(DeliveryNoteStatus.Confirmed);
    });
  });

  describe('applyQuoteListFiltersFromQuery', () => {
    it('enables activeOnly mode', () => {
      const result = applyQuoteListFiltersFromQuery(
        paramMap({ activeOnly: '1' }) as any,
        { selectedStatus: 1, activeOnly: false, search: null }
      );
      expect(result.activeOnly).toBe(true);
      expect(result.selectedStatus).toBeNull();
    });
  });

  describe('isActiveQuoteStatus', () => {
    it('matches dashboard active quote statuses', () => {
      expect(isActiveQuoteStatus('Brouillon')).toBe(true);
      expect(isActiveQuoteStatus('Envoye')).toBe(true);
      expect(isActiveQuoteStatus('Accepte')).toBe(false);
    });
  });
});