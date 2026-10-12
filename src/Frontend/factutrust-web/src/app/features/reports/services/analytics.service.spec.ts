import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { QuoteService } from '@core/services/quote.service';
import { ProductService } from '@core/services/product.service';
import { ClientService } from '@core/services/client.service';
import { getMonthToDateRange, toIsoDateLocal } from '@core/utils/invoice-metrics.util';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.loadRevenueData', () => {
  let service: AnalyticsService;
  let getInvoices: jasmine.Spy;

  function apiOk<T>(data: T) {
    return of({ success: true, data, message: null, errors: [] as string[] });
  }

  function invoice(partial: Partial<InvoiceListItem> & Pick<InvoiceListItem, 'issueDate' | 'totalAmount' | 'status'>): InvoiceListItem {
    return {
      id: partial.id ?? 'id',
      number: partial.number ?? 'FAC-1',
      type: partial.type ?? 'INVOICE',
      isCreditNote: partial.isCreditNote ?? false,
      issueDate: partial.issueDate,
      dueDate: partial.dueDate ?? null,
      status: partial.status,
      statusCssClass: '',
      clientName: partial.clientName ?? 'Client',
      totalAmount: partial.totalAmount,
      subTotal: partial.subTotal,
      currency: 'TND',
      isOverdue: false,
      totalPaid: 0,
      remainingAmount: partial.totalAmount
    };
  }

  beforeEach(() => {
    getInvoices = jasmine.createSpy('getInvoices').and.returnValue(apiOk({ items: [] as InvoiceListItem[] }));

    TestBed.configureTestingModule({
      providers: [
        AnalyticsService,
        { provide: InvoiceService, useValue: { getInvoices } },
        { provide: QuoteService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: ClientService, useValue: {} }
      ]
    });
    service = TestBed.inject(AnalyticsService);
  });

  it('calls getInvoices with realizedRevenueOnly: true', async () => {
    await firstValueFrom(service.loadRevenueData('month'));
    expect(getInvoices).toHaveBeenCalledWith(jasmine.objectContaining({ pageSize: 2000, realizedRevenueOnly: true }));
  });

  it('sums HT (subTotal, factures moins avoirs) month-to-date, compared to the same days last month', async () => {
    const { current, previous } = getMonthToDateRange();

    getInvoices.and.returnValue(apiOk({
      items: [
        // Current month-to-date: FAC 100 HT (TTC 119) + AVO -40 HT (TTC -47.6) = 60 HT.
        invoice({ issueDate: toIsoDateLocal(current.from), totalAmount: 119, subTotal: 100, status: 'Payée' }),
        invoice({ issueDate: toIsoDateLocal(current.to), totalAmount: -47.6, subTotal: -40, status: 'Validée', isCreditNote: true }),
        // Not realized revenue — excluded regardless of date.
        invoice({ issueDate: toIsoDateLocal(current.to), totalAmount: 999, subTotal: 999, status: 'Signée' }),
        // Previous month-to-date: 25 HT.
        invoice({ issueDate: toIsoDateLocal(previous.from), totalAmount: 29.75, subTotal: 25, status: 'Payée' })
      ]
    }));

    const result = await firstValueFrom(service.loadRevenueData('month'));

    expect(result.totalRevenue).toBe(60);
    expect(result.totalInvoices).toBe(3); // all 3 current-period docs, including the non-realized one.
    expect(result.comparison.previousValue).toBe(25);
    // (60 - 25) / |25| * 100 = 140
    expect(result.comparison.changePercent).toBeCloseTo(140, 5);
    expect(result.comparison.changeDirection).toBe('up');
  });

  it('keeps changeDirection meaningful when the previous period was negative (buildComparison uses |previous|)', async () => {
    const { current, previous } = getMonthToDateRange();

    getInvoices.and.returnValue(apiOk({
      items: [
        // Current: 10 HT (small positive).
        invoice({ issueDate: toIsoDateLocal(current.from), totalAmount: 11.9, subTotal: 10, status: 'Payée' }),
        // Previous: -100 HT (avoirs outweighed factures last month).
        invoice({ issueDate: toIsoDateLocal(previous.from), totalAmount: -119, subTotal: -100, status: 'Validée', isCreditNote: true })
      ]
    }));

    const result = await firstValueFrom(service.loadRevenueData('month'));

    expect(result.totalRevenue).toBe(10);
    expect(result.comparison.previousValue).toBe(-100);
    // (10 - (-100)) / |-100| * 100 = 110
    expect(result.comparison.changePercent).toBeCloseTo(110, 5);
    expect(result.comparison.changeDirection).toBe('up');
  });

  it('builds byClient shares on the signed HT total, allowing a negative share', async () => {
    const { current } = getMonthToDateRange();

    getInvoices.and.returnValue(apiOk({
      items: [
        invoice({ clientName: 'Client A', issueDate: toIsoDateLocal(current.from), totalAmount: 119, subTotal: 100, status: 'Payée' }),
        invoice({ clientName: 'Client B', issueDate: toIsoDateLocal(current.from), totalAmount: -47.6, subTotal: -40, status: 'Validée', isCreditNote: true })
      ]
    }));

    const result = await firstValueFrom(service.loadRevenueData('month'));

    const clientA = result.byClient.find(c => c.clientName === 'Client A');
    const clientB = result.byClient.find(c => c.clientName === 'Client B');
    expect(clientA?.totalAmount).toBe(100);
    expect(clientB?.totalAmount).toBe(-40);
    // totalRevenue = 60 ; A = 100/60*100 ; B = -40/60*100.
    expect(clientA?.percentOfTotal).toBeCloseTo((100 / 60) * 100, 5);
    expect(clientB?.percentOfTotal).toBeCloseTo((-40 / 60) * 100, 5);
  });
});
