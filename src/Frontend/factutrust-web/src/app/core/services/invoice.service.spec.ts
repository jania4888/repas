import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { environment } from '@environments/environment';
import { CashDeskService } from './cash-desk.service';
import { InvoiceService } from './invoice.service';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiUrl}/invoices`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CashDeskService, useValue: {} }
      ]
    });
    service = TestBed.inject(InvoiceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('downloadReportPdf uses SKIP_ERROR_TOAST (list handles print feedback locally)', () => {
    service.downloadReportPdf('2026-09-29', '2026-09-29', undefined, 'INVOICE').subscribe({
      error: () => fail('expected successful PDF response')
    });

    const req = httpMock.expectOne(
      (r) => r.url.startsWith(`${baseUrl}/report/pdf`) && r.params.get('fromDate') === '2026-09-29'
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/pdf' }
    });
  });
});
