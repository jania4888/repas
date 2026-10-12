import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { InvoiceService, InvoiceListItem, InvoiceListSummary } from '@core/services/invoice.service';
import { QuoteService } from '@core/services/quote.service';
import { ClientService } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { toIsoDateLocal } from '@core/utils/invoice-metrics.util';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let getInvoices: jasmine.Spy;
  let getInvoicesSummary: jasmine.Spy;
  let getQuotes: jasmine.Spy;
  let getClients: jasmine.Spy;
  let hasPermission: jasmine.Spy;

  const emptyPage = { items: [] as unknown[], page: 1, pageSize: 10, totalCount: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false };
  const emptySummary: InvoiceListSummary = { totalTtc: 0, totalHt: 0, totalPaid: 0, totalRemaining: 0 } as InvoiceListSummary;

  function apiOk<T>(data: T) {
    return of({ success: true, data, message: null, errors: [] as string[] });
  }

  beforeEach(() => {
    getInvoices = jasmine.createSpy('getInvoices').and.returnValue(apiOk(emptyPage));
    getInvoicesSummary = jasmine.createSpy('getInvoicesSummary').and.returnValue(apiOk(emptySummary));
    getQuotes = jasmine.createSpy('getQuotes').and.returnValue(apiOk(emptyPage));
    getClients = jasmine.createSpy('getClients').and.returnValue(apiOk(emptyPage));
    // Par défaut, toutes les permissions sont accordées : non-régression des tests existants.
    hasPermission = jasmine.createSpy('hasPermission').and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        DashboardService,
        { provide: InvoiceService, useValue: { getInvoices, getInvoicesSummary } },
        { provide: QuoteService, useValue: { getQuotes } },
        { provide: ClientService, useValue: { getClients } },
        { provide: AuthService, useValue: { hasPermission } }
      ]
    });
    service = TestBed.inject(DashboardService);
  });

  function invoice(
    partial: Partial<InvoiceListItem> & Pick<InvoiceListItem, 'issueDate' | 'totalAmount' | 'status'>
  ): InvoiceListItem {
    return {
      id: partial.id ?? 'id',
      number: partial.number ?? 'FAC-1',
      type: partial.type ?? 'INVOICE',
      isCreditNote: partial.isCreditNote ?? false,
      issueDate: partial.issueDate,
      dueDate: partial.dueDate ?? null,
      status: partial.status,
      statusCssClass: '',
      clientName: 'Client',
      totalAmount: partial.totalAmount,
      subTotal: partial.subTotal,
      currency: 'TND',
      isOverdue: false,
      totalPaid: 0,
      remainingAmount: partial.totalAmount
    };
  }

  it('exposes kpiSparklines with expected bucket lengths from loaded invoices', async () => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    getInvoices.and.returnValue(apiOk({
      ...emptyPage,
      items: [
        invoice({ issueDate: todayKey, totalAmount: 100, subTotal: 100, status: 'Payée' }),
        invoice({ issueDate: todayKey, totalAmount: 40, subTotal: 40, status: 'Partiellement payée' })
      ]
    }));

    const data = await firstValueFrom(service.loadDashboardData());
    expect(data.kpiSparklines.revenue.length).toBe(6);
    expect(data.kpiSparklines.salesToday.length).toBe(7);
    expect(data.kpiSparklines.currentMonth.length).toBe(today.getDate());
    expect(data.kpiSparklines.pending.length).toBe(6);
    expect(data.kpiSparklines.salesToday[6]).toBe(140);
    expect(data.kpiSparklines.pending[5]).toBe(1);
    // Realized-revenue bucket is HT (subTotal), only the Payée invoice counts.
    expect(data.kpiSparklines.revenue[5]).toBe(100);
  });

  it('returns zeroed sparklines when invoice/quote/client calls fail', async () => {
    getInvoices.and.returnValue(throwError(() => new Error('invoices down')));
    getInvoicesSummary.and.returnValue(throwError(() => new Error('summary down')));
    getQuotes.and.returnValue(throwError(() => new Error('quotes down')));
    getClients.and.returnValue(throwError(() => new Error('clients down')));

    const data = await firstValueFrom(service.loadDashboardData());
    expect(data.allInvoices).toEqual([]);
    expect(data.kpiSparklines.revenue).toEqual([0, 0, 0, 0, 0, 0]);
    expect(data.kpiSparklines.salesToday.every(v => v === 0)).toBeTrue();
    expect(data.kpiSparklines.pending).toEqual([0, 0, 0, 0, 0, 0]);
    expect(data.kpiSparklines.currentMonth.length).toBe(new Date().getDate());
    // Server summary failed → revenueKpis falls back to null, caller uses sumRealizedRevenueHt.
    expect(data.revenueKpis).toEqual({ totalHt: null, monthToDateHt: null, previousMonthToDateHt: null });
  });

  // §7.3.3 — profil « Commercial étendu » : invoices:read ✗, quotes:read ✓, clients:read ✓.
  describe('mixed permissions — profil Commercial étendu', () => {
    beforeEach(() => {
      hasPermission.and.callFake((perm: string) => perm !== PERMISSIONS.invoices.read);
    });

    it('does not call getInvoices and substitutes an empty, successful page', async () => {
      const data = await firstValueFrom(service.loadDashboardData());

      expect(getInvoices).not.toHaveBeenCalled();
      expect(getQuotes).toHaveBeenCalled();
      expect(getClients).toHaveBeenCalled();
      expect(data.allInvoices).toEqual([]);
    });

    it('does not call getInvoicesSummary and leaves revenueKpis null', async () => {
      const data = await firstValueFrom(service.loadDashboardData());

      expect(getInvoicesSummary).not.toHaveBeenCalled();
      expect(data.revenueKpis).toEqual({ totalHt: null, monthToDateHt: null, previousMonthToDateHt: null });
    });
  });

  // Second profil : « Auditeur » — tout en lecture, tous les appels partent.
  describe('mixed permissions — profil Auditeur (tout en lecture)', () => {
    beforeEach(() => {
      hasPermission.and.returnValue(true);
    });

    it('calls all three sources and exposes every domain as authorized', async () => {
      const data = await firstValueFrom(service.loadDashboardData());

      expect(getInvoices).toHaveBeenCalled();
      expect(getQuotes).toHaveBeenCalled();
      expect(getClients).toHaveBeenCalled();
    });
  });

  describe('revenueKpis — CA HT from the server summary', () => {
    it('calls getInvoicesSummary 3 times with realizedRevenueOnly and the right date bounds', async () => {
      const now = new Date();
      await firstValueFrom(service.loadDashboardData());

      expect(getInvoicesSummary).toHaveBeenCalledTimes(3);

      // 1) total — no date params.
      const totalCall = getInvoicesSummary.calls.argsFor(0)[0];
      expect(totalCall.realizedRevenueOnly).toBeTrue();
      expect(totalCall.fromDate).toBeUndefined();
      expect(totalCall.toDate).toBeUndefined();

      // 2) month-to-date — 1st of month → today.
      const monthToDateCall = getInvoicesSummary.calls.argsFor(1)[0];
      expect(monthToDateCall.realizedRevenueOnly).toBeTrue();
      expect(monthToDateCall.fromDate).toBe(toIsoDateLocal(new Date(now.getFullYear(), now.getMonth(), 1)));
      expect(monthToDateCall.toDate).toBe(toIsoDateLocal(now));

      // 3) previous month-to-date — same day-of-month, previous month.
      const previousCall = getInvoicesSummary.calls.argsFor(2)[0];
      expect(previousCall.realizedRevenueOnly).toBeTrue();
      expect(previousCall.fromDate).toBe(
        toIsoDateLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      );
    });

    it('populates revenueKpis from the summary responses', async () => {
      getInvoicesSummary.and.returnValues(
        apiOk({ ...emptySummary, realizedRevenueHt: 1000 }),
        apiOk({ ...emptySummary, realizedRevenueHt: 300 }),
        apiOk({ ...emptySummary, realizedRevenueHt: 250 })
      );

      const data = await firstValueFrom(service.loadDashboardData());

      expect(data.revenueKpis).toEqual({ totalHt: 1000, monthToDateHt: 300, previousMonthToDateHt: 250 });
    });

    it('falls back to null per call when a summary request fails, without affecting the others', async () => {
      getInvoicesSummary.and.returnValues(
        apiOk({ ...emptySummary, realizedRevenueHt: 1000 }),
        throwError(() => new Error('month-to-date down')),
        apiOk({ ...emptySummary, realizedRevenueHt: 250 })
      );

      const data = await firstValueFrom(service.loadDashboardData());

      expect(data.revenueKpis).toEqual({ totalHt: 1000, monthToDateHt: null, previousMonthToDateHt: 250 });
    });

    it('computes revenueChange from the server summary month-to-date values when both are available', async () => {
      getInvoicesSummary.and.returnValues(
        apiOk({ ...emptySummary, realizedRevenueHt: 1000 }),
        apiOk({ ...emptySummary, realizedRevenueHt: 150 }),
        apiOk({ ...emptySummary, realizedRevenueHt: 100 })
      );

      const data = await firstValueFrom(service.loadDashboardData());

      // (150 - 100) / |100| * 100 = 50
      expect(data.kpiTrends.revenueChange).toBe(50);
    });
  });

  describe('monthlyRevenue — current month sums HT (factures moins avoirs)', () => {
    it('sums subTotal of Payée/Validée invoices and credit notes for the current month entry', async () => {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      getInvoices.and.returnValue(apiOk({
        ...emptyPage,
        items: [
          invoice({ issueDate: todayKey, totalAmount: 100, subTotal: 100, status: 'Payée', type: 'INVOICE', isCreditNote: false }),
          invoice({ issueDate: todayKey, totalAmount: -40, subTotal: -40, status: 'Validée', type: 'CREDIT_NOTE', isCreditNote: true })
        ]
      }));

      const data = await firstValueFrom(service.loadDashboardData());
      const currentMonthEntry = data.monthlyRevenue[data.monthlyRevenue.length - 1];
      expect(currentMonthEntry.revenue).toBe(60);
      expect(currentMonthEntry.invoiceCount).toBe(2);
    });
  });
});
