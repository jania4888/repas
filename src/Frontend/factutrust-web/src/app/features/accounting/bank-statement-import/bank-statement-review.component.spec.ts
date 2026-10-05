import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BankStatementReviewComponent } from './bank-statement-review.component';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { EntryReferenceStore } from '../manual-entry/services/entry-reference.store';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { EmployeeService } from '@core/services/employee.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ThirdPartyRef } from '../manual-entry/models/entry-form.model';
import {
  BankLineProposal,
  BankStatementAiPlan,
  BankStatementImportSession,
  BankStatementPageReading,
  BankStatementProposals,
  ExtractedStatementLine,
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
  let bankAccounts: Partial<BankAccountDto>[];
  let confirmation: { confirm: jasmine.Spy };
  const thirdPartySuggestions = signal<ThirdPartyRef[]>([]);

  const refs = {
    loadAll: jasmine.createSpy('loadAll'),
    accounts: signal(accounts),
    journalOptions: () => [{ code: 'JB', label: 'Journal de Banque' }],
    findAccountByNumber: (n: string) => accounts.find(a => a.accountNumber === n),
    searchThirdParties: jasmine.createSpy('searchThirdParties'),
    thirdPartySuggestions
  };

  async function create(route: { sessionId?: string; statementId?: string }, query?: Record<string, string>): Promise<void> {
    params = new BehaviorSubject(convertToParamMap(route));
    const activatedRoute = query
      ? { paramMap: params.asObservable(), snapshot: { queryParamMap: convertToParamMap(query) } }
      : { paramMap: params.asObservable() };
    await TestBed.configureTestingModule({
      imports: [BankStatementReviewComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: BankStatementImportService, useValue: api },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: AuthService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: EmployeeService, useValue: employees },
        { provide: BankAccountService, useValue: { list: () => of({ success: true, data: bankAccounts }) } }
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
    bankAccounts = [];
    confirmation = { confirm: jasmine.createSpy('confirm').and.callFake((c: { accept?: () => void }) => c.accept?.()) };
    thirdPartySuggestions.set([]);
    api = jasmine.createSpyObj<BankStatementImportService>('BankStatementImportService', [
      'capabilities',
      'session',
      'cancel',
      'confirm',
      'proposals',
      'classifyWithAi',
      'generate',
      'sourceFile',
      'retry',
      'retarget'
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

    expect(api.confirm).toHaveBeenCalledOnceWith('s-1', { corrections: [] });
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/statement', 'st-9'], jasmine.objectContaining({ replaceUrl: true }));
  });

  // ── Ouvert depuis le rapprochement (tout document par l'IA) ─────────────────────────

  describe('ouvert depuis le rapprochement', () => {
    const fromReconciliation = { from: 'reconciliation' };

    it('revient au rapprochement sur le relevé enregistré', async () => {
      api.session.and.returnValue(of(session()));
      api.confirm.and.returnValue(of({ statementId: 'st-9', lineCount: 4, alreadyImportedCount: 1 }));
      await create({ sessionId: 's-1' }, fromReconciliation);

      component.confirmStatement();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/accounting/bank-reconciliation'], {
        replaceUrl: true,
        queryParams: { statementId: 'st-9' },
        state: { importedStatement: { lineCount: 4, alreadyImportedCount: 1 } }
      });
    });

    it('enchaîne sur le relevé suivant du même fichier avant de revenir', async () => {
      api.session.and.returnValue(
        of(session({ segmentIndex: 1, segmentCount: 2, siblings: [{ id: 's-2', segmentIndex: 2, periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'AwaitingReview', statementId: null }] }))
      );
      api.confirm.and.returnValue(of({ statementId: 'st-1', lineCount: 1, alreadyImportedCount: 0 }));
      await create({ sessionId: 's-1' }, fromReconciliation);

      component.confirmStatement();

      expect(router.navigate).toHaveBeenCalledOnceWith(['/accounting/bank-statement-import/session', 's-2'], {
        replaceUrl: true,
        queryParams: { from: 'reconciliation' }
      });
    });

    it('ouvre le rapprochement sur le premier relevé du fichier une fois tous enregistrés', async () => {
      api.session.and.returnValue(
        of(session({ segmentIndex: 2, segmentCount: 2, siblings: [{ id: 's-1', segmentIndex: 1, periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'Confirmed', statementId: 'st-7' }] }))
      );
      api.confirm.and.returnValue(of({ statementId: 'st-8', lineCount: 1, alreadyImportedCount: 0 }));
      await create({ sessionId: 's-2' }, fromReconciliation);

      component.confirmStatement();

      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-reconciliation'], jasmine.objectContaining({ queryParams: { statementId: 'st-7' } }));
    });

    it('renvoie au rapprochement une session déjà enregistrée', async () => {
      api.session.and.returnValue(of(session({ status: 'Confirmed', statementId: 'st-3' })));
      await create({ sessionId: 's-1' }, fromReconciliation);

      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-reconciliation'], jasmine.objectContaining({ queryParams: { statementId: 'st-3' } }));
    });

    it('annule et revient au rapprochement', async () => {
      api.session.and.returnValue(of(session({ status: 'Extracting', canConfirm: false })));
      api.cancel.and.returnValue(of(undefined));
      await create({ sessionId: 's-1' }, fromReconciliation);

      component.cancelSession();

      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-reconciliation']);
      fixture.destroy();
    });

    it('ignore une origine inconnue (liste blanche)', async () => {
      api.session.and.returnValue(of(session()));
      api.confirm.and.returnValue(of({ statementId: 'st-9', lineCount: 1, alreadyImportedCount: 0 }));
      await create({ sessionId: 's-1' }, { from: 'https://exemple.test' });

      component.confirmStatement();

      expect(component.origin()).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/statement', 'st-9'], jasmine.objectContaining({ replaceUrl: true }));
    });
  });

  it('annonce la relecture IA du relevé avec une durée estimée', async () => {
    const base = session();
    api.session.and.returnValue(
      of(
        session({
          status: 'Extracting',
          progressPercent: 50,
          canConfirm: false,
          extraction: {
            ...base.extraction!,
            aiPlan: { scannedPages: [], textPages: [1], reason: 'unverified', estimatedCalls: 5, estimatedSeconds: 600 }
          }
        })
      )
    );
    await create({ sessionId: 's-1' });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Relecture du relevé par l');
    expect(text).toContain('environ 5 min');
    fixture.destroy();
  });

  it('indique une lecture directe complétée par l’IA', async () => {
    const base = session();
    await create({ sessionId: 's-1' });
    const s = session({
      extractionMethod: 'layout+ai',
      aiProviderKind: 'local',
      extraction: { ...base.extraction!, aiPlan: { scannedPages: [], textPages: [1], reason: 'line_issues', estimatedCalls: 1, estimatedSeconds: 120 } }
    });

    expect(component.methodLabel(s)).toBe('Lecture directe complétée par l\'IA locale');
    expect(component.methodLabel({ ...s, extraction: base.extraction })).toContain('pages scannées');
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

  // ── Lecture IA seule (GLM-OCR page par page) ──────────────────────────────────────────

  describe('lecture IA seule (GLM-OCR)', () => {
    const base = session();
    const aiLine = (index: number, pageNumber: number, amount = 10): ExtractedStatementLine => ({
      index,
      pageNumber,
      transactionDate: '2026-03-02',
      valueDate: null,
      label: `OPERATION ${index}`,
      labelLines: [`OPERATION ${index}`],
      amount,
      isDebit: true,
      source: 'Ai'
    });
    const visionPlan = (overrides: Partial<BankStatementAiPlan> = {}): BankStatementAiPlan => ({
      scannedPages: [1, 2, 3, 4],
      textPages: [],
      reason: 'scanned' as const,
      estimatedCalls: 4,
      estimatedSeconds: 480,
      engine: 'vision' as const,
      mode: 'ai_only' as const,
      ...overrides
    });
    const reading = (page: number, engine: string, lineCount = 3): BankStatementPageReading => ({ page, engine, model: null, attempts: 1, durationMs: 1000, lineCount, failureReason: null });
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    const el = () => fixture.nativeElement as HTMLElement;

    it('affiche la page en cours, les pastilles de pages et le temps écoulé pendant la lecture', fakeAsync(() => {
      api.session.and.returnValue(
        of(
          session({
            status: 'Extracting',
            progressPercent: 50,
            pageCount: 4,
            canConfirm: false,
            extraction: { ...base.extraction!, lines: [], aiPlan: visionPlan({ pageReadings: [reading(1, 'glm-ocr'), reading(2, 'text-model')] }) }
          })
        )
      );
      void create({ sessionId: 's-1' });
      tick();
      fixture.detectChanges();

      expect(text()).toContain('Lecture des pages par GLM-OCR');
      expect(text()).toContain('page 3 sur 4');
      expect(text()).toContain('50 %');
      expect(text()).toContain('releve.pdf');
      expect(text()).toContain('environ 4 min');
      expect(el().querySelectorAll('.bsr-page').length).toBe(4);
      expect(el().querySelectorAll('.bsr-page.is-done').length).toBe(1);
      expect(el().querySelectorAll('.bsr-page.is-fallback').length).toBe(1);
      expect(el().querySelector('.bsr-page.is-current')?.textContent).toContain('Page 3 · en cours');
      expect(el().querySelector('.bsr-fallback-note')?.textContent).toContain('Pages 2 : GLM-OCR n\'a pas pu lire la page');
      expect(el().querySelector('.bsr-bar')?.getAttribute('aria-valuenow')).toBe('50');

      tick(3_000);
      fixture.detectChanges();
      expect(text()).toContain('3 s écoulées');

      fixture.destroy();
    }));

    it('décrit la méthode de lecture GLM-OCR et ses replis, et déduit la page en cours de l’avancement', async () => {
      api.session.and.returnValue(of(session()));
      await create({ sessionId: 's-1' });
      const vision = (pageCount: number, readings: BankStatementPageReading[] = []) =>
        session({ extractionMethod: 'ai-vision', pageCount, extraction: { ...base.extraction!, aiPlan: visionPlan({ pageReadings: readings }) } });

      expect(component.totalPages(session({ pageCount: 5, extraction: { ...base.extraction!, aiPlan: visionPlan({ scannedPages: [1, 2, 3, 4, 5] }) } }))).toBe(5);
      expect(component.currentPage(session({ status: 'Extracting', progressPercent: 40, pageCount: 5, extraction: { ...base.extraction!, aiPlan: visionPlan({ scannedPages: [1, 2, 3, 4, 5] }) } }))).toBe(3);
      expect(component.methodLabel(vision(3))).toBe('Lu par GLM-OCR (3 pages)');
      expect(component.methodLabel(vision(1))).toBe('Lu par GLM-OCR (1 page)');
      expect(component.methodLabel(vision(4, [reading(1, 'glm-ocr'), reading(2, 'text-model'), reading(3, 'text-model'), reading(4, 'glm-ocr-table')]))).toBe('Lu par GLM-OCR — pages 2, 3 relues par le modèle texte');
      expect(component.methodLabel(vision(4, [reading(1, 'glm-ocr'), reading(2, 'text-model')]))).toBe('Lu par GLM-OCR — page 2 relue par le modèle texte');
      expect(component.methodLabel(session({ extractionMethod: 'ai-text' }))).toBe('Lu par le modèle texte local (GLM-OCR indisponible)');
      expect(component.methodLabel(session({ extractionMethod: 'none' }))).toBe('Lecture IA non effectuée');
      expect(
        component.methodLabel(
          session({
            extractionMethod: 'ai-vision',
            extraction: { ...base.extraction!, issues: [{ code: 'statement.ai_unavailable', severity: 'Blocking', message: '', pageNumber: null, lineIndex: null }] }
          })
        )
      ).toBe('Lecture IA non effectuée');
      expect(component.methodLabel(session({ extractionMethod: 'layout' }))).toBe('Lecture directe du PDF (aucune IA)');
      expect(component.methodLabel(session({ extractionMethod: 'autre' }))).toBe('—');
    });

    it('signale les pages relues par le modèle texte et marque leurs opérations', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            pageCount: 2,
            extraction: {
              ...base.extraction!,
              lines: [aiLine(0, 1), aiLine(1, 2)],
              aiPlan: visionPlan({ scannedPages: [1, 2], pageReadings: [reading(1, 'glm-ocr'), reading(2, 'text-model')] })
            }
          })
        )
      );
      await create({ sessionId: 's-1' });

      expect(el().querySelector('.bsr-fallback-note')?.getAttribute('role')).toBe('note');
      expect(el().querySelector('.bsr-fallback-note')?.textContent).toContain('GLM-OCR n\'a pas pu lire la page 2');
      expect(el().querySelectorAll('.bsr-badge--fallback').length).toBe(1);
      expect(el().querySelectorAll('.bsr-badge--ai').length).toBe(2);
      expect(text()).toContain('Lu par GLM-OCR — page 2 relue par le modèle texte');
    });

    it('affiche un état vide quand aucune opération n’a été lue et « non lu » pour un RIB absent', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            canConfirm: false,
            balanceCheck: null,
            extraction: { ...base.extraction!, header: { ...base.extraction!.header, rib: null }, lines: [], aiPlan: visionPlan() }
          })
        )
      );
      await create({ sessionId: 's-1' });

      expect(el().querySelector('.bsr-empty')?.getAttribute('role')).toBe('status');
      expect(text()).toContain('Aucune opération n\'a été lue sur ce relevé');
      expect(text()).toContain('non lu');
      expect(el().querySelector('.bsr-balance')).toBeNull();
    });

    it('marque le RIB « à vérifier » quand l’IA n’est pas sûre de sa lecture', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            extraction: {
              ...base.extraction!,
              lines: [aiLine(0, 1)],
              issues: [{ code: 'statement.ai_rib_mismatch', severity: 'Warning', message: 'RIB lu différent', pageNumber: 1, lineIndex: null }],
              aiPlan: visionPlan({ scannedPages: [1] })
            }
          })
        )
      );
      await create({ sessionId: 's-1' });

      expect(text()).toContain('à vérifier');
      expect(text()).toContain('Page 1 · ');
      expect(text()).toContain('RIB à vérifier');
    });

    it('exige l’accusé de l’écart de solde puis l’envoie au serveur après confirmation', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            requiresBalanceAcknowledgement: true,
            balanceCheck: { sumDebits: 10, sumCredits: 0, computedClosing: 90, difference: 12.5, isBalanced: false },
            extraction: { ...base.extraction!, lines: [aiLine(0, 1)], aiPlan: visionPlan({ scannedPages: [1] }) }
          })
        )
      );
      api.confirm.and.returnValue(of({ statementId: 'st-9', lineCount: 1, alreadyImportedCount: 0 }));
      await create({ sessionId: 's-1' });

      const balance = el().querySelector('.bsr-balance');
      expect(component.balanceMode()).toBe('warning');
      expect(balance?.classList.contains('is-warning')).toBeTrue();
      expect(balance?.getAttribute('role')).toBe('alert');
      expect(text()).toContain('Écart de solde de');
      expect(text()).toContain('Total débits imprimé — / calculé');
      expect(el().querySelector<HTMLInputElement>('#bsr-ack')).not.toBeNull();

      component.confirmStatement();
      expect(confirmation.confirm).not.toHaveBeenCalled();
      expect(api.confirm).not.toHaveBeenCalled();

      component.balanceAcknowledged.set(true);
      fixture.detectChanges();
      component.confirmStatement();

      expect(confirmation.confirm).toHaveBeenCalledOnceWith(jasmine.objectContaining({ header: 'Enregistrer malgré l\'écart de solde ?', acceptLabel: 'Enregistrer malgré l\'écart', rejectLabel: 'Revenir au contrôle' }));
      expect(api.confirm).toHaveBeenCalledOnceWith('s-1', { corrections: [], acknowledgeBalanceWarning: true });
      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/statement', 'st-9'], jasmine.objectContaining({ replaceUrl: true }));
    });

    it('reste bloquant sans décision explicite du serveur et recharge la session sur un refus 400', async () => {
      const s = session({
        extractionMethod: 'ai-vision',
        balanceCheck: { sumDebits: 10, sumCredits: 0, computedClosing: 90, difference: 12.5, isBalanced: false },
        extraction: { ...base.extraction!, lines: [aiLine(0, 1)], aiPlan: visionPlan({ scannedPages: [1] }) }
      });
      api.session.and.returnValue(of(s));
      api.confirm.and.returnValue(throwError(() => new BankStatementImportError('', 'bank_statement_import.balance_warning_not_acknowledged', 400)));
      await create({ sessionId: 's-1' });

      expect(component.balanceMode()).toBe('blocking');
      expect(el().querySelector('.bsr-balance')?.classList.contains('is-ko')).toBeTrue();

      component.confirmStatement();

      expect(api.confirm).toHaveBeenCalledOnceWith('s-1', { corrections: [] });
      expect(component.error()).toContain('confirmer l\'écart de solde');
      expect(api.session).toHaveBeenCalledTimes(2);
    });

    it('corrige et exclut des lignes lues par l’IA puis envoie uniquement les champs modifiés', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            extraction: {
              ...base.extraction!,
              lines: [aiLine(0, 1), aiLine(1, 1, 20), { ...aiLine(2, 1, 30), source: 'Layout' }],
              issues: [{ code: 'statement.ai_line_needs_review', severity: 'Warning', message: 'Montant douteux', pageNumber: 1, lineIndex: 0 }],
              aiPlan: visionPlan({ scannedPages: [1] })
            }
          })
        )
      );
      api.confirm.and.returnValue(of({ statementId: 'st-9', lineCount: 2, alreadyImportedCount: 0 }));
      await create({ sessionId: 's-1' });

      expect(component.hasEditableLines()).toBeTrue();
      expect(component.isEditable(component.displayLines()[2])).toBeFalse();
      expect(text()).toContain('Ligne 1 · ');
      expect(text()).toContain('Corriger cette ligne');

      component.editLineFromIssue(0);
      expect(component.editingIndex()).toBe(0);
      expect(component.draft).toEqual(jasmine.objectContaining({ lineIndex: 0, transactionDate: '2026-03-02', label: 'OPERATION 0', amount: 10, isDebit: true }));

      component.draft.amount = 12.5;
      component.draft.label = '  Virement reçu ';
      component.draft.isDebit = false;
      component.saveLineEdit(component.displayLines()[0]);
      fixture.detectChanges();

      expect(component.editingIndex()).toBeNull();
      expect(component.corrections().get(0)).toEqual({ lineIndex: 0, amount: 12.5, isDebit: false, label: 'Virement reçu' });
      expect(component.displayLines()[0]).toEqual(jasmine.objectContaining({ amount: 12.5, isDebit: false, label: 'Virement reçu', corrected: true, excluded: false }));
      expect(el().querySelectorAll('.bsr-badge--manual').length).toBe(1);

      component.toggleExclude(component.displayLines()[1]);
      fixture.detectChanges();
      expect(component.excludedCount()).toBe(1);
      expect(component.correctedCount()).toBe(1);
      expect(el().querySelectorAll('.bsr-row--excluded').length).toBe(1);
      expect(text()).toContain('1 ligne(s) corrigée(s), 1 exclue(s)');

      component.toggleExclude(component.displayLines()[1]);
      expect(component.excludedCount()).toBe(0);
      expect(component.corrections().has(1)).toBeFalse();
      component.toggleExclude(component.displayLines()[1]);

      component.confirmStatement();

      expect(api.confirm).toHaveBeenCalledOnceWith('s-1', {
        corrections: [
          { lineIndex: 0, amount: 12.5, isDebit: false, label: 'Virement reçu' },
          { lineIndex: 1, exclude: true }
        ]
      });
    });

    it('refuse un brouillon invalide et oublie une correction identique à la lecture', async () => {
      api.session.and.returnValue(
        of(session({ extractionMethod: 'ai-vision', extraction: { ...base.extraction!, lines: [aiLine(0, 1)], aiPlan: visionPlan({ scannedPages: [1] }) } }))
      );
      await create({ sessionId: 's-1' });

      component.startLineEdit(component.displayLines()[0]);
      component.draft.amount = 0;
      expect(component.draftValid()).toBeFalse();
      component.saveLineEdit(component.displayLines()[0]);
      expect(component.editingIndex()).toBe(0);

      component.draft.amount = 10;
      component.draft.label = 'OPERATION 0';
      expect(component.draftValid()).toBeTrue();
      component.saveLineEdit(component.displayLines()[0]);
      expect(component.editingIndex()).toBeNull();
      expect(component.corrections().size).toBe(0);
    });

    it('explique que « Analyser avec ce compte » relance la lecture complète par GLM-OCR', async () => {
      bankAccounts = [{ id: 'bank-2', bankName: 'BIAT', rib: '08001234567890123456', isActive: true }];
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            pageCount: 5,
            canConfirm: false,
            extraction: {
              ...base.extraction!,
              header: { ...base.extraction!.header, rib: '08001234567890123456' },
              lines: [aiLine(0, 1)],
              issues: [{ code: 'statement.rib_mismatch', severity: 'Blocking', message: 'Autre compte', pageNumber: null, lineIndex: null }],
              aiPlan: visionPlan({ scannedPages: [1, 2, 3, 4, 5], estimatedSeconds: 600 })
            }
          })
        )
      );
      await create({ sessionId: 's-1' });

      expect(component.suggestedRetargetAccount()?.id).toBe('bank-2');
      expect(component.missingAccountRibTail()).toBeNull();
      expect(text()).toContain('relance la lecture complète du fichier par GLM-OCR (5 pages, environ 10 min)');
      expect(text()).toContain('Analyser avec ce compte');
    });

    it('indique qu’il faut créer le compte bancaire quand le RIB lu n’existe pas dans le dossier', async () => {
      bankAccounts = [{ id: 'bank-1', bankName: 'STB', rib: '10006035123456789012', isActive: true }];
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'ai-vision',
            canConfirm: false,
            extraction: {
              ...base.extraction!,
              header: { ...base.extraction!.header, rib: '08001234567890123456' },
              lines: [aiLine(0, 1)],
              issues: [{ code: 'statement.rib_mismatch', severity: 'Blocking', message: 'Autre compte', pageNumber: null, lineIndex: null }],
              aiPlan: visionPlan({ scannedPages: [1] })
            }
          })
        )
      );
      await create({ sessionId: 's-1' });

      expect(component.suggestedRetargetAccount()).toBeNull();
      expect(component.missingAccountRibTail()).toBe('3456');
      expect(text()).toContain('(RIB …3456) qui n\'existe pas dans ce dossier');
      expect(text()).toContain('Paiements › Comptes bancaires');
      expect(text()).not.toContain('Analyser avec ce compte');
    });

    it('propose de relancer l’analyse quand l’IA était indisponible avant toute lecture', async () => {
      api.session.and.returnValue(
        of(
          session({
            extractionMethod: 'none',
            pageCount: 5,
            canConfirm: false,
            balanceCheck: null,
            extraction: {
              ...base.extraction!,
              lines: [],
              issues: [{ code: 'statement.ai_unavailable', severity: 'Blocking', message: 'Modèle non chargé', pageNumber: null, lineIndex: null }],
              aiPlan: visionPlan({ scannedPages: [1, 2, 3, 4, 5], estimatedSeconds: 900 })
            }
          })
        )
      );
      api.retry.and.returnValue(of(session({ id: 's-9', status: 'Pending', canConfirm: false, extraction: null, balanceCheck: null })));
      await create({ sessionId: 's-1' }, { from: 'reconciliation' });

      expect(component.aiUnavailableBlocking()).toBeTrue();
      expect(component.canRetry()).toBeTrue();
      expect(text()).toContain('Lecture IA non effectuée');
      expect(text()).toContain('Lecture IA indisponible');
      expect(text()).toContain('la relance reprend le fichier complet (5 pages, environ 15 min)');
      expect(text()).toContain('Relancer l\'analyse');

      component.retry();

      expect(api.retry).toHaveBeenCalledOnceWith('s-1');
      expect(router.navigate).toHaveBeenCalledWith(['/accounting/bank-statement-import/session', 's-9'], { queryParams: { from: 'reconciliation' }, replaceUrl: true });
    });

    it('explique l’échec d’une session et ne propose la relance que pour un motif IA', async () => {
      api.session.and.returnValue(of(session({ status: 'Failed', errorCode: 'ai_timeout', canConfirm: false, extraction: null, balanceCheck: null })));
      await create({ sessionId: 's-1' });

      expect(text()).toContain('L\'analyse de ce relevé n\'a pas abouti.');
      expect(text()).toContain('dépassé le temps alloué');
      expect(component.canRetry()).toBeTrue();
      expect(text()).toContain('Relancer l\'analyse');

      component.session.set(session({ status: 'Failed', errorCode: 'autre', canConfirm: false, extraction: null, balanceCheck: null }));
      fixture.detectChanges();
      expect(component.canRetry()).toBeFalse();
      expect(text()).not.toContain('Relancer l\'analyse');

      component.session.set(session({ status: 'Cancelled', canConfirm: false, extraction: null, balanceCheck: null }));
      fixture.detectChanges();
      expect(text()).toContain('L\'analyse de ce relevé n\'a pas abouti.');
      expect(text()).not.toContain('dépassé le temps alloué');
    });
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
