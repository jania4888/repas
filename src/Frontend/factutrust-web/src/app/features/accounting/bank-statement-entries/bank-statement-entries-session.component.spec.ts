import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BankStatementEntriesSessionComponent } from './bank-statement-entries-session.component';
import { BankStatementImportError, BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AccountingService } from '../services/accounting.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { BankStatementImportSession, StatementExtractionIssue } from '../bank-statement-import/bank-statement-import.models';

function line(overrides: Partial<BankStatementImportSession['extraction'] extends infer E ? (E extends { lines: (infer L)[] } ? L : never) : never> = {}) {
  return {
    index: 0,
    pageNumber: 1,
    transactionDate: '2026-09-05T00:00:00',
    valueDate: null,
    label: 'VIR RECU',
    labelLines: [],
    amount: 150,
    isDebit: false,
    source: 'Ai' as const,
    ...overrides
  };
}

function issue(overrides: Partial<StatementExtractionIssue> = {}): StatementExtractionIssue {
  return { code: 'statement.ai_line_needs_review', severity: 'Warning', message: 'À vérifier', pageNumber: 1, lineIndex: null, ...overrides };
}

function session(overrides: Partial<BankStatementImportSession> = {}): BankStatementImportSession {
  return {
    id: 'sess-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'bank-1',
    journalCode: 'JB',
    fileName: 'releve-sept.pdf',
    pageCount: 1,
    extractionMethod: 'ai-vision',
    profileId: null,
    aiProviderKind: 'local',
    errorCode: null,
    statementId: null,
    expiresAt: '2026-12-31T00:00:00',
    extraction: {
      header: {
        rib: null,
        bankCode: null,
        currency: 'TND',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        openingBalance: { value: 1000, printedDecimals: 3, signSource: 'Column' },
        closingBalance: { value: 1150, printedDecimals: 3, signSource: 'Column' },
        totalDebits: { value: 0, printedDecimals: 3, signSource: 'Column' },
        totalCredits: { value: 150, printedDecimals: 3, signSource: 'Column' },
        totalsLabelled: true
      },
      lines: [line()],
      issues: [],
      profileId: 'vision',
      pageCount: 1,
      unresolvedPages: []
    },
    balanceCheck: { sumDebits: 0, sumCredits: 150, computedClosing: 1150, difference: 0, isBalanced: true },
    canConfirm: true,
    ...overrides
  };
}

describe('BankStatementEntriesSessionComponent', () => {
  let fixture: ComponentFixture<BankStatementEntriesSessionComponent>;
  let component: BankStatementEntriesSessionComponent;
  let api: jasmine.SpyObj<BankStatementImportService>;
  let router: Router;
  let confirmation: { confirm: jasmine.Spy };
  let accounting: { ensureBankGlProjections: jasmine.Spy; listImportableBankAccounts: jasmine.Spy };
  let bankAccountsApi: { list: jasmine.Spy };

  async function create(sessionId = 'sess-1'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [BankStatementEntriesSessionComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ sessionId }) } } },
        { provide: BankStatementImportService, useValue: api },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: AccountingService, useValue: accounting },
        { provide: BankAccountService, useValue: bankAccountsApi }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BankStatementEntriesSessionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    confirmation = { confirm: jasmine.createSpy('confirm').and.callFake((c: { accept?: () => void }) => c.accept?.()) };
    accounting = {
      ensureBankGlProjections: jasmine.createSpy('ensureBankGlProjections').and.returnValue(of({ success: true, data: { createdCount: 0, skippedCount: 0 }, message: null, errors: [] })),
      listImportableBankAccounts: jasmine.createSpy('listImportableBankAccounts').and.returnValue(of({ success: true, data: [], message: null, errors: [] }))
    };
    bankAccountsApi = { list: jasmine.createSpy('list').and.returnValue(of({ success: true, data: [], message: null, errors: [] })) };
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', ['session', 'cancel', 'retry', 'retarget', 'confirm']);
  });

  it('charge la session et affiche le contrôle du relevé', async () => {
    api.session.and.returnValue(of(session()));
    await create();

    expect(api.session).toHaveBeenCalledOnceWith('sess-1');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-statement-check"]')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-lines-table"]')).toBeTruthy();
  });

  it("affiche l'erreur si le chargement de la session échoue", async () => {
    api.session.and.returnValue(throwError(() => new BankStatementImportError('Oups', 'bank_statement_import.unknown', 500)));
    await create();

    expect(component.error()).toBeTruthy();
  });

  it('relance le sondage pendant la lecture IA (Extracting) puis recharge la session', fakeAsync(() => {
    api.session.and.returnValues(of(session({ status: 'Extracting', progressPercent: 40, canConfirm: false })), of(session()));
    create();
    tick();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-ai-progress"]')).toBeTruthy();

    tick(2_000);
    fixture.detectChanges();
    expect(api.session).toHaveBeenCalledTimes(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-statement-check"]')).toBeTruthy();
  }));

  it('permet de corriger une ligne (date/libellé/montant) et envoie la correction à la confirmation', async () => {
    api.session.and.returnValue(of(session()));
    api.confirm.and.returnValue(of({ statementId: 'st-1', lineCount: 1, alreadyImportedCount: 0 }));
    await create();

    const displayed = component.displayLines()[0];
    component.startLineEdit(displayed);
    expect(component.editingIndex()).toBe(0);

    component.draft.label = 'Virement client Alpha';
    component.draft.amount = 200;
    component.saveLineEdit(displayed);

    expect(component.editingIndex()).toBeNull();
    expect(component.correctedCount()).toBe(1);
    expect(component.displayLines()[0].label).toBe('Virement client Alpha');
    expect(component.displayLines()[0].corrected).toBeTrue();

    component.confirmStatement();
    expect(api.confirm).toHaveBeenCalledOnceWith('sess-1', {
      corrections: [{ lineIndex: 0, label: 'Virement client Alpha', amount: 200 }],
      acknowledgeBalanceWarning: undefined
    });
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-entries/statement', 'st-1'], { replaceUrl: true });
  });

  it('ne permet pas de corriger une ligne lue directement (Layout)', async () => {
    api.session.and.returnValue(of(session({ extraction: { ...session().extraction!, lines: [line({ source: 'Layout' })] } })));
    await create();

    const displayed = component.displayLines()[0];
    expect(component.isEditable(displayed)).toBeFalse();
    component.startLineEdit(displayed);
    expect(component.editingIndex()).toBeNull();
  });

  it('exclut puis rétablit une ligne', async () => {
    api.session.and.returnValue(of(session()));
    await create();

    const displayed = component.displayLines()[0];
    component.toggleExclude(displayed);
    expect(component.excludedCount()).toBe(1);
    expect(component.displayLines()[0].excluded).toBeTrue();

    component.toggleExclude(component.displayLines()[0]);
    expect(component.excludedCount()).toBe(0);
  });

  it('affiche le titre du signalement et un bouton « Corriger cette ligne » pour une ligne modifiable', async () => {
    api.session.and.returnValue(
      of(
        session({
          extraction: { ...session().extraction!, issues: [issue({ code: 'statement.ai_line_needs_review', lineIndex: 0 })] }
        })
      )
    );
    await create();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('[data-testid="bse-session-issues"]')?.textContent).toContain('Ligne à corriger');
    const button = html.querySelector('[data-testid="bse-correct-line-0"]');
    expect(button).toBeTruthy();
    (button?.querySelector('button') as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
    expect(component.editingIndex()).toBe(0);
  });

  it('exige un sens explicite pour une ligne « débit et crédit renseignés » avant de pouvoir enregistrer', async () => {
    api.session.and.returnValue(
      of(
        session({
          extraction: {
            ...session().extraction!,
            issues: [issue({ code: 'tabular_both_sides', lineIndex: 0, severity: 'Blocking' })]
          }
        })
      )
    );
    await create();

    const displayed = component.displayLines()[0];
    component.startLineEdit(displayed);
    expect(component.draft.sideChosen).toBeFalse();
    expect(component.draftValid()).toBeFalse();

    component.onSideChange(true);
    expect(component.draft.sideChosen).toBeTrue();
    expect(component.draftValid()).toBeTrue();

    component.saveLineEdit(displayed);
    // Le sens doit figurer dans la correction même s'il est identique à la lecture d'origine,
    // sans quoi le serveur ne lève pas le signalement « tabular_both_sides ».
    expect(component.corrections().get(0)?.isDebit).toBe(true);
  });

  it("relance l'analyse (retry) pour une session Failed avec un code retryable", async () => {
    const failed = session({ status: 'Failed', errorCode: 'ai_timeout', canConfirm: false, balanceCheck: null });
    api.session.and.returnValue(of(failed));
    api.retry.and.returnValue(of(session({ id: 'sess-2' })));
    await create();

    expect(component.canRetry(failed)).toBeTrue();
    component.retry();
    expect(api.retry).toHaveBeenCalledOnceWith('sess-1');
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-entries/session', 'sess-2'], { replaceUrl: true });
  });

  it('ne propose pas de relance pour une session Failed non retryable', async () => {
    const failed = session({ status: 'Failed', errorCode: 'statement.unreadable', canConfirm: false, balanceCheck: null });
    api.session.and.returnValue(of(failed));
    await create();

    expect(component.canRetry(failed)).toBeFalse();
  });

  it('suggère un compte de relance (RIB identique) pour un relevé PDF, et navigue vers la nouvelle session', async () => {
    const matchingAccount = {
      id: 'bank-2',
      companyId: 'c-1',
      bankCode: '10',
      bankName: 'BIAT',
      designation: null,
      agencyName: null,
      rib: '10006012345678901234',
      iban: 'TN5910006012345678901234',
      swiftBic: null,
      isDefault: false,
      isActive: true,
      chartOfAccountNumber: '532200',
      currency: 'TND',
      hasBankingIdentity: true
    };
    accounting.listImportableBankAccounts.and.returnValue(
      of({ success: true, data: [{ id: 'bank-2', bankName: 'BIAT', chartOfAccountNumber: '532200', currency: 'TND', isActive: true, isDefault: false, hasBankingIdentity: true }], message: null, errors: [] })
    );
    bankAccountsApi.list.and.returnValue(of({ success: true, data: [matchingAccount], message: null, errors: [] }));

    const withRibMismatch = session({
      bankAccountId: 'bank-1',
      extraction: {
        ...session().extraction!,
        header: { ...session().extraction!.header, rib: '10006012345678901234' },
        issues: [issue({ code: 'statement.rib_mismatch', severity: 'Blocking', lineIndex: null })]
      }
    });
    api.session.and.returnValue(of(withRibMismatch));
    api.retarget.and.returnValue(of(session({ id: 'sess-3' })));
    await create();

    expect(component.suggestedRetargetAccount()?.id).toBe('bank-2');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-retarget-suggestion"]')).toBeTruthy();

    component.retargetToAccount('bank-2');
    expect(api.retarget).toHaveBeenCalledOnceWith('sess-1', 'bank-2');
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-entries/session', 'sess-3'], { replaceUrl: true });
  });

  it('ne suggère jamais de relance ciblée pour un relevé CSV/XLSX', async () => {
    const tabular = session({
      extractionMethod: 'csv',
      extraction: {
        ...session().extraction!,
        header: { ...session().extraction!.header, rib: '10006012345678901234' },
        lines: [line({ source: 'Tabular' })],
        issues: [issue({ code: 'statement.rib_mismatch', severity: 'Blocking' })]
      }
    });
    api.session.and.returnValue(of(tabular));
    await create();

    expect(component.isTabularSession(tabular)).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-retarget-suggestion"]')).toBeFalsy();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-retarget-missing"]')).toBeFalsy();
  });

  it('les lignes Tabular restent corrigeables', async () => {
    const tabular = session({ extractionMethod: 'csv', extraction: { ...session().extraction!, lines: [line({ source: 'Tabular' })] } });
    api.session.and.returnValue(of(tabular));
    await create();

    expect(component.isEditable(component.displayLines()[0])).toBeTrue();
  });

  it('affiche la bannière des relevés frères (fichier à plusieurs relevés)', async () => {
    api.session.and.returnValue(
      of(
        session({
          segmentIndex: 1,
          segmentCount: 2,
          siblings: [{ id: 'sib-1', segmentIndex: 2, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'AwaitingReview', statementId: null }]
        })
      )
    );
    await create();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('[data-testid="bse-siblings"]')).toBeTruthy();
    expect(html.querySelector('[data-testid="bse-siblings"]')?.textContent).toContain('en attente de contrôle');
  });

  it("respecte le solde serveur (canConfirm/requiresBalanceAcknowledgement) sans le recalculer côté client", async () => {
    api.session.and.returnValue(
      of(
        session({
          canConfirm: true,
          requiresBalanceAcknowledgement: true,
          balanceCheck: { sumDebits: 0, sumCredits: 150, computedClosing: 1140, difference: 10, isBalanced: false }
        })
      )
    );
    await create();

    const innerButton = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-confirm-statement"] button') as HTMLButtonElement;
    expect(innerButton().disabled).toBeTrue();

    component.balanceAcknowledged = true;
    fixture.detectChanges();
    expect(innerButton().disabled).toBeFalse();
  });

  it('signale la page comme non enregistrable (isDirty/canDeactivate) après une correction', async () => {
    api.session.and.returnValue(of(session()));
    await create();

    expect(component.canDeactivate()).toBeTrue();
    const displayed = component.displayLines()[0];
    component.toggleExclude(displayed);
    expect(component.isDirty()).toBeTrue();
    spyOn(window, 'confirm').and.returnValue(true);
    expect(component.canDeactivate()).toBeTrue();
    expect(window.confirm).toHaveBeenCalled();
  });
});
