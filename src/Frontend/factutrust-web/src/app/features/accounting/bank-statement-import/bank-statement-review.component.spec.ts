import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BankStatementReviewComponent } from './bank-statement-review.component';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { EntryReferenceStore } from '../manual-entry/services/entry-reference.store';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { EmployeeService } from '@core/services/employee.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ThirdPartyRef } from '../manual-entry/models/entry-form.model';
import {
  BankLineProposal,
  BankStatementImportSession,
  BankStatementProposals,
  GenerateItem,
  GenerateResult
} from './bank-statement-import.models';

function proposal(overrides: Partial<BankLineProposal> = {}): BankLineProposal {
  return {
    lineId: 'l-1',
    transactionDate: '2026-03-02T00:00:00',
    valueDate: null,
    label: 'COMMISSION TENUE DE COMPTE',
    reference: '',
    amount: 10,
    isDebit: true,
    isReconciled: false,
    status: 'Proposed',
    confidence: 'Probable',
    source: 'Catalog',
    explanation: 'Frais bancaires',
    accountNumber: '6278',
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
    bankGlAccount: '53210001',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    openingBalance: 100,
    closingBalance: 90,
    lines,
    unclassifiedDistinctLabels: 0
  };
}

function session(overrides: Partial<BankStatementImportSession> = {}): BankStatementImportSession {
  return {
    id: 's-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'bank-1',
    journalCode: 'JB',
    fileName: 'releve.pdf',
    pageCount: 1,
    extractionMethod: 'layout',
    profileId: 'stb-historique',
    aiProviderKind: null,
    errorCode: null,
    statementId: null,
    expiresAt: '2026-03-03T00:00:00',
    extraction: {
      header: {
        rib: '10006035123456789012',
        bankCode: '10',
        currency: 'TND',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: { value: 100, printedDecimals: 3, signSource: 'Column' },
        closingBalance: { value: 90, printedDecimals: 3, signSource: 'Column' },
        totalDebits: null,
        totalCredits: null,
        totalsLabelled: false
      },
      lines: [
        {
          index: 0,
          pageNumber: 1,
          transactionDate: '2026-03-02',
          valueDate: null,
          label: 'COMMISSION',
          labelLines: ['COMMISSION'],
          amount: 10,
          isDebit: true,
          source: 'Layout'
        }
      ],
      issues: [],
      profileId: 'stb-historique',
      pageCount: 1,
      unresolvedPages: []
    },
    balanceCheck: { sumDebits: 10, sumCredits: 0, computedClosing: 90, difference: 0, isBalanced: true },
    canConfirm: true,
    ...overrides
  };
}

const accounts = [
  { accountNumber: '6278', label: 'Frais bancaires', isActive: true },
  { accountNumber: '4011', label: 'Fournisseurs', isActive: true },
  { accountNumber: '425', label: 'Personnel', isActive: true }
];

describe('BankStatementReviewComponent', () => {
  let fixture: ComponentFixture<BankStatementReviewComponent>;
  let component: BankStatementReviewComponent;
  let api: jasmine.SpyObj<BankStatementImportService>;
  let router: Router;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let employees: jasmine.SpyObj<EmployeeService>;
  let permissions: string[];
  const thirdPartySuggestions = signal<ThirdPartyRef[]>([]);

  const refs = {
    loadAll: jasmine.createSpy('loadAll'),
    accounts: signal(accounts),
    journalOptions: () => [{ code: 'JB', label: 'Journal de Banque' }],
    findAccountByNumber: (n: string) => accounts.find(a => a.accountNumber === n),
    searchThirdParties: jasmine.createSpy('searchThirdParties'),
    thirdPartySuggestions
  };

  async function create(route: { sessionId?: string; statementId?: string }): Promise<void> {
    params = new BehaviorSubject(convertToParamMap(route));
    await TestBed.configureTestingModule({
      imports: [BankStatementReviewComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: BankStatementImportService, useValue: api },
        { provide: ConfirmationService, useValue: { confirm: (c: { accept?: () => void }) => c.accept?.() } },
        { provide: AuthService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: EmployeeService, useValue: employees }
      ]
    })
      .overrideComponent(BankStatementReviewComponent, { set: { providers: [{ provide: EntryReferenceStore, useValue: refs }] } })
      .compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BankStatementReviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = [PERMISSIONS.accounting.create];
    thirdPartySuggestions.set([]);
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', [
      'capabilities',
      'session',
      'cancel',
      'confirm',
      'proposals',
      'classifyWithAi',
      'generate',
      'sourceFile'
    ]);
    api.capabilities.and.returnValue(of(null));
    employees = jasmine.createSpyObj<EmployeeService>('EmployeeService', ['list']);
  });

  // ── Session ──────────────────────────────────────────────────────────────────────────

  it('affiche le contrôle de solde et enregistre le relevé avant de passer aux propositions', async () => {
    api.session.and.returnValue(of(session()));
    api.confirm.and.returnValue(of({ statementId: 'st-9', lineCount: 1, alreadyImportedCount: 0 }));
    await create({ sessionId: 's-1' });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Soldes contrôlés');
    expect(text).not.toContain('10006035123456789012');

    component.confirmStatement();

    expect(api.confirm).toHaveBeenCalledOnceWith('s-1');
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/statement', 'st-9'], jasmine.objectContaining({ replaceUrl: true }));
  });

  it('refuse l’enregistrement quand le serveur ne l’autorise pas', async () => {
    api.session.and.returnValue(
      of(session({ canConfirm: false, balanceCheck: { sumDebits: 10, sumCredits: 0, computedClosing: 90, difference: 0.001, isBalanced: false } }))
    );
    await create({ sessionId: 's-1' });

    component.confirmStatement();

    expect(api.confirm).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Contrôle de solde en échec');
  });

  it('interroge la session tant que la lecture IA est en cours', fakeAsync(() => {
    api.session.and.returnValues(of(session({ status: 'Extracting', progressPercent: 40, extraction: null })), of(session()));
    void create({ sessionId: 's-1' });
    tick();

    expect(api.session).toHaveBeenCalledTimes(1);
    tick(2_000);
    expect(api.session).toHaveBeenCalledTimes(2);
    tick(20_000);
    expect(api.session).toHaveBeenCalledTimes(2);
  }));

  it('redirige vers les propositions quand la session est déjà confirmée', async () => {
    api.session.and.returnValue(of(session({ status: 'Confirmed', statementId: 'st-3' })));
    await create({ sessionId: 's-1' });

    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/statement', 'st-3'], { replaceUrl: true });
  });

  it('signale les autres relevés du même fichier et transmet ceux qui restent à contrôler', async () => {
    api.session.and.returnValue(
      of(
        session({
          segmentIndex: 1,
          segmentCount: 3,
          siblings: [
            { id: 's-2', segmentIndex: 2, periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'AwaitingReview', statementId: null },
            { id: 's-3', segmentIndex: 3, periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'Confirmed', statementId: 'st-3' }
          ]
        })
      )
    );
    api.confirm.and.returnValue(of({ statementId: 'st-1', lineCount: 1, alreadyImportedCount: 0 }));
    await create({ sessionId: 's-1' });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ce fichier contient 3 relevés');
    expect(component.siblingLink(component.session()!.siblings![0])).toEqual(['/accounting/bank-statement-import/session', 's-2']);
    expect(component.siblingLink(component.session()!.siblings![1])).toEqual(['/accounting/bank-statement-import/statement', 'st-3']);

    component.confirmStatement();

    const extras = (router.navigate as jasmine.Spy).calls.mostRecent().args[1];
    expect(extras.state.pendingSiblings.map((x: { id: string }) => x.id)).toEqual(['s-2']);
  });

  it('affiche un message de reconnexion sur un 403', async () => {
    api.session.and.returnValue(throwError(() => new BankStatementImportError('', null, 403)));
    await create({ sessionId: 's-1' });

    expect(component.error()).toContain('reconnectez-vous');
  });

  // ── Propositions et génération ───────────────────────────────────────────────────────

  it('pré-coche les propositions sûres et ne rend pas sélectionnables les lignes déjà traitées', async () => {
    api.proposals.and.returnValue(
      of(
        proposals([
          proposal({ lineId: 'a' }),
          proposal({ lineId: 'b', status: 'AlreadyPosted', selectedByDefault: false }),
          proposal({ lineId: 'c', status: 'ToComplete', accountNumber: null, selectedByDefault: false })
        ])
      )
    );
    await create({ statementId: 'st-1' });

    const rows = component.rows();
    expect(rows.map(r => r.selected)).toEqual([true, false, false]);
    expect(component.isSettled(rows[1])).toBeTrue();
    expect(component.selectedCount()).toBe(1);
    expect(component.counts()).toEqual({ todo: 1, proposed: 1, settled: 1 });
  });

  it('envoie le tiers sous son nom d’énumération et jamais le montant ni la date', async () => {
    api.proposals.and.returnValue(
      of(
        proposals([
          proposal({
            lineId: 'p',
            accountNumber: '4011',
            requiresThirdParty: true,
            thirdPartyId: 'sup-1',
            thirdPartyKind: 'Supplier',
            thirdPartyName: 'ACME'
          })
        ])
      )
    );
    api.generate.and.returnValue(of({ created: 1, skipped: 0, failed: 0, firstEntryNumber: 1, lastEntryNumber: 1, outcomes: [] }));
    await create({ statementId: 'st-1' });

    component.generate();

    const [statementId, journal, items] = api.generate.calls.mostRecent().args;
    expect(statementId).toBe('st-1');
    expect(journal).toBe('JB');
    expect(items).toEqual([
      {
        lineId: 'p',
        accountNumber: '4011',
        thirdPartyId: 'sup-1',
        thirdPartyKind: 'Supplier',
        vatAmount: null,
        vatAccountNumber: null,
        label: null,
        rememberRule: false
      }
    ]);
    expect(JSON.stringify(items)).not.toMatch(/"amount"|transactionDate/);
  });

  it('bloque la génération d’une ligne collective sans tiers', async () => {
    api.proposals.and.returnValue(
      of(proposals([proposal({ lineId: 'x', accountNumber: '4011', requiresThirdParty: true, selectedByDefault: false })]))
    );
    await create({ statementId: 'st-1' });
    component.rows()[0].selected = true;

    component.generate();

    expect(api.generate).not.toHaveBeenCalled();
    expect(component.error()).toContain('sans compte valide ou sans tiers');
  });

  it('découpe la génération en lots de 200 et cumule le bilan', async () => {
    const lines = Array.from({ length: 250 }, (_, i) => proposal({ lineId: `l-${i}` }));
    api.proposals.and.returnValue(of(proposals(lines)));
    api.generate.and.callFake((_id: string, _journal: string, items: GenerateItem[]) =>
      of<GenerateResult>({ created: items.length, skipped: 0, failed: 0, firstEntryNumber: 1, lastEntryNumber: items.length, outcomes: [] })
    );
    await create({ statementId: 'st-1' });

    component.generate();

    expect(api.generate.calls.count()).toBe(2);
    expect(api.generate.calls.argsFor(0)[2].length).toBe(200);
    expect(api.generate.calls.argsFor(1)[2].length).toBe(50);
    expect(component.lastGeneration()?.created).toBe(250);
    expect(api.proposals).toHaveBeenCalledTimes(2);
  });

  it('ne ventile la TVA que si l’utilisateur garde la case cochée', async () => {
    api.proposals.and.returnValue(
      of(proposals([proposal({ lineId: 'v', amount: 1.785, vatSplit: { netAmount: 1.5, vatAmount: 0.285, vatAccountNumber: '43666', implied: false } })]))
    );
    api.generate.and.returnValue(of({ created: 1, skipped: 0, failed: 0, firstEntryNumber: 1, lastEntryNumber: 1, outcomes: [] }));
    await create({ statementId: 'st-1' });

    expect(component.rows()[0].splitVat).toBeTrue();
    component.generate();
    expect(api.generate.calls.mostRecent().args[2][0].vatAmount).toBe(0.285);

    component.rows()[0].splitVat = false;
    component.rows()[0].selected = true;
    component.generate();
    expect(api.generate.calls.mostRecent().args[2][0].vatAmount).toBeNull();
  });

  it('explique l’absence de pièce justificative pour un relevé importé par un autre parcours', async () => {
    api.proposals.and.returnValue(of(proposals([proposal()])));
    api.sourceFile.and.returnValue(throwError(() => new BankStatementImportError('', null, 404)));
    await create({ statementId: 'st-1' });

    component.downloadSource();

    expect(api.sourceFile).toHaveBeenCalledOnceWith('st-1');
    expect(component.error()).toContain("n'a pas été importé par l'import IA");
  });

  // ── Recherche de salariés ────────────────────────────────────────────────────────────

  it('ne cherche les salariés qu’avec le droit de lecture de la paie', async () => {
    api.proposals.and.returnValue(of(proposals([proposal({ lineId: 's', accountNumber: '425', requiresThirdParty: true })])));
    await create({ statementId: 'st-1' });
    const row = component.rows()[0];

    component.searchThirdParty(row, 'Ben Ali');
    expect(employees.list).not.toHaveBeenCalled();
    expect(refs.searchThirdParties).not.toHaveBeenCalledWith('Ben Ali');

    permissions.push(PERMISSIONS.payroll.read);
    employees.list.and.returnValue(
      of({ success: true, data: { items: [{ id: 'e-1', employeeNumber: 'M01', fullName: 'Ali Ben Ali' }] } }) as unknown as ReturnType<
        EmployeeService['list']
      >
    );
    component.searchThirdParty(row, 'Ben Ali');

    expect(employees.list).toHaveBeenCalledOnceWith('Ben Ali', true, 1, 10);
    const suggestions = component.thirdPartySuggestions(row);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].kind).toBe(3);

    component.pickThirdParty(row, suggestions[0]);
    expect(row.thirdPartyId).toBe('e-1');
  });

  it('retire un tiers incompatible quand le compte change', async () => {
    api.proposals.and.returnValue(
      of(proposals([proposal({ lineId: 't', accountNumber: '4011', thirdPartyId: 'sup-1', thirdPartyKind: 'Supplier', thirdPartyName: 'ACME' })]))
    );
    await create({ statementId: 'st-1' });
    const row = component.rows()[0];

    row.account = '425';
    component.onAccountChanged(row);

    expect(row.thirdPartyId).toBeNull();
    expect(row.thirdPartyName).toBe('');
  });
});
