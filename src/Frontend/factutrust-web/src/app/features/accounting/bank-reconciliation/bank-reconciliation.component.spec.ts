import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BankReconciliationComponent } from './bank-reconciliation.component';
import {
  BankReconciliationService,
  BankStatementDto,
  BankStatementExtractionMethod,
  BankStatementFilePreviewDto,
  ImportBankStatementRequest
} from '../services/bank-reconciliation.service';
import { AccountingService } from '../services/accounting.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';

function statementPreview(period: string, overrides: Partial<BankStatementFilePreviewDto> = {}): BankStatementFilePreviewDto {
  return {
    totalLines: 1,
    validLines: 1,
    totalDebit: 2.38,
    totalCredit: 0,
    periodStart: `${period}-01T00:00:00`,
    periodEnd: `${period}-28T00:00:00`,
    canImport: true,
    issues: [],
    lines: [{ transactionDate: `${period}-02T00:00:00`, reference: '', description: 'COM TVA', amount: 2.38, isDebit: true } as never],
    detectedRib: '08999000012345678953',
    suggestedBankName: 'BIAT',
    suggestedOpeningBalance: 100,
    suggestedClosingBalance: 97.62,
    extractionMethod: BankStatementExtractionMethod.TextParser,
    ...overrides
  };
}

function imported(id: string): BankStatementDto {
  return { id, bankName: 'BIAT', accountNumber: '08', lines: [{}] } as unknown as BankStatementDto;
}

describe('BankReconciliationComponent — import d’un fichier à plusieurs relevés', () => {
  let fixture: ComponentFixture<BankReconciliationComponent>;
  let component: BankReconciliationComponent;
  let api: jasmine.SpyObj<BankReconciliationService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<BankReconciliationService>('BankReconciliationService', [
      'getStatements',
      'importStatement',
      'previewStatementFile',
      'autoAssociate',
      'getStatement'
    ]);
    api.getStatements.and.returnValue(of({ success: true, data: [] }) as never);
    api.autoAssociate.and.returnValue(of({ success: true, data: { associations: [], summary: null } }) as never);

    await TestBed.configureTestingModule({
      imports: [BankReconciliationComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: BankReconciliationService, useValue: api },
        {
          provide: AccountingService,
          useValue: {
            ensureBankGlProjections: () => of({ success: true, data: { createdCount: 0, skippedCount: 0 } }),
            listImportableBankAccounts: () => of({ success: true, data: [] })
          }
        },
        { provide: BankAccountService, useValue: { list: () => of({ success: true, data: [] }) } },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: (_: unknown, fallback: string) => fallback } },
        { provide: BankStatementImportService, useValue: { capabilities: () => of(null) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(BankReconciliationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function loadPreview(statements: BankStatementFilePreviewDto[]): void {
    component.preview.set({ ...statements[0], canImport: false, statements });
    component.meta.bankName = 'BIAT';
    component.meta.accountNumber = '08 999 00001 2345678953';
  }

  it('importe les relevés un par un, du plus ancien au plus récent', () => {
    loadPreview([statementPreview('2026-07'), statementPreview('2026-08')]);
    api.importStatement.and.returnValues(of({ success: true, data: imported('a') }) as never, of({ success: true, data: imported('b') }) as never);

    expect(component.canImportAll()).toBeTrue();
    component.runImportAll();

    const requests = api.importStatement.calls.allArgs().map(([r]) => r as ImportBankStatementRequest);
    expect(requests.map(r => r.periodStart)).toEqual(['2026-07-01', '2026-08-01']);
    expect(requests.every(r => r.lines.length === 1)).toBeTrue();
    expect(component.selected()?.id).toBe('a');
    expect(component.step()).toBe(2);
  });

  it('s’arrête au premier échec et dit combien de relevés sont déjà importés', () => {
    loadPreview([statementPreview('2026-07'), statementPreview('2026-08'), statementPreview('2026-09')]);
    api.importStatement.and.returnValues(
      of({ success: true, data: imported('a') }) as never,
      of({ success: false, error: 'Période incohérente' }) as never,
      of({ success: true, data: imported('c') }) as never
    );

    component.runImportAll();

    expect(api.importStatement).toHaveBeenCalledTimes(2);
    expect(component.error()).toContain('1');
    expect(component.error()).toContain('Période incohérente');
    expect(component.step()).toBe(1);
  });

  it('refuse l’import groupé tant qu’un relevé est à corriger', () => {
    loadPreview([statementPreview('2026-07'), statementPreview('2026-08', { canImport: false })]);

    expect(component.canImportAll()).toBeFalse();
    component.runImportAll();
    expect(api.importStatement).not.toHaveBeenCalled();
  });

  it('remplace la 504 générique par un message explicite sur le délai de lecture', () => {
    api.previewStatementFile.and.returnValue(throwError(() => new HttpErrorResponse({ status: 504 })));
    component.selectedFile.set(new File(['%PDF'], 'releve.pdf'));

    component.runPreview();

    expect(component.error()).toContain('trop de temps');
  });

  it('restitue le code « délai de lecture IA » de l’API par son message', () => {
    api.previewStatementFile.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { success: false, code: 'bank_statement.preview_timeout', error: 'texte serveur' } }))
    );
    component.selectedFile.set(new File(['%PDF'], 'releve.pdf'));

    component.runPreview();

    expect(component.error()).toContain('dépasse le délai');
    expect(component.error()).not.toContain('texte serveur');
  });
});
