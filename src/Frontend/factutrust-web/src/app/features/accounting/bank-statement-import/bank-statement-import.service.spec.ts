import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@environments/environment';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { GenerateItem } from './bank-statement-import.models';

describe('BankStatementImportService', () => {
  const base = `${environment.apiUrl}/accounting/bank-statement-import`;
  let service: BankStatementImportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(BankStatementImportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renvoie null quand le serveur répond 200 « enabled:false » (fonctionnalité éteinte)', () => {
    let result: unknown = 'non émis';
    service.capabilities().subscribe(caps => (result = caps));

    http.expectOne(`${base}/capabilities`).flush({
      success: true,
      data: { enabled: false, aiAvailable: false, aiProviderKind: null, maxFileBytes: 0, maxPages: 0, acceptedExtensions: [], recognizedBanks: [] }
    });

    expect(result).toBeNull();
  });

  it('renvoie null sur un 404 d’un serveur pas encore à jour, sans propager d’erreur', () => {
    let result: unknown = 'non émis';
    service.capabilities().subscribe(caps => (result = caps));

    http.expectOne(`${base}/capabilities`).flush({ success: false }, { status: 404, statusText: 'Not Found' });

    expect(result).toBeNull();
  });

  it('épargne la sonde IA aux écrans qui ne lisent que l’interrupteur', () => {
    service.capabilities({ includeAi: false }).subscribe();

    const req = http.expectOne(r => r.url === `${base}/capabilities`);
    expect(req.request.params.get('includeAi')).toBe('false');
    req.flush({ success: true, data: { enabled: false } });
  });

  it('renvoie les capacités quand la fonctionnalité est active', () => {
    let enabled: boolean | undefined;
    service.capabilities().subscribe(caps => (enabled = caps?.enabled));

    http.expectOne(`${base}/capabilities`).flush({
      success: true,
      data: { enabled: true, aiAvailable: false, aiProviderKind: null, maxFileBytes: 1, maxPages: 60, acceptedExtensions: [], recognizedBanks: [] }
    });

    expect(enabled).toBeTrue();
  });

  it('envoie le fichier, le compte bancaire et le journal en multipart, sans montant ni modèle', () => {
    const file = new File(['%PDF-1.7'], 'releve.pdf', { type: 'application/pdf' });
    service.start(file, 'bank-1', 'JB').subscribe();

    const req = http.expectOne(`${base}/sessions`);
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body.get('bankAccountId')).toBe('bank-1');
    expect(body.get('journalCode')).toBe('JB');
    expect((body.get('file') as File).name).toBe('releve.pdf');
    expect(body.has('model')).toBeFalse();
    req.flush({ success: true, data: { id: 's-1' } });
  });

  it('expose le code d’erreur stable et le statut HTTP (jamais le texte)', () => {
    let error: BankStatementImportError | undefined;
    service.session('s-1').subscribe({ error: e => (error = e) });

    http
      .expectOne(`${base}/sessions/s-1`)
      .flush({ success: false, error: 'Texte serveur', code: 'bank_statement_import.session_not_found' }, { status: 404, statusText: 'Not Found' });

    expect(error).toEqual(jasmine.any(BankStatementImportError));
    expect(error?.code).toBe('bank_statement_import.session_not_found');
    expect(error?.status).toBe(404);
  });

  it('traite une enveloppe success=false en 200 comme une erreur', () => {
    let error: BankStatementImportError | undefined;
    service.proposals('st-1').subscribe({ error: e => (error = e) });

    http.expectOne(`${base}/statements/st-1/proposals`).flush({ success: false, code: 'bank_statement_posting.statement_not_found' });

    expect(error?.code).toBe('bank_statement_posting.statement_not_found');
  });

  it('télécharge la pièce justificative en binaire et expose le statut en cas d’absence', () => {
    let blob: Blob | undefined;
    service.sourceFile('st-1').subscribe(b => (blob = b));
    const ok = http.expectOne(`${base}/statements/st-1/source-file`);
    expect(ok.request.responseType).toBe('blob');
    ok.flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    expect(blob?.type).toBe('application/pdf');

    let error: BankStatementImportError | undefined;
    service.sourceFile('st-2').subscribe({ error: e => (error = e) });
    http.expectOne(`${base}/statements/st-2/source-file`).flush(new Blob(), { status: 404, statusText: 'Not Found' });
    expect(error?.status).toBe(404);
  });

  it('confirme sans correction', () => {
    service.confirm('s-1').subscribe();

    const req = http.expectOne(`${base}/sessions/s-1/confirm`);
    expect(req.request.body).toEqual({ corrections: [] });
    req.flush({ success: true, data: { statementId: 'st-1', lineCount: 3, alreadyImportedCount: 0 } });
  });

  it('confirme avec l’accusé de l’écart de solde', () => {
    service.confirm('s-1', { corrections: [], acknowledgeBalanceWarning: true }).subscribe();

    const req = http.expectOne(`${base}/sessions/s-1/confirm`);
    expect(req.request.body).toEqual({ corrections: [], acknowledgeBalanceWarning: true });
    req.flush({ success: true, data: { statementId: 'st-1', lineCount: 3, alreadyImportedCount: 0 } });
  });

  it('n’émet pas l’accusé quand il est faux et transmet les corrections telles quelles', () => {
    service.confirm('s-1', { corrections: [{ lineIndex: 2, amount: 12.5 }, { lineIndex: 4, exclude: true }], acknowledgeBalanceWarning: false }).subscribe();

    const req = http.expectOne(`${base}/sessions/s-1/confirm`);
    expect(req.request.body).toEqual({ corrections: [{ lineIndex: 2, amount: 12.5 }, { lineIndex: 4, exclude: true }] });
    expect('acknowledgeBalanceWarning' in req.request.body).toBeFalse();
    req.flush({ success: true, data: { statementId: 'st-1', lineCount: 3, alreadyImportedCount: 0 } });
  });

  it('relance la lecture complète d’une session sur le même compte', () => {
    let next: { id: string } | undefined;
    service.retry('s-1').subscribe(s => (next = s));

    const req = http.expectOne(`${base}/sessions/s-1/retry`);
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, data: { id: 's-2', status: 'Pending' } });
    expect(next?.id).toBe('s-2');
  });

  it('re-cible une session sur un autre compte bancaire', () => {
    service.retarget('s-1', 'bank-2').subscribe();

    const req = http.expectOne(`${base}/sessions/s-1/retarget`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ bankAccountId: 'bank-2' });
    req.flush({ success: true, data: { id: 's-2', status: 'Pending' } });
  });

  it('génère avec le journal et les choix de ligne uniquement', () => {
    const items: GenerateItem[] = [
      { lineId: 'l-1', accountNumber: '6278', thirdPartyId: null, thirdPartyKind: 'None', vatAmount: null, vatAccountNumber: null, label: null, rememberRule: false }
    ];
    service.generate('st-1', 'JB', items).subscribe();

    const req = http.expectOne(`${base}/statements/st-1/generate`);
    expect(req.request.body).toEqual({ journalCode: 'JB', items });
    expect(JSON.stringify(req.request.body)).not.toContain('amount"');
    req.flush({ success: true, data: { created: 1, skipped: 0, failed: 0, firstEntryNumber: 1, lastEntryNumber: 1, outcomes: [] } });
  });
});
