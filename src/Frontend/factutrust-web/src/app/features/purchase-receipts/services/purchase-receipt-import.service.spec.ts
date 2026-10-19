import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient, HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PurchaseReceiptImportService } from './purchase-receipt-import.service';
import { PurchaseReceiptImportEvent, PurchaseReceiptImportProposal } from '../models/purchase-receipt-import.models';

function sampleProposal(): PurchaseReceiptImportProposal {
  return {
    extractionProvider: 'llm-vision',
    ocrApplied: false,
    documentType: 'PurchaseInvoice',
    documentNumber: 'FA-1',
    header: {
      receiptDate: '2026-10-01',
      deliveryNoteNumber: null,
      supplierReference: null,
      currency: 'TND',
      suggestedNotes: null,
      suggestedWarehouseId: null
    },
    supplier: {
      matchOutcome: 'NotFound',
      supplierId: null,
      supplierName: null,
      extractedName: null,
      extractedNif: null,
      candidates: [],
      prefill: null
    },
    lines: [],
    documentTotals: { totalHt: null, totalVat: null, fodecAmount: null, fiscalStampAmount: null, withholdingAmount: null, totalTtc: null, vatBreakdown: [] },
    expectedReceiptTotals: { subTotal: 0, totalVat: 0, totalAmount: 0 },
    confidence: 'high',
    warnings: [],
    canCreateSupplier: true,
    canCreateProduct: true
  };
}

describe('PurchaseReceiptImportService', () => {
  const base = `${environment.apiUrl}/purchasereceipts/import-document`;
  let service: PurchaseReceiptImportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ErrorHandlerService, PurchaseReceiptImportService]
    });
    service = TestBed.inject(PurchaseReceiptImportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function importAndCapture(): { events: PurchaseReceiptImportEvent[]; state: { error: Error | undefined } } {
    const events: PurchaseReceiptImportEvent[] = [];
    const state: { error: Error | undefined } = { error: undefined };
    const file = new File(['%PDF-1.4'], 'bl.pdf', { type: 'application/pdf' });
    service.importDocument(file).subscribe({
      next: (e) => events.push(e),
      error: (e) => (state.error = e)
    });
    return { events, state };
  }

  it('émet upload puis analysing pendant la progression, puis done avec la proposition', () => {
    const { events } = importAndCapture();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('POST');

    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 } as never);
    req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 } as never);

    const proposal = sampleProposal();
    req.event({
      type: HttpEventType.Response,
      ok: true,
      status: 200,
      statusText: 'OK',
      url: base,
      body: { success: true, data: proposal }
    } as never);

    expect(events.map((e) => e.kind)).toEqual(['upload', 'upload', 'analysing', 'done']);
    const done = events.find((e) => e.kind === 'done') as { kind: 'done'; proposal: PurchaseReceiptImportProposal };
    expect(done.proposal).toEqual(proposal);
  });

  it('renvoie une erreur métier quand success=false', () => {
    const { events, state } = importAndCapture();
    const req = http.expectOne((r) => r.url === base);
    req.flush({ success: false, message: 'Document illisible.' });

    expect(events.find((e) => e.kind === 'done')).toBeUndefined();
    expect(state.error?.message).toBe('Document illisible.');
  });

  it('413 → message "fichier trop volumineux"', () => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base).flush('Payload Too Large', { status: 413, statusText: 'Payload Too Large' });
    expect(state.error?.message).toContain('volumineux');
  });

  it('403 → message de droits insuffisants', () => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(state.error?.message).toContain('droits');
  });

  it('429 → message de limitation de débit', () => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base).flush('Too Many Requests', { status: 429, statusText: 'Too Many Requests' });
    expect(state.error?.message).toContain('Trop de demandes');
  });

  it('502 → message de service d’extraction indisponible, jamais le texte brut', () => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base).flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    expect(state.error?.message).toContain('indisponible');
    expect(state.error?.message).not.toContain('Bad Gateway');
  });

  it('status 0 (serveur injoignable) → message dédié', () => {
    const { state } = importAndCapture();
    const req = http.expectOne((r) => r.url === base);
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(state.error?.message).toContain('Impossible de joindre le serveur');
  });

  it('conserve un message métier serveur propre (400) sans le masquer', () => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base).flush(
      { success: false, message: 'Le type de document détecté ne correspond pas.' },
      { status: 400, statusText: 'Bad Request' }
    );
    expect(state.error?.message).toBe('Le type de document détecté ne correspond pas.');
  });

  it('dépassement du délai maximal → message dédié, jamais "Http failure"', fakeAsync(() => {
    const { state } = importAndCapture();
    http.expectOne((r) => r.url === base);
    tick(190_001);
    expect(state.error?.message).toContain('dépassé le délai maximal');
    expect(state.error?.message).not.toContain('Http failure');
  }));

  it('capabilities() déballe l’enveloppe ApiResponse et renvoie les données en cas de succès', () => {
    let result: unknown;
    service.capabilities().subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url === `${base}/capabilities`);
    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      data: {
        available: true,
        extractionProvider: 'llm',
        ocrAvailable: true,
        visionCapable: true,
        externalProcessing: false,
        maxFileBytes: 10_485_760,
        acceptedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        canCreateSupplier: true,
        canCreateProduct: true,
        canAttach: true
      },
      message: null,
      errors: []
    });

    expect(result).toEqual(jasmine.objectContaining({ available: true, extractionProvider: 'llm' }));
  });

  it('capabilities() renvoie null quand l’enveloppe est en échec (success=false)', () => {
    let result: unknown = 'not-set';
    service.capabilities().subscribe((r) => (result = r));
    http
      .expectOne((r) => r.url === `${base}/capabilities`)
      .flush({ success: false, data: null, message: 'indisponible', errors: [] });

    expect(result).toBeNull();
  });

  it('capabilities() renvoie null en cas d’échec plutôt que de propager l’erreur', () => {
    let result: unknown = 'not-set';
    let threw = false;
    service.capabilities().subscribe({
      next: (r) => (result = r),
      error: () => (threw = true)
    });
    http.expectOne((r) => r.url === `${base}/capabilities`).flush('Server error', { status: 500, statusText: 'Internal Server Error' });

    expect(threw).toBeFalse();
    expect(result).toBeNull();
  });
});
