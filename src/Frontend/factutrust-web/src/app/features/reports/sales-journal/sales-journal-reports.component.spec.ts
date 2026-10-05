import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SalesJournalReportsComponent } from './sales-journal-reports.component';
import { MessageService } from 'primeng/api';
import { ReportsApiService, SalesJournalPdfError, SalesJournalReportResult } from '@core/services/reports-api.service';
import { ApiResponse } from '@core/services/auth.service';
import { ClientService } from '@core/services/client.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PrintPreviewService } from '@core/services/print-preview.service';

describe('SalesJournalReportsComponent', () => {
  let fixture: ComponentFixture<SalesJournalReportsComponent>;
  let reportsApi: jasmine.SpyObj<ReportsApiService>;
  let getSalesJournalCalls: number;

  const emptyTotals = {
    quantity: 0,
    lineSubTotal: 0,
    lineTotal: 0,
    vatAmount: 0,
    currency: 'TND'
  };

  function apiOk(data: SalesJournalReportResult): ApiResponse<SalesJournalReportResult> {
    return { success: true, data, message: null, errors: [] };
  }

  function apiFail(errors: string[]): ApiResponse<SalesJournalReportResult> {
    return { success: false, data: null as unknown as SalesJournalReportResult, message: null, errors };
  }

  function mockReport(totalRows: number, detailRows: SalesJournalReportResult['detailRows'] = []): SalesJournalReportResult {
    return {
      viewMode: 'Detail',
      from: '2026-09-01',
      to: '2026-09-30',
      totalRows,
      page: 1,
      pageSize: 50,
      totals: emptyTotals,
      detailRows,
      aggregatedRows: []
    };
  }

  beforeEach(async () => {
    getSalesJournalCalls = 0;
    reportsApi = jasmine.createSpyObj('ReportsApiService', ['getSalesJournal', 'downloadSalesJournalPdf']);
    reportsApi.getSalesJournal.and.callFake(() => {
      getSalesJournalCalls++;
      return of(apiOk(mockReport(0)));
    });

    await TestBed.configureTestingModule({
      imports: [SalesJournalReportsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
        { provide: ReportsApiService, useValue: reportsApi },
        {
          provide: ClientService,
          useValue: {
            getClients: () => of({ success: true, data: { items: [], totalCount: 0 } })
          }
        },
        {
          provide: ErrorHandlerService,
          useValue: { extractErrorMessage: () => 'Erreur réseau simulée' }
        },
        {
          provide: PrintPreviewService,
          useValue: { openPdfForPrintPreview: jasmine.createSpy('openPdfForPrintPreview') }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SalesJournalReportsComponent);
  });

  it('should create and show journal title', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Journal de ventes');
  }));

  it('loads report once on init without lazy-load loop', fakeAsync(() => {
    reportsApi.getSalesJournal.and.callFake(() => {
      getSalesJournalCalls++;
      return of(apiOk(mockReport(2, [
          {
            issueDate: '2026-09-15',
            invoiceId: 'a',
            invoiceNumber: 'FAC-1',
            documentType: 'FAC',
            clientId: 'c1',
            clientName: 'Client A',
            productCode: 'P1',
            productName: 'Produit',
            quantity: 1,
            unitPrice: 10,
            lineSubTotal: 10,
            lineTotal: 11.9,
            vatAmount: 1.9,
            currency: 'TND'
          }
        ])));
    });

    fixture.detectChanges();
    tick();

    expect(getSalesJournalCalls).toBe(1);
    expect(fixture.componentInstance.initialLoad()).toBe(false);
    expect(fixture.componentInstance.loadError()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Aucune ligne de vente sur cette période');

    fixture.componentInstance.onPage({ first: 0, rows: 50 });
    tick();
    expect(getSalesJournalCalls).toBe(1);
  }));

  it('shows empty message when report has no rows', fakeAsync(() => {
    reportsApi.getSalesJournal.and.returnValue(of(apiOk(mockReport(0))));

    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.loadError()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Aucune ligne de vente sur cette période');
  }));

  it('shows load error instead of empty message on HTTP failure', fakeAsync(() => {
    reportsApi.getSalesJournal.and.returnValue(throwError(() => ({ status: 0, message: 'fail' })));

    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.loadError()).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Erreur réseau simulée');
    expect(fixture.nativeElement.textContent).not.toContain('Aucune ligne de vente sur cette période');
  }));

  it('shows load error when API returns success false', fakeAsync(() => {
    reportsApi.getSalesJournal.and.returnValue(
      of(apiFail(['Période trop longue']))
    );

    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.loadError()).toContain('Période trop longue');
    expect(fixture.nativeElement.textContent).not.toContain('Aucune ligne de vente sur cette période');
  }));

  it('requests next page when lazy load page changes', fakeAsync(() => {
    reportsApi.getSalesJournal.and.callFake(() => {
      getSalesJournalCalls++;
      return of(apiOk(mockReport(100)));
    });

    fixture.detectChanges();
    tick();
    expect(getSalesJournalCalls).toBe(1);

    fixture.componentInstance.onPage({ first: 50, rows: 50 });
    tick();
    expect(getSalesJournalCalls).toBe(2);
  }));

  it('uses an info toast when the pdf error code is NoData', fakeAsync(() => {
    reportsApi.downloadSalesJournalPdf.and.returnValue(
      throwError(() => new SalesJournalPdfError('لا توجد أسطر مبيعات في هذه الفترة.', 'NoData'))
    );
    fixture.detectChanges();
    tick();
    const toast = fixture.debugElement.injector.get(MessageService);
    const add = spyOn(toast, 'add');

    fixture.componentInstance.printPdf();
    tick();

    expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'info' }));
  }));

  it('keeps an error toast when the pdf message is French and has no code', fakeAsync(() => {
    reportsApi.downloadSalesJournalPdf.and.returnValue(
      throwError(() => new SalesJournalPdfError('Aucune ligne de vente pour cette période.'))
    );
    fixture.detectChanges();
    tick();
    const toast = fixture.debugElement.injector.get(MessageService);
    const add = spyOn(toast, 'add');

    fixture.componentInstance.printPdf();
    tick();

    expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'error' }));
  }));

  it('keeps the French CSV header', async () => {
    reportsApi.getSalesJournal.and.returnValue(of(apiOk(mockReport(1, [{
      issueDate: '2026-09-15',
      invoiceId: 'a',
      invoiceNumber: 'FAC-1',
      documentType: 'FAC',
      clientId: 'c1',
      clientName: 'Client A',
      productCode: 'P1',
      productName: 'Produit',
      quantity: 1,
      unitPrice: 10,
      lineSubTotal: 10,
      lineTotal: 11.9,
      vatAmount: 1.9,
      currency: 'TND'
    }]))));
    fixture.detectChanges();
    await fixture.whenStable();

    const blobs: Blob[] = [];
    spyOn(URL, 'createObjectURL').and.callFake((value: Blob | MediaSource) => {
      blobs.push(value as Blob);
      return 'blob:test';
    });
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');

    await fixture.componentInstance.exportCsv();
    expect(blobs.length).toBeGreaterThan(0);
    const text = (await blobs[0].text()).replace(/^\uFEFF/, '');
    expect(text.split('\n')[0]).toBe('Date;Facture;Type;Client;Code;Produit;Qté;PU;HT;TVA;TTC;Devise');
  });
});
