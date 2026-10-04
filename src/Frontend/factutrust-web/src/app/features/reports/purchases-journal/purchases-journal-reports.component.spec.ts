import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { PurchasesJournalReportsComponent } from './purchases-journal-reports.component';
import { PurchasesJournalDetailRow, ReportsApiService } from '@core/services/reports-api.service';
import { SupplierService } from '@core/services/supplier.service';

describe('PurchasesJournalReportsComponent', () => {
  let fixture: ComponentFixture<PurchasesJournalReportsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PurchasesJournalReportsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        MessageService,
        {
          provide: ReportsApiService,
          useValue: {
            getPurchasesJournal: () => of({
              success: true,
              data: {
                source: 'Invoice',
                viewMode: 'Detail',
                from: '2026-01-01',
                to: '2026-01-31',
                totalRows: 0,
                page: 1,
                pageSize: 50,
                totals: { quantity: 0, lineSubTotal: 0, lineTotal: 0, vatAmount: 0, currency: 'TND' },
                detailRows: [],
                aggregatedRows: []
              }
            }),
            downloadPurchasesJournalPdf: () => of(new Blob())
          }
        },
        {
          provide: SupplierService,
          useValue: {
            getActiveSuppliers: () => of({ success: true, data: { items: [] } })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PurchasesJournalReportsComponent);
    fixture.detectChanges();
  });

  it('should create and load empty journal', () => {
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.hasData()).toBe(false);
  });

  it('shows a document label and keeps routing on the BR code', () => {
    const component = fixture.componentInstance;
    const receipt = { documentKind: 'BR', documentId: 'receipt-1' } as PurchasesJournalDetailRow;
    const invoice = { documentKind: 'FAC', documentId: 'invoice-1' } as PurchasesJournalDetailRow;

    expect(component.documentKindLabel('BR')).not.toBe('BR');
    expect(component.documentKindLabel('FAC')).not.toBe('FAC');
    expect(component.documentLink(receipt)).toEqual(['/purchase-receipts', 'receipt-1']);
    expect(component.documentLink(invoice)).toEqual(['/supplier-invoices', 'invoice-1']);
  });
});
