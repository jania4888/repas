import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingDocumentImportService } from './accounting-document-import.service';
import { JournalEntryProposal } from '../models/accounting-document-import.models';

function sampleProposal(): JournalEntryProposal {
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-08-01',
    label: 'Facture',
    pieceRef: 'FAC-1',
    pieceDate: '2026-08-01',
    thirdParty: null,
    lines: [],
    totalDebit: 100,
    totalCredit: 100,
    documentTotalTtc: 100,
    extraction: null,
    diagnostics: []
  } as unknown as JournalEntryProposal;
}

describe('AccountingDocumentImportService', () => {
  const base = `${environment.apiUrl}/accounting/document-import`;
  let service: AccountingDocumentImportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ErrorHandlerService, AccountingDocumentImportService]
    });
    service = TestBed.inject(AccountingDocumentImportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function proposeAndFlush(status: number, statusText: string, body: string | object = 'Bad Gateway') {
    const file = new File(['%PDF-1.7'], 'facture.pdf', { type: 'application/pdf' });
    let error: Error | undefined;
    service.propose(file).subscribe({ error: (e) => (error = e) });

    const req = http.expectOne((r) => r.url === `${base}/propose`);
    req.flush(body, { status, statusText });
    return error;
  }

  it("renvoie un message français stable sur un 502 (Bad Gateway), jamais le texte brut du proxy", () => {
    const error = proposeAndFlush(502, 'Bad Gateway');

    expect(error).toBeDefined();
    expect(error?.message).toContain("n'a pas répondu à temps");
    expect(error?.message).not.toContain('Bad Gateway');
  });

  it('renvoie le même message stable sur un 503 (service indisponible)', () => {
    const error = proposeAndFlush(503, 'Service Unavailable');

    expect(error?.message).toContain("n'a pas répondu à temps");
    expect(error?.message).not.toContain('Service Unavailable');
  });

  it('renvoie le même message stable sur un 504 (délai de passerelle dépassé)', () => {
    const error = proposeAndFlush(504, 'Gateway Timeout');

    expect(error?.message).toContain("n'a pas répondu à temps");
    expect(error?.message).not.toContain('Gateway Timeout');
  });

  it('conserve le message métier serveur sur un 400 (refus applicatif)', () => {
    const error = proposeAndFlush(400, 'Bad Request', {
      success: false,
      message: 'Cette pièce est illisible : aucune page ne peut être comptée.'
    });

    expect(error?.message).toBe('Cette pièce est illisible : aucune page ne peut être comptée.');
  });

  it('conserve le comportement actuel quand le serveur est injoignable (status 0)', () => {
    const file = new File(['%PDF-1.7'], 'facture.pdf', { type: 'application/pdf' });
    let error: Error | undefined;
    service.propose(file).subscribe({ error: (e) => (error = e) });

    const req = http.expectOne((r) => r.url === `${base}/propose`);
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect(error).toBeDefined();
    expect(error?.message).not.toContain("n'a pas répondu à temps");
  });

  it('rend la proposition quand le serveur répond 200 avec succès', () => {
    const proposal = sampleProposal();
    let result: JournalEntryProposal | undefined;
    const file = new File(['%PDF-1.7'], 'facture.pdf', { type: 'application/pdf' });
    service.propose(file).subscribe((p) => (result = p));

    const req = http.expectOne((r) => r.url === `${base}/propose`);
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, data: proposal });

    expect(result).toEqual(proposal);
  });
});
