import { mapSuggestion } from './utils/lettering-suggestions';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@shared/components/button/button.component';
import { LetteringProposalsStripComponent } from './components/lettering-proposals-strip/lettering-proposals-strip.component';
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
import { AccountingFeatureFlagsService } from '../shared/accounting-feature-flags.service';
import { LetteringSuggestion } from './models/lettering-suggestions.models';

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
  const proposalsFlag = signal(false);

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
        { provide: ErpLocaleService, useValue: { isRtl: () => false } },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { isEnabled: (key: string) => key === 'letteringProposals' && proposalsFlag() }
        }
      ]
    });

    proposalsFlag.set(false);
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
    // Mode complétion explicite (item 6) : la bannière s'affiche ; tant qu'aucune nouvelle ligne
    // n'est ajoutée, il n'y a rien à compléter (cible nulle, « Valider » désactivé).
    expect(component['store'].completionGroup()?.code).toBe('P00002');
    expect(component['store'].completionTarget()).toBeNull();
    expect(component['store'].canComplete()).toBeFalse();
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

  it('promptOpenGroupByCode normalizes (trim/uppercase) and rejects malformed codes without calling the store (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve('  not-a-code  '));
    const openGroupSpy = spyOn(component, 'openGroup');

    await component['promptOpenGroupByCode']();

    expect(openGroupSpy).not.toHaveBeenCalled();
    expect(component['store'].error()).toContain('invalide');
  });

  it('promptOpenGroupByCode opens the group drawer (not a direct unletter) for a well-formed code (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve('  l00001  '));
    const openGroupSpy = spyOn(component, 'openGroup');

    await component['promptOpenGroupByCode']();

    expect(openGroupSpy).toHaveBeenCalledWith('L00001');
  });

  it('promptOpenGroupByCode passes maxLength: 16 to the confirmation prompt (M2)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve(null));
    await component['promptOpenGroupByCode']();
    expect(confirmation.prompt).toHaveBeenCalledWith(jasmine.objectContaining({ maxLength: 16 }));
  });

  it('promptOpenGroupByCode is a neutral "open" prompt, not a destructive one (plan §7.6)', async () => {
    confirmation.prompt.and.returnValue(Promise.resolve(null));
    await component['promptOpenGroupByCode']();
    const args = confirmation.prompt.calls.mostRecent().args[0];
    expect(args.acceptLabel).toBe('Ouvrir');
    expect(args.acceptButtonStyleClass).toBeUndefined();
  });

  describe('actions menu (plan §7.6)', () => {
    const item = (prefix: string) =>
      component.actionsMenuItems().find(i => (i.label ?? '').startsWith(prefix))!;

    it('shows "Ouvrir un groupe par code…" even without the unletter permission', () => {
      spyOn(component['store'], 'canUnletter').and.returnValue(false);
      const open = item('Ouvrir un groupe par code');
      expect(open).toBeDefined();
      expect(open.visible).toBeUndefined();
      expect(component.actionsMenuItems().some(i => (i.label ?? '').startsWith('Délettrer'))).toBeFalse();
    });

    it('disables the ledger export without an exact account, enables it otherwise', () => {
      const store = component['store'];
      expect(item('Exporter le grand livre').disabled).toBeTrue();
      store.updateFilters({ ...store.filters(), account: '4111', accountMatch: 'exact' });
      expect(item('Exporter le grand livre').disabled).toBeFalse();
      store.updateFilters({ ...store.filters(), accountMatch: 'prefix' });
      expect(item('Exporter le grand livre').disabled).toBeTrue();
    });

    it('delegates the ledger export to the store', () => {
      const spy = spyOn(component['store'], 'exportLedger');
      item('Exporter le grand livre').command!();
      expect(spy).toHaveBeenCalled();
    });
  });

  it('maps the account type reported by the filters to a summary label (plan §7.3)', () => {
    expect(component.accountTypeLabel()).toBeNull();
    component.accountType.set(1);
    expect(component.accountTypeLabel()).toBe('Compte client');
    component.accountType.set(2);
    expect(component.accountTypeLabel()).toBe('Compte fournisseur');
    component.accountType.set(99);
    expect(component.accountTypeLabel()).toBeNull();
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

  describe('propositions (Phase 3)', () => {
    const suggestion = { key: 'k1', lineIds: ['d1', 'c1'] } as unknown as LetteringSuggestion;

    it('payload IA : propositions ajoutées seulement si le bandeau est affiché (drapeau actif)', () => {
      const real = mapSuggestion({
        key: 'k1', kind: 'SameReference', category: 'Exact', score: 90, confidence: 'High',
        accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
        debitLines: [], creditLines: [], totalAmount: 10, localGap: 0, hasExchangeDifference: false,
        bulkEligible: true, reasons: []
      });
      component['suggestions'].suggestions.set([real]);
      component['suggestions'].totalFound.set(1);
      component['store'].loadedOnce.set(true);

      const off = component.buildAnalyzePayload() as Record<string, unknown>;
      expect(off['highlights']).toEqual([]);
      expect('suggestionsCount' in (off['summary'] as object)).toBeFalse();

      proposalsFlag.set(true);
      const on = component.buildAnalyzePayload() as Record<string, unknown>;
      expect((on['highlights'] as unknown[]).length).toBe(1);
      expect((on['summary'] as Record<string, unknown>)['suggestionsCount']).toBe(1);
    });

    it('payload IA : aucune proposition si le bandeau est masqué, avant le premier chargement ou pendant un recalcul', () => {
      const real = mapSuggestion({
        key: 'k1', kind: 'SameReference', category: 'Exact', score: 90, confidence: 'High',
        accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
        debitLines: [], creditLines: [], totalAmount: 10, localGap: 0, hasExchangeDifference: false,
        bulkEligible: true, reasons: []
      });
      const store = component['suggestions'];
      store.suggestions.set([real]);
      store.totalFound.set(1);
      proposalsFlag.set(true);
      const hasProposals = () =>
        'suggestionsCount' in ((component.buildAnalyzePayload() as Record<string, unknown>)['summary'] as object);

      component['store'].loadedOnce.set(false);
      expect(hasProposals()).withContext('avant le premier chargement').toBeFalse();

      component['store'].loadedOnce.set(true);
      expect(hasProposals()).withContext('bandeau affiché').toBeTrue();

      store.hidden.set(true);
      expect(hasProposals()).withContext('bandeau masqué').toBeFalse();
      store.hidden.set(false);

      store.pending.set(true);
      expect(hasProposals()).withContext('recalcul demandé (liste périmée)').toBeFalse();
      store.pending.set(false);

      store.loading.set(true);
      expect(hasProposals()).withContext('recalcul en cours').toBeFalse();
      store.loading.set(false);
      expect(hasProposals()).toBeTrue();
    });

    it('« Lettrer en masse… » du tiroir : ferme le tiroir et ouvre le dialogue de masse', () => {
      const open = spyOn(component['suggestions'], 'openBulkDialog');
      component.proposalsDrawerOpen.set(true);
      component.onOpenBulk();
      expect(component.proposalsDrawerOpen()).toBeFalse();
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('fermeture du dialogue de masse : délègue au store, ignore une ouverture', () => {
      const close = spyOn(component['suggestions'], 'closeBulkDialog');
      component.onBulkDialogVisibleChange(true);
      expect(close).not.toHaveBeenCalled();
      component.onBulkDialogVisibleChange(false);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('clic sur une carte : le message reflète le résultat de select()', () => {
      spyOn(component['suggestions'], 'select').and.returnValue('linesNotVisible');
      component.onSelectSuggestion(suggestion);
      expect(component.proposalsNotice()).toBe('linesNotVisible');
    });

    it('clic sur une carte pendant une complétion : message « complétion » (pas « réessayez »)', () => {
      spyOn(component['suggestions'], 'select').and.returnValue('busy');
      component['store'].completionGroup.set({ code: 'P00001' } as never);
      component.onSelectSuggestion(suggestion);
      expect(component.proposalsNotice()).toBe('completion');
    });

    it('clic sur une carte sans le droit de créer : rien ne change', () => {
      const select = spyOn(component['suggestions'], 'select');
      spyOn(component['store'], 'canCreate').and.returnValue(false);
      component.onSelectSuggestion(suggestion);
      expect(select).not.toHaveBeenCalled();
      expect(component.proposalsNotice()).toBeNull();
    });

    it('« Réinitialiser » oublie l\'instantané de « Sélectionner » et le message', () => {
      const forget = spyOn(component['suggestions'], 'forgetSelectSnapshot');
      const reset = spyOn(component['store'], 'reset');
      component.proposalsNotice.set('selected');

      component.onResetSelection();

      expect(reset).toHaveBeenCalledTimes(1);
      expect(forget).toHaveBeenCalledTimes(1);
      expect(component.proposalsNotice()).toBeNull();
    });

    it('une sélection manuelle oublie l\'instantané de « Sélectionner » et le message', () => {
      const forget = spyOn(component['suggestions'], 'forgetSelectSnapshot');
      const setPane = spyOn(component['store'], 'setPaneSelection');
      component.proposalsNotice.set('selected');

      component.onPaneSelection('debit', ['d1']);

      expect(forget).toHaveBeenCalledTimes(1);
      expect(component.proposalsNotice()).toBeNull();
      expect(setPane).toHaveBeenCalledOnceWith('debit', ['d1']);
    });

    it('« Valider » efface le message puis délègue au store', () => {
      const validate = spyOn(component['suggestions'], 'validate');
      component.proposalsNotice.set('busy');
      component.onValidateSuggestion(suggestion);
      expect(component.proposalsNotice()).toBeNull();
      expect(validate).toHaveBeenCalledOnceWith(suggestion);
    });

    it('« Annuler » rétablit la sélection précédente', () => {
      const undo = spyOn(component['suggestions'], 'undoSelect');
      component.proposalsNotice.set('selected');
      component.onUndoSuggestion();
      expect(undo).toHaveBeenCalledTimes(1);
      expect(component.proposalsNotice()).toBeNull();
    });

    it('« Sélectionner » depuis le tiroir : ferme le tiroir et affiche le message dans le bandeau', () => {
      spyOn(component['suggestions'], 'select').and.returnValue('selected');
      component.proposalsDrawerOpen.set(true);

      component.onSelectSuggestionFromDrawer(suggestion);

      expect(component.proposalsDrawerOpen()).toBeFalse();
      expect(component.proposalsNotice()).toBe('selected');
    });

    it('« Sélectionner » depuis le tiroir sans sélection : le tiroir reste ouvert avec la raison', () => {
      spyOn(component['suggestions'], 'select').and.returnValue('linesNotVisible');
      component.proposalsDrawerOpen.set(true);

      component.onSelectSuggestionFromDrawer(suggestion);

      expect(component.proposalsDrawerOpen()).toBeTrue();
      expect(component.proposalsNotice()).toBe('linesNotVisible');
    });

    it('ouverture du tiroir : efface les messages de la page et le message du bandeau', () => {
      component['store'].success.set('Lettrage L00001 créé.');
      component['store'].error.set('Erreur');
      component.proposalsNotice.set('busy');

      component.openProposalsDrawer();

      expect(component.proposalsDrawerOpen()).toBeTrue();
      expect(component['store'].success()).toBeNull();
      expect(component['store'].error()).toBeNull();
      expect(component.proposalsNotice()).toBeNull();
    });

    it('bouton d\'en-tête : relance le calcul', () => {
      const refresh = spyOn(component['suggestions'], 'refresh');
      component.showProposalsStrip();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Rendu du bandeau des propositions (Phase 3). Les enfants lourds (filtres, volets, tiroirs…) sont
 * retirés des `imports` et rendus comme éléments inconnus (`CUSTOM_ELEMENTS_SCHEMA`) : seuls le
 * bandeau et le bouton d'en-tête sont de vrais composants. On teste ainsi le seul `@if` du drapeau.
 */
describe('LetteringComponent — rendu des propositions', () => {
  let fixture: ComponentFixture<LetteringComponent>;
  let component: LetteringComponent;
  const proposalsFlag = signal(false);
  let api: jasmine.SpyObj<AccountingService>;
  const query = (testId: string) => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    api = jasmine.createSpyObj<AccountingService>('AccountingService', ['getLetteringSuggestions']);
    api.getLetteringSuggestions.and.returnValue(EMPTY);
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'user']);
    auth.hasPermission.and.returnValue(true);
    auth.user.and.returnValue(null);
    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AccountingService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: (_: unknown, fallback: string) => fallback } },
        { provide: ConfirmationService, useValue: jasmine.createSpyObj('ConfirmationService', ['confirm', 'prompt']) },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {}, queryParamMap: convertToParamMap({}) } } },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { isEnabled: (key: string) => key === 'letteringProposals' && proposalsFlag() }
        }
      ]
    });
    TestBed.overrideComponent(LetteringComponent, {
      set: {
        imports: [CommonModule, LetteringProposalsStripComponent, ButtonComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA]
      }
    });

    proposalsFlag.set(false);
    fixture = TestBed.createComponent(LetteringComponent);
    component = fixture.componentInstance;
  });

  it('drapeau front éteint : ni bandeau ni bouton d\'en-tête dans le DOM, même écran chargé', () => {
    component['store'].loadedOnce.set(true);
    fixture.detectChanges();

    expect(component.showProposals()).toBeFalse();
    expect(query('lettering-proposals-strip')).toBeNull();
    expect(query('lettering-proposals-header-button')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-lettering-proposals-drawer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-lettering-bulk-dialog')).toBeNull();
  });

  it('drapeau front éteint : un chargement réussi ne déclenche aucun appel de propositions', fakeAsync(() => {
    component['store'].loadedOnce.set(true);
    component['store'].loadedFilters.set({ ...component['store'].filters(), account: '4111' });
    component['store'].reloadSeq.set(1);
    fixture.detectChanges();
    tick(1000);

    expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
  }));

  it('drapeau actif et écran chargé : bandeau et bouton d\'en-tête présents', () => {
    proposalsFlag.set(true);
    component['store'].loadedOnce.set(true);
    fixture.detectChanges();

    expect(query('lettering-proposals-strip')).not.toBeNull();
    expect(query('lettering-proposals-header-button')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-lettering-proposals-drawer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-lettering-bulk-dialog')).not.toBeNull();
  });

  it('« Voir toutes les propositions » du bandeau ouvre le tiroir', () => {
    proposalsFlag.set(true);
    component['store'].loadedOnce.set(true);
    fixture.detectChanges();

    const strip = fixture.debugElement.query(By.directive(LetteringProposalsStripComponent));
    (strip.componentInstance as LetteringProposalsStripComponent).showAll.emit();

    expect(component.proposalsDrawerOpen()).toBeTrue();
  });

  it('bandeau masqué (drapeau coupé) : le tiroir se ferme et ne se rouvre pas seul', () => {
    proposalsFlag.set(true);
    component['store'].loadedOnce.set(true);
    fixture.detectChanges();
    component.proposalsDrawerOpen.set(true);

    proposalsFlag.set(false);
    fixture.detectChanges();
    expect(component.proposalsDrawerOpen()).toBeFalse();

    proposalsFlag.set(true);
    fixture.detectChanges();
    expect(component.proposalsDrawerOpen()).toBeFalse();
  });

  it('drapeau actif avant le premier chargement : bouton d\'en-tête présent mais désactivé, pas de bandeau', () => {
    proposalsFlag.set(true);
    fixture.detectChanges();

    expect(query('lettering-proposals-strip')).toBeNull();
    const button = (query('lettering-proposals-header-button') as HTMLElement).querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
  });

  it('drapeau actif mais fonction coupée côté serveur (hidden) : rien n\'est affiché', () => {
    proposalsFlag.set(true);
    component['store'].loadedOnce.set(true);
    component['suggestions'].hidden.set(true);
    fixture.detectChanges();

    expect(query('lettering-proposals-strip')).toBeNull();
    expect(query('lettering-proposals-header-button')).toBeNull();
  });
});
