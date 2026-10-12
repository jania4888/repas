import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { LetteringComponent } from './lettering.component';
import { AccountingService } from '../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { LetteringLine } from './models/lettering.models';

/**
 * Tests ciblés du conteneur. `TestBed.createComponent` instancie déjà les composants enfants
 * non conditionnels (`@if`) de `lettering.component.html` au moment de la création de la vue —
 * même sans appeler `fixture.detectChanges()` — donc leurs dépendances DI doivent être fournies
 * (ActivatedRoute#snapshot.queryParamMap pour `app-accounting-correction-banner`, ErpLocaleService
 * pour `app-lettering-group-drawer`). On n'appelle volontairement pas `detectChanges()` pour éviter
 * d'exécuter `ngOnInit`/les bindings PrimeNG des enfants : seule la logique pure du conteneur est
 * testée ici (B1/B2 §onValidate/onDrawerComplete, M2 validation de code, M3 synchronisation URL).
 */
function line(overrides: Partial<LetteringLine>): LetteringLine {
  return {
    lineId: 'l1', entryId: 'e1', entryDate: '2026-01-02', journalCode: 'JOD', entryNumber: 1,
    lineNumber: 1, accountNumber: '4111', label: 'Ligne', entryLabel: 'Écriture',
    pieceRef: null, documentType: null, debit: 100, credit: 0, currency: 'TND',
    debitInCurrency: 0, creditInCurrency: 0, letteringCode: null, isPartiallyLettered: false,
    thirdPartyId: null, thirdPartyKind: null, thirdPartyName: null, isDraft: false,
    isReversed: false, isReversal: false, periodLocked: false,
    ...overrides
  };
}

describe('LetteringComponent', () => {
  let component: LetteringComponent;
  let router: jasmine.SpyObj<Router>;
  let confirmation: jasmine.SpyObj<ConfirmationService>;

  beforeEach(() => {
    const api = jasmine.createSpyObj<AccountingService>('AccountingService', [
      'getLetteringLines', 'getLetteringGroup', 'letterEntries', 'settleExchangeDifference',
      'unletterEntries', 'completePartialLettering', 'getLetteringSuggestions'
    ]);
    api.getLetteringSuggestions.and.returnValue(EMPTY);
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'user']);
    auth.hasPermission.and.returnValue(true);
    // `AnalyzeWithAiButtonComponent` (dans `app-lettering-filters`, rendu sans condition) construit
    // `AiChatSessionService`, dont un `effect()` lit `auth.user()` dès la création du composant.
    auth.user.and.returnValue(null);
    confirmation = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm', 'prompt']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    // `AiVolatileAnalysisStore` (injecté par `AnalyzeWithAiButtonComponent` dans
    // `app-lettering-filters`, rendu sans condition) s'abonne à `router.events` dès sa construction.
    (router as unknown as { events: typeof EMPTY }).events = EMPTY;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountingService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: (_: unknown, fallback: string) => fallback } },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParams: {}, queryParamMap: convertToParamMap({}) } }
        },
        { provide: ErpLocaleService, useValue: { isRtl: () => false } }
      ]
    });

    const fixture = TestBed.createComponent(LetteringComponent);
    component = fixture.componentInstance;
  });

  it('onValidate letters normally when there is no completion target', () => {
    const letterSpy = spyOn(component['store'], 'letter');
    const completeSpy = spyOn(component['store'], 'complete');
    component.onValidate();
    expect(letterSpy).toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('onValidate completes the partial group when a completionTarget is set (B1)', () => {
    component['store'].lines.set([
      line({ lineId: 'member', letteringCode: 'P00002', isPartiallyLettered: true, debit: 100 }),
      line({ lineId: 'new', credit: 100 })
    ]);
    component['store'].setPaneSelection('debit', ['member']);
    component['store'].setPaneSelection('credit', ['new']);
    expect(component['store'].completionTarget()).toBe('P00002');

    const letterSpy = spyOn(component['store'], 'letter');
    const completeSpy = spyOn(component['store'], 'complete');
    component.onValidate();
    expect(completeSpy).toHaveBeenCalledWith('P00002');
    expect(letterSpy).not.toHaveBeenCalled();
  });

  it('onDrawerComplete closes the drawer, clears the group, and preselects the group lines by side (B2)', () => {
    component.groupDrawerOpen = true;
    component['store'].group.set({
      code: 'P00002',
      accountNumber: '4111',
      amount: 100,
      currency: 'TND',
      isPartial: true,
      letteredAt: '2026-01-02T00:00:00Z',
      createdByDisplayName: 'A. Dupont',
      lines: [line({ lineId: 'd1', debit: 100 }), line({ lineId: 'c1', credit: 100, debit: 0 })],
      canUnletter: true,
      unletterBlockedReason: null,
      canComplete: true
    });

    component.onDrawerComplete('P00002');

    expect(component.groupDrawerOpen).toBeFalse();
    expect(component['store'].group()).toBeNull();
    expect(component['store'].isSelected('d1')).toBeTrue();
    expect(component['store'].isSelected('c1')).toBeTrue();
  });

  it('onDrawerComplete is a no-op if the code does not match the currently open group', () => {
    component['store'].group.set({
      code: 'P00001',
      accountNumber: '4111',
      amount: 100,
      currency: 'TND',
      isPartial: true,
      letteredAt: '2026-01-02T00:00:00Z',
      createdByDisplayName: 'A. Dupont',
      lines: [line({ lineId: 'd1', debit: 100 })],
      canUnletter: true,
      unletterBlockedReason: null,
      canComplete: true
    });

    component.onDrawerComplete('P00002');

    expect(component['store'].group()).not.toBeNull();
  });

  it('promptUnletterByCode normalizes (trim/uppercase) and rejects malformed codes without calling the store (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve('  not-a-code  '));
    const openGroupSpy = spyOn(component, 'openGroup');

    await component['promptUnletterByCode']();

    expect(openGroupSpy).not.toHaveBeenCalled();
    expect(component['store'].error()).toContain('invalide');
  });

  it('promptUnletterByCode opens the group drawer (not a direct unletter) for a well-formed code (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve('  l00001  '));
    const openGroupSpy = spyOn(component, 'openGroup');

    await component['promptUnletterByCode']();

    expect(openGroupSpy).toHaveBeenCalledWith('L00001');
  });

  it('promptUnletterByCode passes maxLength: 16 to the confirmation prompt (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve(null));
    await component['promptUnletterByCode']();
    expect(confirmation.prompt).toHaveBeenCalledWith(jasmine.objectContaining({ maxLength: 16 }));
  });

  it('load() rewrites the URL only after a successful store.load() (M3)', () => {
    const api = TestBed.inject(AccountingService) as jasmine.SpyObj<AccountingService>;
    component['store'].updateFilters({ ...component['store'].filters(), account: '4111', from: '2026-01-01', to: '2026-01-31' });
    (api.getLetteringLines as jasmine.Spy).and.returnValue(
      of({
        success: true,
        data: {
          items: [], page: 1, pageSize: 2000, totalCount: 0, truncated: false,
          totals: { count: 0, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 }
        }
      })
    );

    component.load();

    expect(router.navigate).toHaveBeenCalledTimes(1);
    const [, options] = router.navigate.calls.mostRecent().args;
    expect(options?.replaceUrl).toBeTrue();
    expect(options?.queryParams?.['autoLoad']).toBe('1');
    expect(options?.queryParams?.['account']).toBe('4111');
  });

  it('load() does not touch the URL when the account is missing (store.load() fails fast)', () => {
    component.load();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
