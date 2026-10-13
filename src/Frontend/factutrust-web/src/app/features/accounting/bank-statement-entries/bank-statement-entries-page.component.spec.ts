import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BankStatementEntriesPageComponent } from './bank-statement-entries-page.component';
import { AccountingService } from '../services/accounting.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { BankStatementImportError, BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { BankStatementImportCapabilities, BankStatementImportHistoryPage, BankStatementImportSession, BankStatementTabularMapping, BankStatementTabularPreview } from '../bank-statement-import/bank-statement-import.models';

function capabilities(overrides: Partial<BankStatementImportCapabilities> = {}): BankStatementImportCapabilities {
  return {
    enabled: true,
    aiAvailable: true,
    aiProviderKind: 'local',
    maxFileBytes: 10 * 1024 * 1024,
    maxPages: 20,
    acceptedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
    recognizedBanks: [],
    tabularEnabled: true,
    tabularExtensions: ['.csv', '.xlsx'],
    ...overrides
  } as BankStatementImportCapabilities;
}

function tabularMapping(overrides: Partial<BankStatementTabularMapping> = {}): BankStatementTabularMapping {
  return {
    headerRowIndex: 0,
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
    amountMode: 'debitCredit',
    dateColumn: 0,
    labelColumns: [2],
    debitColumn: 4,
    creditColumn: 5,
    balanceColumn: 6,
    ...overrides
  };
}

function tabularPreview(overrides: Partial<BankStatementTabularPreview> = {}): BankStatementTabularPreview {
  return {
    format: 'csv',
    encoding: 'UTF-8',
    delimiter: ';',
    headerRowIndex: 0,
    sheetNames: [],
    totalRowCount: 3,
    columns: [
      { index: 0, letter: 'A', header: 'Date', samples: ['01/09/2026'] },
      { index: 2, letter: 'C', header: 'Libellé', samples: ['VIR'] },
      { index: 4, letter: 'E', header: 'Débit', samples: ['12,500'] },
      { index: 5, letter: 'F', header: 'Crédit', samples: [''] },
      { index: 6, letter: 'G', header: 'Solde', samples: ['17 210,000'] }
    ],
    suggestedMapping: tabularMapping(),
    savedMapping: null,
    savedMappingUpdatedAt: null,
    rows: [{ rowNumber: 1, cells: ['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'] }],
    parsedLines: [],
    issues: [],
    operationRowCount: 1,
    ignoredFooterRows: 0,
    ambiguousDateFormat: false,
    ...overrides
  };
}

function historyPage(): BankStatementImportHistoryPage {
  return { items: [], page: 1, pageSize: 20, totalCount: 0 };
}

function session(): BankStatementImportSession {
  return {
    id: 'sess-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'a1',
    journalCode: 'JB',
    fileName: 'releve.csv',
    pageCount: 1,
    extractionMethod: null,
    profileId: null,
    aiProviderKind: null,
    errorCode: null,
    statementId: null,
    expiresAt: '2026-12-31T00:00:00',
    extraction: null,
    balanceCheck: null,
    canConfirm: false
  } as unknown as BankStatementImportSession;
}

describe('BankStatementEntriesPageComponent', () => {
  let fixture: ComponentFixture<BankStatementEntriesPageComponent>;
  let component: BankStatementEntriesPageComponent;
  let api: jasmine.SpyObj<BankStatementImportService>;
  let accounting: jasmine.SpyObj<AccountingService>;
  let journalCatalog: jasmine.SpyObj<AccountingJournalCatalogService>;
  let router: Router;

  beforeEach(() => {
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', [
      'history',
      'tabularPreview',
      'start',
      'startTabular',
      'capabilities'
    ]);
    api.history.and.returnValue(of(historyPage()));
    api.tabularPreview.and.returnValue(of(tabularPreview()));
    api.start.and.returnValue(of(session()));
    api.startTabular.and.returnValue(of(session()));
    api.capabilities.and.returnValue(of(capabilities()));

    accounting = jasmine.createSpyObj<AccountingService>('AccountingService', ['ensureBankGlProjections', 'listImportableBankAccounts']);
    accounting.ensureBankGlProjections.and.returnValue(of({ success: true, data: { createdCount: 0, skippedCount: 0 } }));
    accounting.listImportableBankAccounts.and.returnValue(
      of({
        success: true,
        data: [
          { id: 'a1', bankName: 'STB', designation: null, isDefault: true, isActive: true, chartOfAccountNumber: '53210001', currency: 'TND', hasBankingIdentity: true }
        ]
      })
    );

    journalCatalog = jasmine.createSpyObj<AccountingJournalCatalogService>('AccountingJournalCatalogService', ['list', 'listBankJournals']);
    journalCatalog.listBankJournals.and.returnValue(of([{ code: 'JB', label: 'Banque', icon: '', shortLabel: 'JB' }]));

    TestBed.configureTestingModule({
      imports: [BankStatementEntriesPageComponent],
      providers: [
        provideRouter([]),
        { provide: BankStatementImportService, useValue: api },
        { provide: AccountingService, useValue: accounting },
        { provide: AccountingJournalCatalogService, useValue: journalCatalog }
      ]
    });

    fixture = TestBed.createComponent(BankStatementEntriesPageComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  function csvFile(): File {
    return new File(['a;b'], 'releve.csv', { type: 'text/csv' });
  }

  it('affiche l’état bloqué quand aucun compte éligible n’est relié à un compte 532', () => {
    accounting.listImportableBankAccounts.and.returnValue(
      of({ success: true, data: [{ id: 'a1', bankName: 'STB', designation: null, isDefault: true, isActive: true, chartOfAccountNumber: '', currency: 'TND', hasBankingIdentity: true }] })
    );
    fixture = TestBed.createComponent(BankStatementEntriesPageComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="bse-no-eligible-account"]')).toBeTruthy();
  });

  it('CSV sans IA : le type de fichier tabulaire mène au mappage, pas à l’analyse IA', () => {
    expect(component.fileKindChoice).toBe('document');
    component.fileKindChoice = 'tabular';
    component.onFileKindChoiceChange();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="bse-continue-mapping"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="bse-continue-ai"]')).toBeFalsy();
  });

  it('goToMapping lit l’aperçu, préremplit depuis suggestedMapping et note la source « suggested »', () => {
    component.fileKindChoice = 'tabular';
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    expect(component.view()).toBe('mapping');
    expect(component['store'].mapping()).toEqual(tabularMapping());
    expect(component.mappingSource()).toBe('suggested');
    expect(component['store'].rememberMapping()).toBe(false);
  });

  it('goToMapping préfère savedMapping et note la source « saved »', () => {
    const saved = tabularMapping({ dateColumn: 1 });
    api.tabularPreview.and.returnValue(of(tabularPreview({ savedMapping: saved })));
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    expect(component['store'].mapping()).toEqual(saved);
    expect(component.mappingSource()).toBe('saved');
    expect(component['store'].rememberMapping()).toBe(true);
  });

  it('mappingRequiredRolesFilled bloque « Lire les lignes » tant que la colonne solde ou les deux soldes manuels ne sont pas renseignés', () => {
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    fixture.detectChanges();
    expect(component['store'].mappingRequiredRolesFilled()).toBe(true); // balanceColumn déjà fourni par le mappage suggéré

    component.patchMapping({ balanceColumn: null });
    expect(component['store'].mappingRequiredRolesFilled()).toBe(false);

    component.patchMapping({ openingBalance: 100, closingBalance: 90 });
    expect(component['store'].mappingRequiredRolesFilled()).toBe(true);
  });

  it('patchMapping relance l’aperçu après un anti-rebond de 400 ms (un seul appel réseau par rafale)', fakeAsync(() => {
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    api.tabularPreview.calls.reset();

    component.patchMapping({ dateColumn: 1 });
    tick(100);
    component.patchMapping({ dateColumn: 2 });
    tick(100);
    component.patchMapping({ dateColumn: 3 });
    expect(api.tabularPreview).not.toHaveBeenCalled();

    tick(400);
    expect(api.tabularPreview).toHaveBeenCalledTimes(1);
  }));

  it('la case « Mémoriser ce mappage » persiste dans le store jusqu’au lancement', () => {
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    component['store'].rememberMapping.set(true);

    component.startTabularImport();
    const sent = api.startTabular.calls.mostRecent().args[3] as BankStatementTabularMapping;
    expect(sent.rememberMapping).toBe(true);
  });

  it('startTabularImport navigue vers la session après démarrage', () => {
    const navigateSpy = spyOn(router, 'navigate');
    component['store'].bankAccountId.set('a1');
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();

    component.startTabularImport();

    expect(navigateSpy).toHaveBeenCalledWith(['/accounting/bank-statement-entries/session', 'sess-1']);
  });

  it('startDocumentImport (PDF/image) navigue aussi vers la session', () => {
    const navigateSpy = spyOn(router, 'navigate');
    component['store'].bankAccountId.set('a1');
    component['store'].setFile(new File(['x'], 'r.pdf', { type: 'application/pdf' }), 'document');

    component.startDocumentImport();

    expect(navigateSpy).toHaveBeenCalledWith(['/accounting/bank-statement-entries/session', 'sess-1']);
  });

  it('affiche une erreur et ne navigue pas quand startTabular échoue', () => {
    api.startTabular.and.returnValue(throwError(() => new BankStatementImportError('x', 'bank_statement_import.tabular_rejected', 400)));
    const navigateSpy = spyOn(router, 'navigate');
    component['store'].bankAccountId.set('a1');
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();

    component.startTabularImport();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component['store'].tabularPreviewError()).toBeTruthy();
  });

  it("isDirty() redevient faux dès qu'un import a réussi, même avant la résolution de la navigation", () => {
    component['store'].bankAccountId.set('a1');
    component['store'].setFile(new File(['x'], 'r.pdf', { type: 'application/pdf' }), 'document');
    expect(component.isDirty()).toBe(true);

    component.startDocumentImport();

    expect(component.isDirty()).toBe(false);
    expect(component.canDeactivate()).toBe(true);
  });

  it("bloque le choix « PDF/image » quand les capacités serveur indiquent l'IA indisponible", () => {
    api.capabilities.and.returnValue(of(capabilities({ aiAvailable: false })));
    fixture = TestBed.createComponent(BankStatementEntriesPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.aiBlocked()).toBe(true);
    expect(component.tabularBlocked()).toBe(false);
  });

  it("bloque le choix « CSV/Excel » quand l'import tabulaire est désactivé côté serveur", () => {
    api.capabilities.and.returnValue(of(capabilities({ tabularEnabled: false })));
    fixture = TestBed.createComponent(BankStatementEntriesPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.tabularBlocked()).toBe(true);
  });

  it("patchLabelColumn ne touche que le premier emplacement de libellé", () => {
    component['store'].setFile(csvFile(), 'tabular');
    component.goToMapping();
    component.patchMapping({ labelColumns: [2, 3] });

    component.patchLabelColumn(5);

    expect(component['store'].mapping()?.labelColumns).toEqual([5, 3]);
  });
});
