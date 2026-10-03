import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BankReconciliationComponent } from './bank-reconciliation.component';
import { BankReconciliationService, BankStatementDto } from '../services/bank-reconciliation.service';
import { AccountingService } from '../services/accounting.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { BankStatementImportCapabilities } from '../bank-statement-import/bank-statement-import.models';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';

const STATEMENT_ID = '3f2a6c1e-8b4d-4e7a-9c11-2d5e6f708192';

const capabilities: BankStatementImportCapabilities = {
  enabled: true,
  aiAvailable: false,
  aiProviderKind: null,
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 60,
  acceptedExtensions: ['.pdf'],
  recognizedBanks: [],
  allDocumentsViaAi: true
};

/**
 * Rapprochement avec « tout document par l'IA » : un PDF ou une image ouvre l'import IA (fichier
 * présélectionné) au lieu de l'aperçu historique ; CSV inchangé ; le retour de l'import ouvre le
 * relevé enregistré à l'étape 2 ; sans le drapeau, rien ne change.
 */
describe('BankReconciliationComponent — tout document par l’IA', () => {
  let fixture: ComponentFixture<BankReconciliationComponent>;
  let component: BankReconciliationComponent;
  let api: jasmine.SpyObj<BankReconciliationService>;
  let toast: { add: jasmine.Spy };
  let router: Router;

  async function create(caps: BankStatementImportCapabilities | null, query: Record<string, string> = {}): Promise<void> {
    api = jasmine.createSpyObj<BankReconciliationService>('BankReconciliationService', [
      'getStatements',
      'previewStatementFile',
      'autoAssociate',
      'getStatement'
    ]);
    api.getStatements.and.returnValue(of({ success: true, data: [] }) as never);
    api.autoAssociate.and.returnValue(of({ success: true, data: { associations: [], summary: null } }) as never);
    api.getStatement.and.returnValue(of({ success: true, data: { id: STATEMENT_ID, bankName: 'STB', accountNumber: '10', lines: [] } as unknown as BankStatementDto }) as never);
    toast = { add: jasmine.createSpy('add') };

    await TestBed.configureTestingModule({
      imports: [BankReconciliationComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: BankReconciliationService, useValue: api },
        { provide: AccountingService, useValue: {} },
        { provide: BankAccountService, useValue: { list: () => of({ success: true, data: [] }) } },
        { provide: ToastService, useValue: toast },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: (_: unknown, fallback: string) => fallback } },
        { provide: BankStatementImportService, useValue: { capabilities: () => of(caps), start: jasmine.createSpy('start') } },
        { provide: AccountingJournalCatalogService, useValue: { list: () => of([{ code: 'JB', label: 'Banque', icon: '', shortLabel: 'JB' }]) } }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BankReconciliationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function choose(name: string): File {
    const file = new File(['%PDF-1.7'], name);
    component.onFileSelected({ target: { files: [file] } } as unknown as Event);
    return file;
  }

  afterEach(() => history.replaceState(null, ''));

  it('ouvre l’import IA avec le fichier PDF déjà choisi, sans aperçu', async () => {
    await create(capabilities);

    const file = choose('releve.pdf');

    expect(component.allDocumentsViaAi()).toBeTrue();
    expect(component.aiImportVisible()).toBeTrue();
    expect(component.aiImportFile()).toBe(file);
    component.runPreview();
    expect(api.previewStatementFile).not.toHaveBeenCalled();
  });

  it('traite aussi les images (dont WEBP) par l’import IA', async () => {
    await create(capabilities);

    choose('photo.webp');

    expect(component.aiImportVisible()).toBeTrue();
  });

  it('garde l’aperçu historique pour un CSV', async () => {
    await create(capabilities);
    api.previewStatementFile.and.returnValue(of({ success: false, error: 'x' }) as never);

    choose('releve.csv');
    component.runPreview();

    expect(component.aiImportVisible()).toBeFalse();
    expect(api.previewStatementFile).toHaveBeenCalled();
  });

  it('garde l’aperçu historique d’un PDF sans le drapeau', async () => {
    await create({ ...capabilities, allDocumentsViaAi: false });
    api.previewStatementFile.and.returnValue(of({ success: false, error: 'x' }) as never);

    choose('releve.pdf');
    component.runPreview();

    expect(component.aiImportVisible()).toBeFalse();
    expect(api.previewStatementFile).toHaveBeenCalled();
  });

  it('bascule vers l’import IA quand le serveur l’exige', async () => {
    await create({ ...capabilities, allDocumentsViaAi: false });
    api.previewStatementFile.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { success: false, code: 'bank_statement.ai_import_required' } }))
    );

    const file = choose('releve.pdf');
    component.runPreview();

    expect(component.aiImportVisible()).toBeTrue();
    expect(component.aiImportFile()).toBe(file);
    expect(component.error()).toBeNull();
  });

  it('ouvre le relevé enregistré à l’étape 2 au retour de l’import IA', async () => {
    history.replaceState({ importedStatement: { lineCount: 4, alreadyImportedCount: 0 } }, '');
    await create(capabilities, { statementId: STATEMENT_ID });

    expect(api.getStatement).toHaveBeenCalledOnceWith(STATEMENT_ID);
    expect(component.step()).toBe(2);
    expect(component.wizardActive()).toBeTrue();
    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', summary: 'Relevé enregistré' }));
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { statementId: null }, replaceUrl: true }));
  });

  it('prévient quand des opérations figuraient déjà dans un autre relevé', async () => {
    history.replaceState({ importedStatement: { lineCount: 4, alreadyImportedCount: 2 } }, '');
    await create(capabilities, { statementId: STATEMENT_ID });

    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn' }));
  });

  it('ignore un identifiant de relevé mal formé', async () => {
    await create(capabilities, { statementId: '../admin' });

    expect(api.getStatement).not.toHaveBeenCalled();
    expect(component.wizardActive()).toBeFalse();
  });
});
