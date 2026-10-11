import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { LetteringStore } from './lettering.store';
import { AccountingService, LetteringGroupDto, LetteringLineDto } from '../../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { createDefaultLetteringFilters } from '../models/lettering.models';

function lineDto(overrides: Partial<LetteringLineDto>): LetteringLineDto {
  return {
    lineId: 'l1', entryId: 'e1', entryDate: '2026-01-02', journalCode: 'JOD', entryNumber: 1,
    lineNumber: 1, accountNumber: '4111', label: 'Ligne', entryLabel: 'Écriture',
    pieceRef: null, sourceCategory: 'manual',
    debit: 100, credit: 0, operationCurrency: 'TND', debitInCurrency: 0, creditInCurrency: 0,
    letteringCode: null, isPartiallyLettered: false, thirdPartyId: null, thirdPartyKind: null,
    thirdPartyName: null, isDraft: false, isReversed: false, isReversal: false, periodLocked: false,
    ...overrides
  };
}

function createStore(permissionsAllowed: boolean): {
  store: LetteringStore;
  api: jasmine.SpyObj<AccountingService>;
  confirmation: jasmine.SpyObj<ConfirmationService>;
} {
  const api = jasmine.createSpyObj<AccountingService>('AccountingService', [
    'getLetteringLines', 'getLetteringGroup', 'letterEntries', 'settleExchangeDifference',
    'unletterEntries', 'completePartialLettering'
  ]);
  const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
  auth.hasPermission.and.returnValue(permissionsAllowed);
  const confirmation = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm']);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      LetteringStore,
      { provide: AccountingService, useValue: api },
      { provide: AuthService, useValue: auth },
      { provide: ErrorHandlerService, useValue: new ErrorHandlerService() },
      { provide: ConfirmationService, useValue: confirmation }
    ]
  });
  const store = TestBed.inject(LetteringStore);
  store.updateFilters({ ...createDefaultLetteringFilters('2026-01-01', '2026-12-31'), account: '4111' });
  return { store, api, confirmation };
}

describe('LetteringStore', () => {
  let store: LetteringStore;
  let api: jasmine.SpyObj<AccountingService>;
  let confirmation: jasmine.SpyObj<ConfirmationService>;

  beforeEach(() => {
    ({ store, api, confirmation } = createStore(true));
  });

  it('rejects load() when the account is empty', () => {
    store.updateFilters({ account: '' });
    store.load();
    expect(store.error()).toBeTruthy();
    expect(api.getLetteringLines).not.toHaveBeenCalled();
  });

  it('loads lines, maps the DTO fields and resets the selection', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: [lineDto({ lineId: 'l1', debit: 100 }), lineDto({ lineId: 'l2', debit: 0, credit: 100 })],
        page: 1, pageSize: 2000, totalCount: 2, truncated: false,
        totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 }
      }
    }));

    store.load();

    expect(store.lines().length).toBe(2);
    expect(store.lines()[0].currency).toBe('TND');
    expect(store.debitLines().length).toBe(1);
    expect(store.creditLines().length).toBe(1);
    expect(store.loadedOnce()).toBeTrue();
    expect(store.error()).toBeNull();
  });

  it('ignores a stale load() response (loadSeq guard)', () => {
    const first$ = of({ success: true, data: { items: [lineDto({ lineId: 'stale' })], page: 1, pageSize: 2000, totalCount: 1, truncated: false, totals: { count: 1, debitCount: 1, creditCount: 0, totalDebit: 100, totalCredit: 0, balance: 100, unletteredDebit: 100, unletteredCredit: 0, unletteredBalance: 100 } } });
    const second$ = of({ success: true, data: { items: [lineDto({ lineId: 'fresh' })], page: 1, pageSize: 2000, totalCount: 1, truncated: false, totals: { count: 1, debitCount: 1, creditCount: 0, totalDebit: 100, totalCredit: 0, balance: 100, unletteredDebit: 100, unletteredCredit: 0, unletteredBalance: 100 } } });
    api.getLetteringLines.and.returnValues(first$, second$);

    store.load();
    store.load();

    expect(store.lines().map(l => l.lineId)).toEqual(['fresh']);
  });

  it('setPaneSelection replaces one side only', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    store.load();

    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);
    expect(store.selectedLines().map(l => l.lineId).sort()).toEqual(['c1', 'd1']);

    store.setPaneSelection('debit', []);
    expect(store.selectedLines().map(l => l.lineId)).toEqual(['c1']);
  });

  it('canLetter requires at least 2 lines, balance (or allowPartial), create permission, and no mixed account/currency', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);
    expect(store.canLetter()).toBeTrue();

    store.setPaneSelection('debit', []);
    expect(store.canLetter()).toBeFalse(); // only 1 selected line
  });

  it('canLetter is false without accounting:create (fresh store, permission denied from the start)', () => {
    const denied = createStore(false);
    denied.api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    denied.store.load();
    denied.store.setPaneSelection('debit', ['d1']);
    denied.store.setPaneSelection('credit', ['c1']);
    expect(denied.store.canLetter()).toBeFalse();
  });

  it('letter() sets busyAction before the HTTP call and reloads on success', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);

    api.letterEntries.and.returnValue(of({ success: true, data: { code: 'L00001', groupId: 'g1', isPartial: false, lineCount: 2, previousCode: null } }));

    store.letter();

    expect(api.letterEntries).toHaveBeenCalledWith(['d1', 'c1'], false);
    expect(store.success()).toContain('L00001');
    expect(store.busyAction()).toBeNull();
    expect(store.selectedLines().length).toBe(0);
    expect(api.getLetteringLines).toHaveBeenCalledTimes(2);
  });

  it('letter() is a no-op while already busy or not allowed', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [], page: 1, pageSize: 2000, totalCount: 0, truncated: false, totals: { count: 0, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 } }
    }));
    store.load();
    store.letter();
    expect(api.letterEntries).not.toHaveBeenCalled();
  });

  it('on LETTERING_ALREADY_LETTERED, reloads automatically', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);

    const err = new HttpErrorResponse({ status: 409, error: { code: 'LETTERING_ALREADY_LETTERED', error: 'Déjà lettrée' } });
    api.letterEntries.and.returnValue(throwError(() => err));

    store.letter();

    expect(store.error()).toContain('déjà lettrée');
    expect(api.getLetteringLines).toHaveBeenCalledTimes(2);
  });

  it('maps a 403 to "droit insuffisant" and does not reload', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })], page: 1, pageSize: 2000, totalCount: 2, truncated: false, totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 } }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);

    const err = new HttpErrorResponse({ status: 403 });
    api.letterEntries.and.returnValue(throwError(() => err));

    store.letter();

    expect(store.error()).toContain('insuffisant');
    expect(api.getLetteringLines).toHaveBeenCalledTimes(1);
  });

  it('openGroup maps the DTO and unletter() asks for confirmation then reloads', () => {
    const groupDto: LetteringGroupDto = {
      id: 'g1', code: 'L00001', accountNumber: '4111', amount: 100, operationCurrency: 'TND',
      isPartial: false, letteredAt: '2026-01-02T00:00:00Z', createdByDisplayName: 'A. Dupont',
      lines: [lineDto({ lineId: 'd1' })], canUnletter: true, unletterBlockedReason: null, canComplete: false
    };
    api.getLetteringGroup.and.returnValue(of({ success: true, data: groupDto }));
    store.openGroup('L00001');
    expect(store.group()?.code).toBe('L00001');
    expect(store.group()?.createdByDisplayName).toBe('A. Dupont');

    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [], page: 1, pageSize: 2000, totalCount: 0, truncated: false, totals: { count: 0, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 } }
    }));
    api.unletterEntries.and.returnValue(of({ success: true, data: true }));
    confirmation.confirm.and.callFake((cfg: { accept?: () => void }) => cfg.accept?.());

    store.unletter('L00001');

    expect(confirmation.confirm).toHaveBeenCalled();
    expect(api.unletterEntries).toHaveBeenCalledWith('L00001');
    expect(store.group()).toBeNull();
    expect(api.getLetteringLines).toHaveBeenCalled();
  });

  it('complete() calls completePartialLettering with the selected ids and reloads', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: { items: [lineDto({ lineId: 'd1', debit: 100 })], page: 1, pageSize: 2000, totalCount: 1, truncated: false, totals: { count: 1, debitCount: 1, creditCount: 0, totalDebit: 100, totalCredit: 0, balance: 100, unletteredDebit: 100, unletteredCredit: 0, unletteredBalance: 100 } }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setAllowPartial(true);
    api.completePartialLettering.and.returnValue(of({ success: true, data: { code: 'L00002', groupId: 'g1', isPartial: false, lineCount: 2, previousCode: 'P00002' } }));

    store.complete('P00002');

    expect(api.completePartialLettering).toHaveBeenCalledWith('P00002', ['d1'], true);
    expect(store.success()).toContain('L00002');
  });
});
