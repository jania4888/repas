import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BankStatementEntriesPostingComponent } from './bank-statement-entries-posting.component';
import { BankStatementEntriesStore } from './bank-statement-entries.store';
import { BankStatementImportError, BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { EntryReferenceStore } from '../manual-entry/services/entry-reference.store';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { EmployeeService } from '@core/services/employee.service';
import { AccountingService } from '../services/accounting.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { BankLineProposal, BankStatementProposals, GenerateResult } from '../bank-statement-import/bank-statement-import.models';

function proposal(overrides: Partial<BankLineProposal> = {}): BankLineProposal {
  return {
    lineId: 'l-1',
    transactionDate: '2026-09-01T00:00:00',
    valueDate: null,
    label: 'VIR RECU STE ALPHA',
    reference: '',
    amount: 4760,
    isDebit: false,
    isReconciled: false,
    status: 'Proposed',
    confidence: 'Probable',
    source: 'Catalog',
    explanation: '',
    accountNumber: '627800',
    accountLabel: 'Frais bancaires',
    accountStatus: 'found',
    thirdPartyId: null,
    thirdPartyKind: 'None',
    thirdPartyName: null,
    requiresThirdParty: false,
    vatSplit: null,
    existingEntry: null,
    generatedEntry: null,
    candidateCount: 0,
    diagnostics: [],
    selectedByDefault: true,
    ...overrides
  };
}

function proposals(lines: BankLineProposal[]): BankStatementProposals {
  return {
    statementId: 'st-1',
    bankAccountId: 'bank-1',
    bankName: 'STB',
    bankGlAccount: '532100',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    openingBalance: 0,
    closingBalance: 0,
    lines,
    unclassifiedDistinctLabels: 0
  };
}

function generateResult(overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    created: 1,
    skipped: 0,
    failed: 0,
    firstEntryNumber: 10,
    lastEntryNumber: 10,
    outcomes: [],
    atomic: true,
    committed: true,
    ...overrides
  };
}

describe('BankStatementEntriesPostingComponent', () => {
  let fixture: ComponentFixture<BankStatementEntriesPostingComponent>;
  let component: BankStatementEntriesPostingComponent;
  let api: jasmine.SpyObj<BankStatementImportService>;
  let router: Router;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let confirmation: { confirm: jasmine.Spy };

  const accounts = [
    { accountNumber: '411000', label: 'Clients', isActive: true },
    { accountNumber: '627800', label: 'Frais bancaires', isActive: true }
  ];

  const refs = {
    loadAll: jasmine.createSpy('loadAll'),
    accounts: signal(accounts),
    findAccountByNumber: (n: string) => accounts.find(a => a.accountNumber === n),
    searchThirdParties: jasmine.createSpy('searchThirdParties'),
    thirdPartySuggestions: signal([])
  };

  async function create(statementId = 'st-1'): Promise<void> {
    params = new BehaviorSubject(convertToParamMap({ statementId }));
    await TestBed.configureTestingModule({
      imports: [BankStatementEntriesPostingComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: BankStatementImportService, useValue: api },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: AuthService, useValue: { hasPermission: () => false } },
        { provide: EmployeeService, useValue: jasmine.createSpyObj('EmployeeService', ['list']) },
        {
          provide: AccountingService,
          useValue: { getChartOfAccounts: () => of(null), getPeriods: () => of(null), getJournals: () => of(null), getCurrencies: () => of(null) }
        },
        { provide: AccountingJournalCatalogService, useValue: { list: () => of([]) } }
      ]
    })
      .overrideComponent(BankStatementEntriesPostingComponent, { set: { providers: [BankStatementEntriesStore, { provide: EntryReferenceStore, useValue: refs }] } })
      .compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BankStatementEntriesPostingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    confirmation = { confirm: jasmine.createSpy('confirm').and.callFake((c: { accept?: () => void }) => c.accept?.()) };
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', [
      'proposals',
      'generate',
      'sourceFile',
      'capabilities',
      'classifyWithAi'
    ]);
    api.capabilities.and.returnValue(of(null));
  });

  it("charge les propositions avec assist=true et affiche la grille", async () => {
    api.proposals.and.returnValue(of(proposals([proposal()])));
    await create();

    expect(api.proposals).toHaveBeenCalledOnceWith('st-1', { assist: true });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-rows-table"]')).toBeTruthy();
  });

  it("affiche l'erreur si le chargement des propositions échoue", async () => {
    api.proposals.and.returnValue(throwError(() => new BankStatementImportError('Oups', 'bank_statement_import.unknown', 500)));
    await create();

    expect(component.error()).toBeTruthy();
  });

  it('filtre les lignes affichées selon store.rowFilter', async () => {
    api.proposals.and.returnValue(
      of(
        proposals([
          proposal({ lineId: 'l-1', status: 'Proposed' }),
          proposal({ lineId: 'l-2', status: 'ToComplete', accountNumber: null as unknown as string, accountStatus: 'missing' })
        ])
      )
    );
    await create();

    expect(component.store.visibleRows().length).toBe(2);
    component.store.rowFilter.set('todo');
    expect(component.store.visibleRows().map(r => r.proposal.lineId)).toEqual(['l-2']);
  });

  it('applique le compte en masse aux lignes sélectionnées non déjà comptabilisées', async () => {
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 'l-1' }), proposal({ lineId: 'l-2' })])));
    await create();

    component.store.setRowSelected('l-1', true);
    component.store.setRowSelected('l-2', true);
    component.bulkAccount = '627800';
    component.applyBulkAccount();

    expect(component.store.rows().every(r => r.account === '627800')).toBeTrue();
  });

  it("bloque la génération si une ligne sélectionnée n'est pas prête (compte/tiers manquant)", async () => {
    api.proposals.and.returnValue(
      of(proposals([proposal({ lineId: 'l-1', accountNumber: null as unknown as string, accountStatus: 'missing', selectedByDefault: true })]))
    );
    await create();
    component.store.setRowSelected('l-1', true);

    component.generate();

    expect(component.error()).toBeTruthy();
    expect(api.generate).not.toHaveBeenCalled();
  });

  it('déclenche un unique appel atomique generate() avec assist/excludedLineIds et affiche le succès', async () => {
    api.proposals.and.returnValue(
      of(
        proposals([
          proposal({ lineId: 'l-1', selectedByDefault: true }),
          proposal({ lineId: 'l-2', selectedByDefault: false })
        ])
      )
    );
    api.generate.and.returnValue(of(generateResult({ created: 1, firstEntryNumber: 10, lastEntryNumber: 10, committed: true })));
    await create();

    component.store.setRowSelected('l-1', true);
    component.store.setRowSelected('l-2', false);
    component.generate();

    expect(api.generate).toHaveBeenCalledTimes(1);
    const [statementId, journal, items, options] = api.generate.calls.mostRecent().args;
    expect(statementId).toBe('st-1');
    expect(journal).toBe('JB');
    expect(items.map((i: { lineId: string }) => i.lineId)).toEqual(['l-1']);
    expect(options).toEqual(jasmine.objectContaining({ atomic: true, assist: true, excludedLineIds: ['l-2'] }));

    expect(component.view()).toBe('result');
    expect(component.store.atomicRejected()).toBeFalse();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-result-success"]')).toBeTruthy();
  });

  it('affiche le refus atomique (tout ou rien) et permet de revenir à la grille', async () => {
    // Le serveur renvoie le refus atomique en erreur HTTP 400 (code atomic_rejected), le résultat
    // complet voyageant dans la charge utile de l'erreur — pas en succès avec committed:false.
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 'l-1', selectedByDefault: true })])));
    const rejected = generateResult({
      created: 0,
      committed: false,
      code: 'bank_statement_posting.atomic_rejected',
      outcomes: [{ lineId: 'l-1', outcome: 'failed', code: 'account_inactive', message: 'Compte inactif', journalEntryId: null, entryNumber: null }]
    });
    api.generate.and.returnValue(
      throwError(() => new BankStatementImportError('Refusé', 'bank_statement_posting.atomic_rejected', 400, rejected))
    );
    await create();
    component.store.setRowSelected('l-1', true);

    component.generate();

    expect(component.store.atomicRejected()).toBeTrue();
    expect(component.store.rejectedOutcomes().length).toBe(1);
    // Rien n'a été écrit côté serveur pour un refus de pré-validation : pas de nouvelle lecture.
    expect(api.proposals).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="bse-result-failed"]')).toBeTruthy();

    component.backToGrid();
    expect(component.view()).toBe('grid');
  });

  it('relit les propositions avant toute nouvelle tentative après une erreur réseau', async () => {
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 'l-1', selectedByDefault: true })])));
    api.generate.and.returnValue(throwError(() => new BankStatementImportError('Réseau', 'bank_statement_import.network', 0)));
    await create();
    component.store.setRowSelected('l-1', true);

    component.generate();

    expect(api.proposals).toHaveBeenCalledTimes(2);
    expect(component.view()).toBe('grid');
  });

  it('relit les propositions après un conflit atomique (409) mais pas après une couverture incomplète (400)', async () => {
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 'l-1', selectedByDefault: true })])));
    api.generate.and.returnValue(
      throwError(() => new BankStatementImportError('Conflit', 'bank_statement_posting.atomic_conflict', 409))
    );
    await create();
    component.store.setRowSelected('l-1', true);

    component.generate();

    expect(api.proposals).toHaveBeenCalledTimes(2);
    expect(component.view()).toBe('grid');

    api.generate.and.returnValue(
      throwError(() => new BankStatementImportError('Incomplet', 'bank_statement_posting.atomic_incomplete', 400, { missingLineIds: ['l-2'] }))
    );
    component.generate();

    // Rien n'a été tenté côté serveur pour une couverture incomplète : pas de nouvelle lecture.
    expect(api.proposals).toHaveBeenCalledTimes(2);
    expect(component.view()).toBe('grid');
    expect(component.error()).toBeTruthy();

    // Écran périmé (une ligne à la fois cochée et exclue) : pré-validation HTTP 400, rien n'a été
    // tenté côté serveur, donc pas de nouvelle lecture non plus.
    api.generate.and.returnValue(
      throwError(
        () => new BankStatementImportError('Chevauchement', 'bank_statement_posting.atomic_overlap', 400, { overlappingLineIds: ['l-1'] })
      )
    );
    component.generate();

    expect(api.proposals).toHaveBeenCalledTimes(2);
    expect(component.view()).toBe('grid');
    expect(component.error()).toBeTruthy();
  });

  it('affiche les plages de numéros par exercice quand la génération couvre plusieurs exercices', async () => {
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 'l-1', selectedByDefault: true })])));
    api.generate.and.returnValue(
      of(
        generateResult({
          created: 2,
          firstEntryNumber: null,
          lastEntryNumber: null,
          entryNumberRangesByYear: [
            { fiscalYear: 2025, first: 118, last: 118 },
            { fiscalYear: 2026, first: 1, last: 1 }
          ],
          committed: true
        })
      )
    );
    await create();
    component.store.setRowSelected('l-1', true);

    component.generate();
    fixture.detectChanges();

    const ranges = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="bse-entry-ranges"] li');
    expect(ranges.length).toBe(2);
    expect(ranges[0].textContent).toContain('2025');
    expect(ranges[1].textContent).toContain('2026');
  });
});
