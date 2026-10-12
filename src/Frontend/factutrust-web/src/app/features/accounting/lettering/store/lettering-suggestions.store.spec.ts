import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import {
  AccountingService,
  LetteringLineDto,
  LetteringSuggestionDto,
  LetteringSuggestionLineDto,
  LetteringSuggestionsResultDto
} from '../../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { createDefaultLetteringFilters } from '../models/lettering.models';
import { LetteringStore } from './lettering.store';
import { LETTERING_SUGGESTIONS_DEBOUNCE_MS, LetteringSuggestionsStore } from './lettering-suggestions.store';

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

  beforeEach(() => {
    api = jasmine.createSpyObj<AccountingService>('AccountingService', [
      'getLetteringLines', 'getLetteringSuggestions', 'letterEntries', 'getLetteringGroup'
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
        { provide: ConfirmationService, useValue: confirmation }
      ]
    });
    lettering = TestBed.inject(LetteringStore);
    store = TestBed.inject(LetteringSuggestionsStore);
    lettering.updateFilters({ ...createDefaultLetteringFilters('2026-01-01', '2026-12-31'), account: '4111' });
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

    it('sans compte : vide la liste sans appel', fakeAsync(() => {
      lettering.updateFilters({ account: '' });
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

    it('réponse 200 sans succès : affiche l\'erreur du serveur', fakeAsync(() => {
      api.letterEntries.and.returnValue(of({ success: false, error: 'Refus serveur' }));
      api.getLetteringSuggestions.and.returnValue(of(result([])));

      store.validate(store.suggestions()[0]);
      tick(LETTERING_SUGGESTIONS_DEBOUNCE_MS);

      expect(lettering.error()).toBe('Refus serveur');
    }));
  });
});
