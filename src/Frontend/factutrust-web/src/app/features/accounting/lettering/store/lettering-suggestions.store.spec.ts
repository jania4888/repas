import { LETTERING_SUGGESTIONS_MAX } from '../models/lettering-suggestions.models';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import {
  AccountingService,
  BulkLetteringResultDto,
  LetteringLineDto,
  LetteringSuggestionDto,
  LetteringSuggestionLineDto,
  LetteringSuggestionsResultDto
} from '../../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { signal } from '@angular/core';
import { AccountingFeatureFlagsService } from '../../shared/accounting-feature-flags.service';
import { createDefaultLetteringFilters } from '../models/lettering.models';
import { LetteringStore } from './lettering.store';
import { LETTERING_SUGGESTIONS_DEBOUNCE_MS, LetteringSuggestionsStore, newBulkRequestId } from './lettering-suggestions.store';

/** Enveloppe de réponse du client (type non exporté par le service). */
type SuggestionsResponse = ReturnType<AccountingService['getLetteringSuggestions']> extends Observable<infer R> ? R : never;

function sLine(id: string, over: Partial<LetteringSuggestionLineDto> = {}): LetteringSuggestionLineDto {
  return {
    lineId: id, entryId: `e-${id}`, entryDate: '2026-05-01T00:00:00', journalCode: 'JV', entryNumber: 1,
    pieceRef: null, label: id, debit: 0, credit: 0, debitInCurrency: 0, creditInCurrency: 0, ...over
  };
}

function suggestionDto(key: string, debitId: string, creditId: string, over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestionDto {
  return {
    key, kind: 'SameThirdPartyAmount', category: 'Exact', score: 90, confidence: 'High',
    accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
    debitLines: [sLine(debitId, { debit: 100 })], creditLines: [sLine(creditId, { credit: 100 })],
    totalAmount: 100, localGap: 0, hasExchangeDifference: false, bulkEligible: true, reasons: [], ...over
  };
}

function result(suggestions: LetteringSuggestionDto[], over: Partial<LetteringSuggestionsResultDto> = {}): SuggestionsResponse {
  return { success: true, data: {
    suggestions, totalFound: suggestions.length, returned: suggestions.length, candidateLineCount: 0,
    truncated: false, truncationReason: null, computedAtUtc: '2026-05-01T00:00:00Z', ...over
  } };
}

function lineDto(id: string, debit: number, credit: number): LetteringLineDto {
  return {
    lineId: id, entryId: `e-${id}`, entryDate: '2026-01-02', journalCode: 'JOD', entryNumber: 1,
    lineNumber: 1, accountNumber: '4111', label: id, entryLabel: 'Écriture', pieceRef: null, sourceCategory: 'manual',
    debit, credit, operationCurrency: 'TND', debitInCurrency: 0, creditInCurrency: 0,
    letteringCode: null, isPartiallyLettered: false, thirdPartyId: null, thirdPartyKind: null,
    thirdPartyName: null, isDraft: false, isReversed: false, isReversal: false, periodLocked: false
  };
}

function apiError(status: number, code?: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: code ? { success: false, error: 'x', code } : null });
}

describe('LetteringSuggestionsStore', () => {
  let store: LetteringSuggestionsStore;
  let lettering: LetteringStore;
  let api: jasmine.SpyObj<AccountingService>;
  let confirmation: jasmine.SpyObj<ConfirmationService>;
  let auth: jasmine.SpyObj<AuthService>;
  const proposalsFlag = signal(true);

  beforeEach(() => {
    api = jasmine.createSpyObj<AccountingService>('AccountingService', [
      'getLetteringLines', 'getLetteringSuggestions', 'letterEntries', 'getLetteringGroup', 'bulkLetter'
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    auth.hasPermission.and.returnValue(true);
    confirmation = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm']);
    confirmation.confirm.and.callFake(c => c.accept?.());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LetteringStore,
        LetteringSuggestionsStore,
        { provide: AccountingService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ErrorHandlerService, useValue: new ErrorHandlerService() },
        { provide: ConfirmationService, useValue: confirmation },
        { provide: AccountingFeatureFlagsService, useValue: { isEnabled: (key: string) => key === 'letteringProposals' && proposalsFlag() } }
      ]
    });
    proposalsFlag.set(true);
    lettering = TestBed.inject(LetteringStore);
    store = TestBed.inject(LetteringSuggestionsStore);
    lettering.updateFilters({ ...createDefaultLetteringFilters('2026-01-01', '2026-12-31'), account: '4111' });
    // Simule un chargement réussi (les propositions portent sur les filtres chargés).
    lettering.loadedFilters.set({ ...lettering.filters() });
  });

  function loadLines(ids: Array<[string, number, number]>): void {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: ids.map(([id, d, c]) => lineDto(id, d, c)), page: 1, pageSize: 2000, totalCount: ids.length, truncated: false,
        totals: { count: 0, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 }
      }
    }));
    lettering.load();
  }

  describe('refresh()', () => {
    it('anti-rebond de 300 ms : une rafale ne produit qu\'un appel, avec les filtres courants', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([suggestionDto('k1', 'd1', 'c1')])));

      store.refresh();
      tick(100);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS - 1);
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
      tick(1);

      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);
      const query = api.getLetteringSuggestions.calls.mostRecent().args[0];
      expect(query.account).toBe('4111');
      expect(query.from).toBe('2026-01-01');
      expect(query.to).toBe('2026-12-31');
      expect('state' in query).toBeFalse();
      // Sans maxResults, le serveur n'en renvoie que 50 : le tiroir et le lot en veulent 200.
      expect(query.maxResults).toBe(LETTERING_SUGGESTIONS_MAX);
      expect(store.suggestions().map(s => s.key)).toEqual(['k1']);
      expect(store.loading()).toBeFalse();
    }));

    it('switchMap : seule la dernière réponse est appliquée', fakeAsync(() => {
      const first = new Subject<SuggestionsResponse>();
      const second = new Subject<SuggestionsResponse>();
      api.getLetteringSuggestions.and.returnValues(first, second);

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      first.next(result([suggestionDto('old', 'd1', 'c1')]));
      second.next(result([suggestionDto('new', 'd2', 'c2')]));

      expect(store.suggestions().map(s => s.key)).toEqual(['new']);
    }));

    it('reporte la troncature et sa raison', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([], { truncated: true, truncationReason: 'TimeFuse', totalFound: 7 })));

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(store.truncated()).toBeTrue();
      expect(store.truncationReason()).toBe('TimeFuse');
      expect(store.totalFound()).toBe(7);
    }));

    it('LETTERING_FEATURE_DISABLED masque le panneau et coupe tout appel ultérieur', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(throwError(() => apiError(400, 'LETTERING_FEATURE_DISABLED')));

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.hidden()).toBeTrue();
      expect(store.error()).toBeNull();
      expect(store.suggestions()).toEqual([]);

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);
    }));

    it('une autre erreur affiche un message, vide la liste et laisse le flux vivant', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValues(
        of(result([suggestionDto('k1', 'd1', 'c1')])),
        throwError(() => apiError(500)),
        of(result([suggestionDto('k2', 'd2', 'c2')]))
      );

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.error()).toBeTruthy();
      expect(store.suggestions()).toEqual([]);
      expect(store.hidden()).toBeFalse();

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.error()).toBeNull();
      expect(store.suggestions().map(s => s.key)).toEqual(['k2']);
    }));

    it('une exception synchrone du client ne coupe pas le flux', fakeAsync(() => {
      let calls = 0;
      api.getLetteringSuggestions.and.callFake(() => {
        if (++calls === 1) throw new Error('boom');
        return of(result([suggestionDto('k1', 'd1', 'c1')]));
      });

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.error()).toBeTruthy();

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.suggestions().length).toBe(1);
    }));

    it('drapeau front éteint : aucun appel, même après un chargement réussi', fakeAsync(() => {
      proposalsFlag.set(false);
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      loadLines([['d1', 100, 0]]);
      TestBed.flushEffects();
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(store.enabled()).toBeFalse();
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
    }));

    it('utilise les filtres chargés, jamais le brouillon des filtres', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([])));
      lettering.updateFilters({ account: '9999', minAmount: 5 });

      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      const query = api.getLetteringSuggestions.calls.mostRecent().args[0];
      expect(query.account).toBe('4111');
      expect(query.minAmount).toBeUndefined();
    }));

    it('liste périmée pendant le recalcul : « Valider » désactivé jusqu\'à la réponse', fakeAsync(() => {
      const pending = new Subject<SuggestionsResponse>();
      api.getLetteringSuggestions.and.returnValue(pending);

      store.refresh();
      expect(store.pending()).toBeTrue();
      expect(store.canValidate()).toBeFalse();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      pending.next(result([suggestionDto('k1', 'd1', 'c1')]));

      expect(store.pending()).toBeFalse();
      expect(store.canValidate()).toBeTrue();
    }));

    it('sans chargement réussi : annule la demande en attente et vide la liste sans appel', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([suggestionDto('k1', 'd1', 'c1')])));
      store.refresh();
      lettering.loadedFilters.set(null);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
      expect(store.suggestions()).toEqual([]);
      expect(store.pending()).toBeFalse();
    }));

    it('sans compte : vide la liste sans appel', fakeAsync(() => {
      lettering.loadedFilters.set({ ...lettering.filters(), account: '' });
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
    }));
  });

  describe('recalcul après chargement (reloadSeq)', () => {
    it('aucun appel avant le premier chargement, un appel après chaque chargement réussi', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([])));
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();

      loadLines([['d1', 100, 0]]);
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);

      lettering.load();
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(2);
    }));

    it('un chargement en échec ne déclenche pas de recalcul', fakeAsync(() => {
      api.getLetteringLines.and.returnValue(of({ success: false, error: 'KO' }));
      lettering.load();
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(lettering.reloadSeq()).toBe(0);
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
    }));
  });

  describe('computed', () => {
    it('topSuggestions, bulkEligible et totaux du lot', fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([
        suggestionDto('a', 'd1', 'c1', { score: 70 }),
        suggestionDto('b', 'd2', 'c2', { score: 95 }),
        suggestionDto('c', 'd3', 'c3', { score: 80, bulkEligible: false }),
        suggestionDto('d', 'd4', 'c4', { score: 60, confidence: 'Medium' })
      ])));
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(store.topSuggestions().map(s => s.key)).toEqual(['b', 'c', 'a']);
      expect(store.bulkEligible().map(s => s.key)).toEqual(['a', 'b', 'd']);

      store.openBulkDialog();
      expect(store.bulkDialogOpen()).toBeTrue();
      expect([...store.bulkSelection()].sort()).toEqual(['a', 'b']);
      expect(store.bulkLineCount()).toBe(4);
      expect(store.bulkTotalsByCurrency().get('TND')).toBe(200);

      store.toggleBulk('c');
      expect(store.bulkSelection().has('c')).toBeFalse();
      store.toggleBulk('d');
      store.toggleBulk('a');
      expect([...store.bulkSelection()].sort()).toEqual(['b', 'd']);
      store.closeBulkDialog();
      expect(store.bulkDialogOpen()).toBeFalse();
    }));
  });

  describe('select() / undoSelect()', () => {
    beforeEach(fakeAsync(() => {
      loadLines([['d1', 100, 0], ['c1', 0, 100], ['d9', 50, 0]]);
      api.getLetteringSuggestions.and.returnValue(of(result([
        suggestionDto('k1', 'd1', 'c1'),
        suggestionDto('hidden', 'zz', 'c1')
      ])));
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
    }));

    it('remplace la sélection des deux volets puis la rétablit', () => {
      lettering.setPaneSelection('debit', ['d9']);

      expect(store.select(store.suggestions()[0])).toBe('selected');
      expect(lettering.selectedLines().map(l => l.lineId).sort()).toEqual(['c1', 'd1']);
      expect(store.canUndoSelect()).toBeTrue();

      store.undoSelect();
      expect(lettering.selectedLines().map(l => l.lineId)).toEqual(['d9']);
      expect(store.canUndoSelect()).toBeFalse();
    });

    it('un rechargement oublie l\'instantané de « Sélectionner »', fakeAsync(() => {
      store.select(store.suggestions()[0]);
      expect(store.canUndoSelect()).toBeTrue();

      lettering.load();
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(store.canUndoSelect()).toBeFalse();
    }));

    it('refuse pendant la validation d\'une proposition', () => {
      store.busyKey.set('other');
      expect(store.select(store.suggestions()[0])).toBe('busy');
    });

    it('refuse si une ligne de la proposition n\'est pas affichée, sans toucher la sélection', () => {
      lettering.setPaneSelection('debit', ['d9']);
      expect(store.select(store.suggestions()[1])).toBe('linesNotVisible');
      expect(lettering.selectedLines().map(l => l.lineId)).toEqual(['d9']);
      expect(store.canUndoSelect()).toBeFalse();
    });
  });

  describe('validate()', () => {
    beforeEach(fakeAsync(() => {
      loadLines([['d1', 100, 0], ['c1', 0, 100]]);
      api.getLetteringSuggestions.and.returnValue(of(result([suggestionDto('k1', 'd1', 'c1'), suggestionDto('k2', 'd2', 'c2')])));
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      api.getLetteringLines.calls.reset();
      api.getLetteringSuggestions.calls.reset();
    }));

    it('confirme, envoie origin=Suggestion + clé, retire la proposition et recharge l\'écran', () => {
      api.letterEntries.and.returnValue(of({ success: true, data: { code: 'L00042', groupId: 'g', isPartial: false, lineCount: 2 } }));

      store.validate(store.suggestions()[0]);

      expect(confirmation.confirm).toHaveBeenCalledTimes(1);
      expect(api.letterEntries).toHaveBeenCalledOnceWith(['d1', 'c1'], false, 'Suggestion', 'k1');
      expect(store.suggestions().map(s => s.key)).toEqual(['k2']);
      expect(api.getLetteringLines).toHaveBeenCalledTimes(1);
      expect(lettering.success()).toContain('L00042');
      expect(store.busyKey()).toBeNull();
      expect(lettering.reloadSeq()).toBe(2);
    });

    it('une réponse demandée avant la fin de la validation ne fait pas revenir la proposition', fakeAsync(() => {
      const letterReply = new Subject<{ success: boolean; data: { code: string; groupId: string; isPartial: boolean; lineCount: number } }>();
      const inFlight = new Subject<SuggestionsResponse>();
      api.letterEntries.and.returnValue(letterReply);
      api.getLetteringSuggestions.and.returnValues(inFlight, of(result([suggestionDto('k2', 'd2', 'c2')])));

      // La validation part, puis un recalcul (rechargement manuel, par exemple) part avant sa fin.
      store.validate(store.suggestions()[0]);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      letterReply.next({ success: true, data: { code: 'L00042', groupId: 'g', isPartial: false, lineCount: 2 } });
      letterReply.complete();
      inFlight.next(result([suggestionDto('k1', 'd1', 'c1'), suggestionDto('k2', 'd2', 'c2')]));

      expect(store.suggestions().map(s => s.key)).toEqual(['k2']);
      TestBed.flushEffects();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(store.suggestions().map(s => s.key)).toEqual(['k2']);
      expect(store.pending()).toBeFalse();
    }));

    it('verrouille les actions principales pendant l\'appel (busyAction = suggestion)', () => {
      const letterReply = new Subject<{ success: boolean; error?: string }>();
      api.letterEntries.and.returnValue(letterReply);
      api.getLetteringSuggestions.and.returnValue(of(result([])));
      lettering.setPaneSelection('debit', ['d1']);
      lettering.setPaneSelection('credit', ['c1']);
      expect(lettering.canLetter()).toBeTrue();

      store.validate(store.suggestions()[0]);

      expect(lettering.busyAction()).toBe('suggestion');
      expect(lettering.canLetter()).toBeFalse();
      expect(store.canValidate()).toBeFalse();
      letterReply.next({ success: false, error: 'Refus serveur' });
      letterReply.complete();
      expect(lettering.busyAction()).toBeNull();
      expect(store.busyKey()).toBeNull();
    });

    it('libère le verrou après une erreur HTTP', fakeAsync(() => {
      api.letterEntries.and.returnValue(throwError(() => apiError(400, 'LETTERING_UNBALANCED')));
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      store.validate(store.suggestions()[0]);
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(lettering.busyAction()).toBeNull();
      expect(store.busyKey()).toBeNull();
    }));

    it('libère le verrou après un succès ; le rechargement de l\'écran reste suivi par loading', () => {
      const lines = new Subject<never>();
      api.letterEntries.and.returnValue(of({ success: true, data: { code: 'L00042', groupId: 'g', isPartial: false, lineCount: 2 } }));
      api.getLetteringLines.and.returnValue(lines);

      store.validate(store.suggestions()[0]);

      expect(lettering.busyAction()).toBeNull();
      expect(lettering.loading()).toBeTrue();
      expect(lettering.busy()).toBeTrue();
      expect(store.canValidate()).toBeFalse();
    });

    it('ne lettre pas si l\'état a changé pendant la confirmation', () => {
      confirmation.confirm.and.callFake(c => {
        store.busyKey.set('other');
        c.accept?.();
      });
      store.validate(store.suggestions()[0]);
      expect(api.letterEntries).not.toHaveBeenCalled();
    });

    it('n\'envoie rien si l\'utilisateur annule la confirmation', () => {
      confirmation.confirm.and.stub();
      store.validate(store.suggestions()[0]);
      expect(api.letterEntries).not.toHaveBeenCalled();
    });

    it('n\'ouvre pas la confirmation sans le droit de créer', () => {
      auth.hasPermission.and.returnValue(false);
      store.validate(store.suggestions()[0]);
      expect(confirmation.confirm).not.toHaveBeenCalled();
    });

    it('LETTERING_ALREADY_LETTERED : message traduit et rechargement de l\'écran', () => {
      api.letterEntries.and.returnValue(throwError(() => apiError(409, 'LETTERING_ALREADY_LETTERED')));

      store.validate(store.suggestions()[0]);

      expect(api.getLetteringLines).toHaveBeenCalledTimes(1);
      expect(lettering.error()).toContain('déjà lettrée');
      expect(store.suggestions().length).toBe(2);
      expect(store.busyKey()).toBeNull();
    });

    it('autre erreur : message traduit et recalcul des propositions seulement', fakeAsync(() => {
      api.letterEntries.and.returnValue(throwError(() => apiError(400, 'LETTERING_UNBALANCED')));
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      store.validate(store.suggestions()[0]);
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(api.getLetteringLines).not.toHaveBeenCalled();
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);
      expect(lettering.error()).toContain('équilibrée');
    }));

    it('LETTERING_PERIOD_LOCKED : message neutre, pas de rechargement de l\'écran, recalcul des propositions (plan §4.6)', fakeAsync(() => {
      api.letterEntries.and.returnValue(throwError(() => apiError(409, 'LETTERING_PERIOD_LOCKED')));
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      store.validate(store.suggestions()[0]);
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(api.getLetteringLines).not.toHaveBeenCalled();
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);
      expect(lettering.error()).toContain('période clôturée');
      expect(lettering.error()).toContain("Rien n'a été lettré");
    }));

    it('réponse 200 sans succès : affiche l\'erreur du serveur', fakeAsync(() => {
      api.letterEntries.and.returnValue(of({ success: false, error: 'Refus serveur' }));
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      store.validate(store.suggestions()[0]);
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(lettering.error()).toBe('Refus serveur');
    }));
  });

  describe('lettrage en masse', () => {
    type BulkResponse = ReturnType<AccountingService['bulkLetter']> extends Observable<infer R> ? R : never;
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    function report(over: Partial<BulkLetteringResultDto> = {}): BulkResponse {
      return { success: true, data: {
        requestId: 'r', total: 2, lettered: 2, alreadyLettered: 0, rejected: 0, notProcessed: 0, results: [], ...over
      } };
    }

    beforeEach(fakeAsync(() => {
      api.getLetteringSuggestions.and.returnValue(of(result([
        suggestionDto('a', 'd1', 'c1', { score: 95 }),
        suggestionDto('b', 'd2', 'c2', { score: 90 }),
        suggestionDto('m', 'd3', 'c3', { score: 70, confidence: 'Medium' }),
        suggestionDto('x', 'd4', 'c4', { score: 99, bulkEligible: false }),
        suggestionDto('o', 'd1', 'c5', { score: 60 })
      ])));
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      api.getLetteringSuggestions.calls.reset();
    }));

    it('ouverture : confiance haute cochée par défaut, sans ligne commune ; « Tout cocher » ajoute la confiance moyenne', () => {
      store.openBulkDialog();
      expect([...store.bulkSelection()].sort()).toEqual(['a', 'b']);
      expect(store.bulkSelectedCount()).toBe(2);
      expect(store.bulkAccounts()).toEqual(['4111']);
      expect(store.canRunBulk()).toBeTrue();

      store.selectAllBulk();
      expect([...store.bulkSelection()].sort()).toEqual(['a', 'b', 'm']);
      store.clearBulkSelection();
      expect(store.bulkSelectedCount()).toBe(0);
      expect(store.canRunBulk()).toBeFalse();
    });

    it('toggleBulk refuse une proposition inéligible ou qui partage une ligne avec le lot', () => {
      store.openBulkDialog();
      store.toggleBulk('x');
      store.toggleBulk('o');
      expect([...store.bulkSelection()].sort()).toEqual(['a', 'b']);
      store.toggleBulk('a');
      store.toggleBulk('o');
      expect([...store.bulkSelection()].sort()).toEqual(['b', 'o']);
    });

    it('sans droit de création : le dialogue ne s\'ouvre pas et rien n\'est envoyé', () => {
      auth.hasPermission.and.returnValue(false);
      store.openBulkDialog();
      expect(store.bulkDialogOpen()).toBeFalse();
      store.runBulk();
      expect(api.bulkLetter).not.toHaveBeenCalled();
    });

    it('runBulk : un seul envoi malgré un double clic, verrou « bulk » pendant l\'appel, puis rapport', () => {
      const pending = new Subject<BulkResponse>();
      api.bulkLetter.and.returnValue(pending);
      store.openBulkDialog();

      store.runBulk();
      store.runBulk();

      expect(api.bulkLetter).toHaveBeenCalledTimes(1);
      const [requestId, groups] = api.bulkLetter.calls.mostRecent().args;
      expect(requestId).toMatch(UUID_V4);
      expect(groups.map(g => g.clientKey).sort()).toEqual(['a', 'b']);
      expect(groups.find(g => g.clientKey === 'a')?.journalEntryLineIds).toEqual(['d1', 'c1']);
      expect(store.bulkRunning()).toBeTrue();
      expect(lettering.busyAction()).toBe('bulk');
      expect(store.canValidate()).toBeFalse();
      // Pendant l'envoi : sélection figée, fermeture refusée.
      store.toggleBulk('a');
      expect(store.bulkSelection().has('a')).toBeTrue();
      store.closeBulkDialog();
      expect(store.bulkDialogOpen()).toBeTrue();

      pending.next(report());
      pending.complete();

      expect(store.bulkRunning()).toBeFalse();
      expect(lettering.busyAction()).toBeNull();
      expect(store.bulkResult()?.lettered).toBe(2);
      // Après un rapport : plus d'envoi possible depuis ce dialogue.
      expect(store.canRunBulk()).toBeFalse();
      store.runBulk();
      expect(api.bulkLetter).toHaveBeenCalledTimes(1);
    });

    it('fermeture après un rapport : recharge les lignes (qui recalculent les propositions)', () => {
      api.bulkLetter.and.returnValue(of(report()));
      const load = spyOn(lettering, 'load');
      store.openBulkDialog();
      store.runBulk();

      store.closeBulkDialog();

      expect(store.bulkDialogOpen()).toBeFalse();
      expect(store.bulkResult()).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('nouvel identifiant de lot à chaque confirmation', () => {
      api.bulkLetter.and.returnValue(of(report()));
      spyOn(lettering, 'load');
      store.openBulkDialog();
      store.runBulk();
      store.closeBulkDialog();
      store.openBulkDialog();
      store.runBulk();

      expect(api.bulkLetter).toHaveBeenCalledTimes(2);
      const ids = api.bulkLetter.calls.allArgs().map(a => a[0]);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('5xx : « Réessayer » renvoie le même identifiant et les mêmes groupes', () => {
      api.bulkLetter.and.returnValues(throwError(() => apiError(503)), of(report()));
      store.openBulkDialog();
      store.runBulk();

      expect(store.bulkError()).toContain('une partie a pu être lettrée');
      expect(store.canRetryBulk()).toBeTrue();
      expect(store.canRunBulk()).toBeTrue();
      expect(lettering.busyAction()).toBeNull();

      store.retryBulk();

      expect(api.bulkLetter).toHaveBeenCalledTimes(2);
      const [first, second] = api.bulkLetter.calls.allArgs();
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toEqual(first[1]);
      expect(store.bulkError()).toBeNull();
      expect(store.bulkResult()?.lettered).toBe(2);
    });

    it('coupure réseau (statut 0) : rejeu possible', () => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(0)));
      store.openBulkDialog();
      store.runBulk();
      expect(store.canRetryBulk()).toBeTrue();
    });

    it('409 LETTERING_BULK_IN_PROGRESS : message traduit, puis le rejeu (même lot) renvoie le rapport', () => {
      api.bulkLetter.and.returnValues(throwError(() => apiError(409, 'LETTERING_BULK_IN_PROGRESS')), of(report()));
      store.openBulkDialog();
      store.runBulk();
      expect(store.bulkError()).toContain('déjà en cours');
      expect(store.canRetryBulk()).toBeTrue();

      store.retryBulk();

      const [first, second] = api.bulkLetter.calls.allArgs();
      expect(second).toEqual(first);
      expect(store.bulkResult()?.lettered).toBe(2);
      expect(store.bulkError()).toBeNull();
    });

    it('400 : lot refusé en entier, sans rejeu ; la fermeture recalcule les propositions', fakeAsync(() => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(400, 'LETTERING_VALIDATION')));
      const load = spyOn(lettering, 'load');
      api.getLetteringSuggestions.and.returnValue(of(result([])));
      store.openBulkDialog();
      store.runBulk();

      expect(store.bulkError()).toContain('refusé le lot entier');
      expect(store.canRetryBulk()).toBeFalse();
      store.retryBulk();
      expect(api.bulkLetter).toHaveBeenCalledTimes(1);

      store.closeBulkDialog();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
      expect(store.bulkError()).toBeNull();
    }));

    it('400 puis changement de sélection : le message ne s\'applique plus, un nouveau lot est possible', () => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(400, 'LETTERING_VALIDATION')));
      store.openBulkDialog();
      store.runBulk();
      expect(store.bulkError()).not.toBeNull();

      store.toggleBulk('a');

      expect(store.bulkError()).toBeNull();
      expect(store.canRunBulk()).toBeTrue();
    });

    it('5xx puis changement de sélection : erreur et rejeu effacés, mais la fermeture recharge les lignes', () => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(500)));
      const load = spyOn(lettering, 'load');
      store.openBulkDialog();
      store.runBulk();

      store.selectAllBulk();
      expect(store.bulkError()).toBeNull();
      expect(store.canRetryBulk()).toBeFalse();
      store.clearBulkSelection();

      store.closeBulkDialog();
      // Une partie du lot a pu être lettrée : les lignes sont rechargées, pas seulement les propositions.
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('fermeture après une coupure (issue inconnue) : recharge les lignes', () => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(0)));
      const load = spyOn(lettering, 'load');
      store.openBulkDialog();
      store.runBulk();

      store.closeBulkDialog();

      expect(load).toHaveBeenCalledTimes(1);
      expect(store.canRetryBulk()).toBeFalse();
    });

    it('fermeture sans envoi : ni rechargement ni recalcul', () => {
      const load = spyOn(lettering, 'load');
      store.openBulkDialog();
      store.closeBulkDialog();
      expect(load).not.toHaveBeenCalled();
      expect(api.getLetteringSuggestions).not.toHaveBeenCalled();
    });

    it('LETTERING_FEATURE_DISABLED (400) : panneau masqué, dialogue fermé, message dans la bannière', () => {
      api.bulkLetter.and.returnValue(throwError(() => apiError(400, 'LETTERING_FEATURE_DISABLED')));
      store.openBulkDialog();
      store.runBulk();
      expect(store.hidden()).toBeTrue();
      expect(store.bulkDialogOpen()).toBeFalse();
      expect(store.canRetryBulk()).toBeFalse();
      expect(lettering.error()).toBeTruthy();
      expect(store.bulkError()).toBeNull();
    });

    it('réponse 200 sans succès : message du serveur, pas de rapport', () => {
      api.bulkLetter.and.returnValue(of({ success: false, error: 'Refus' }));
      store.openBulkDialog();
      store.runBulk();
      expect(store.bulkError()).toBe('Refus');
      expect(store.bulkResult()).toBeNull();
      expect(lettering.busyAction()).toBeNull();
    });

    it('une réponse de propositions demandée pendant le lot est ignorée', fakeAsync(() => {
      const bulk = new Subject<BulkResponse>();
      api.bulkLetter.and.returnValue(bulk);
      store.openBulkDialog();
      store.runBulk();
      expect(store.canRunBulk()).toBeFalse();

      const stale = new Subject<SuggestionsResponse>();
      api.getLetteringSuggestions.and.returnValue(stale);
      store.refresh();
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);
      expect(api.getLetteringSuggestions).toHaveBeenCalledTimes(1);

      bulk.next(report());
      bulk.complete();
      stale.next(result([suggestionDto('z', 'd9', 'c9')]));

      expect(store.suggestions().some(s => s.key === 'z')).toBeFalse();
      expect(store.bulkResult()).not.toBeNull();
    }));
  });

  describe('newBulkRequestId()', () => {
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    it('format UUID v4', () => {
      expect(newBulkRequestId()).toMatch(UUID_V4);
    });

    it('hors contexte sécurisé (sans randomUUID) : même format, valeurs distinctes', () => {
      const original = crypto.randomUUID;
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
      try {
        const a = newBulkRequestId();
        const b = newBulkRequestId();
        expect(a).toMatch(UUID_V4);
        expect(b).toMatch(UUID_V4);
        expect(a).not.toBe(b);
      } finally {
        Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true, writable: true });
      }
    });
  });
});
