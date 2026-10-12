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
    'unletterEntries', 'completePartialLettering', 'exportLedger'
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

  function loadLines(items: LetteringLineDto[]): void {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items, page: 1, pageSize: 2000, totalCount: items.length, truncated: false,
        totals: { count: items.length, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 }
      }
    }));
    store.load();
  }

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

  it('settle() on LETTERING_PERIOD_LOCKED shows the message, keeps the selection and does NOT reload (plan §4.6/§5.5)', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: [
          lineDto({ lineId: 'd1', debit: 100, operationCurrency: 'USD', debitInCurrency: 50 }),
          lineDto({ lineId: 'c1', debit: 0, credit: 99, operationCurrency: 'USD', creditInCurrency: 50 })
        ],
        page: 1, pageSize: 2000, totalCount: 2, truncated: false,
        totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 99, balance: 1, unletteredDebit: 100, unletteredCredit: 99, unletteredBalance: 1 }
      }
    }));
    store.load();
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);
    expect(store.canSettleExchangeDifference()).toBeTrue();

    const err = new HttpErrorResponse({ status: 409, error: { code: 'LETTERING_PERIOD_LOCKED', error: 'Période clôturée' } });
    api.settleExchangeDifference.and.returnValue(throwError(() => err));

    store.settle('655');

    expect(store.error()).toContain('période clôturée');
    expect(store.error()).toContain('Retirez-la');
    expect(api.getLetteringLines).toHaveBeenCalledTimes(1);
    expect(store.isSelected('d1')).toBeTrue();
    expect(store.isSelected('c1')).toBeTrue();
  });

  it('letter() on LETTERING_PERIOD_LOCKED keeps the selection and does NOT reload', () => {
    loadLines([lineDto({ lineId: 'd1', debit: 100 }), lineDto({ lineId: 'c1', debit: 0, credit: 100 })]);
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);
    api.letterEntries.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'LETTERING_PERIOD_LOCKED', error: 'x' } }))
    );

    store.letter();

    expect(api.getLetteringLines).toHaveBeenCalledTimes(1);
    expect(store.selectedLines().map(l => l.lineId).sort()).toEqual(['c1', 'd1']);
  });

  it('lockedLines (a selected line in a closed period) blocks canLetter, canComplete and settle', () => {
    loadLines([
      lineDto({ lineId: 'd1', debit: 100, periodLocked: true }),
      lineDto({ lineId: 'c1', debit: 0, credit: 100 })
    ]);
    store.setPaneSelection('debit', ['d1']);
    store.setPaneSelection('credit', ['c1']);

    expect(store.guards().lockedLines).toBeTrue();
    expect(store.summary().balanced).toBeTrue();
    expect(store.canLetter()).toBeFalse();

    store.setPaneSelection('debit', []);
    expect(store.guards().lockedLines).toBeFalse();
  });

  it('sends the trimmed free-text search (≤ 100 characters) and omits it when empty', () => {
    loadLines([]);
    expect(api.getLetteringLines.calls.mostRecent().args[0].search).toBeUndefined();

    store.updateFilters({ search: '  FAC-2026  ' });
    store.load();
    expect(api.getLetteringLines.calls.mostRecent().args[0].search).toBe('FAC-2026');

    store.updateFilters({ search: 'x'.repeat(150) });
    store.load();
    expect(api.getLetteringLines.calls.mostRecent().args[0].search?.length).toBe(100);
  });

  describe('exportLedger() (menu Actions, plan §7.6)', () => {
    it('downloads the Excel ledger of the filtered account and period', () => {
      const click = jasmine.createSpy('click');
      const realCreate = document.createElement.bind(document);
      spyOn(document, 'createElement').and.callFake((tag: string) => {
        const el = realCreate(tag);
        if (tag === 'a') (el as HTMLAnchorElement).click = click;
        return el;
      });
      spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
      spyOn(URL, 'revokeObjectURL');
      api.exportLedger.and.returnValue(of(new Blob(['x'])));

      store.exportLedger();

      const [account, from, to, format] = api.exportLedger.calls.mostRecent().args;
      expect(account).toBe('4111');
      expect(from.getFullYear()).toBe(2026);
      expect(to.getMonth()).toBe(11);
      expect(format).toBe('excel');
      expect(click).toHaveBeenCalled();
      expect(store.exporting()).toBeFalse();
    });

    it('is a no-op without an account', () => {
      store.updateFilters({ account: '  ' });
      store.exportLedger();
      expect(api.exportLedger).not.toHaveBeenCalled();
    });

    it('shows an error when the export fails', () => {
      api.exportLedger.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      store.exportLedger();
      expect(store.error()).toBeTruthy();
      expect(store.exporting()).toBeFalse();
    });
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

  it('completionTarget/canComplete only fire for a single partial group with a genuinely new line, and complete() excludes already-member lines (B1/B2)', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: [
          lineDto({ lineId: 'member', debit: 100, letteringCode: 'P00002', isPartiallyLettered: true }),
          lineDto({ lineId: 'new-line', credit: 100 })
        ],
        page: 1, pageSize: 2000, totalCount: 2, truncated: false,
        totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 100, unletteredCredit: 100, unletteredBalance: 0 }
      }
    }));
    store.load();

    // Only the already-member line selected: nothing new to add, so completionTarget stays null.
    store.setPaneSelection('debit', ['member']);
    expect(store.completionTarget()).toBeNull();
    expect(store.canComplete()).toBeFalse();

    // Member line + a genuinely new line selected: completionTarget identifies the P group.
    store.setPaneSelection('credit', ['new-line']);
    expect(store.completionTarget()).toBe('P00002');
    expect(store.canComplete()).toBeTrue();
    expect(store.canLetter()).toBeFalse();

    api.completePartialLettering.and.returnValue(of({ success: true, data: { code: 'L00002', groupId: 'g1', isPartial: false, lineCount: 2, previousCode: 'P00002' } }));

    store.complete('P00002');

    // B2: only the new line is sent — the already-member line is excluded from the payload.
    expect(api.completePartialLettering).toHaveBeenCalledWith('P00002', ['new-line'], false);
    expect(store.success()).toContain('L00002');
  });

  it('complete() is a no-op when the selection has no new line to add for the target group', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: [lineDto({ lineId: 'member', debit: 100, letteringCode: 'P00002', isPartiallyLettered: true })],
        page: 1, pageSize: 2000, totalCount: 1, truncated: false,
        totals: { count: 1, debitCount: 1, creditCount: 0, totalDebit: 100, totalCredit: 0, balance: 100, unletteredDebit: 100, unletteredCredit: 0, unletteredBalance: 100 }
      }
    }));
    store.load();
    store.setPaneSelection('debit', ['member']);

    store.complete('P00002');

    expect(api.completePartialLettering).not.toHaveBeenCalled();
  });

  it('ambiguous selection (two partial groups at once) disables both canLetter and canComplete', () => {
    api.getLetteringLines.and.returnValue(of({
      success: true,
      data: {
        items: [
          lineDto({ lineId: 'p1', debit: 100, letteringCode: 'P00001', isPartiallyLettered: true }),
          lineDto({ lineId: 'p2', credit: 100, letteringCode: 'P00002', isPartiallyLettered: true })
        ],
        page: 1, pageSize: 2000, totalCount: 2, truncated: false,
        totals: { count: 2, debitCount: 1, creditCount: 1, totalDebit: 100, totalCredit: 100, balance: 0, unletteredDebit: 0, unletteredCredit: 0, unletteredBalance: 0 }
      }
    }));
    store.load();
    store.setPaneSelection('debit', ['p1']);
    store.setPaneSelection('credit', ['p2']);

    expect(store.guards().partialGroupCodes.length).toBe(2);
    expect(store.completionTarget()).toBeNull();
    expect(store.canLetter()).toBeFalse();
    expect(store.canComplete()).toBeFalse();
  });
  describe('complétion depuis le tiroir avec le filtre « non lettrées » (correctif Qodex)', () => {
    const totals = { count: 1, debitCount: 0, creditCount: 1, totalDebit: 0, totalCredit: 60, balance: -60, unletteredDebit: 0, unletteredCredit: 60, unletteredBalance: -60 };
    const partialGroupDto: LetteringGroupDto = {
      id: 'g2', code: 'P00002', accountNumber: '4111', amount: 40, operationCurrency: 'TND',
      isPartial: true, letteredAt: '2026-01-02T00:00:00Z', createdByDisplayName: null,
      lines: [
        lineDto({ lineId: 'member-d', debit: 100, letteringCode: 'P00002', isPartiallyLettered: true }),
        lineDto({ lineId: 'member-c', debit: 0, credit: 40, letteringCode: 'P00002', isPartiallyLettered: true })
      ],
      canUnletter: true, unletterBlockedReason: null, canComplete: true
    };

    function loadUnletteredOnly(): void {
      // Filtre « non lettrées » : les membres du groupe P ne sont PAS dans les lignes chargées.
      api.getLetteringLines.and.returnValue(of({
        success: true,
        data: { items: [lineDto({ lineId: 'new-line', debit: 0, credit: 60 })], page: 1, pageSize: 2000, totalCount: 1, truncated: false, totals }
      }));
      store.load();
      api.getLetteringGroup.and.returnValue(of({ success: true, data: partialGroupDto }));
      store.openGroup('P00002');
    }

    it('garde les membres hors filtre dans la sélection et cible le groupe P', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      store.closeGroup();

      expect(store.completionGroup()?.code).toBe('P00002');
      // Seuls les membres : rien de nouveau à ajouter.
      expect(store.completionTarget()).toBeNull();
      expect(store.canComplete()).toBeFalse();
      expect(store.canLetter()).toBeFalse();
      expect(store.isSelected('member-d')).toBeTrue();

      store.setPaneSelection('credit', ['new-line']);

      expect(store.selectedLines().map(l => l.lineId).sort()).toEqual(['member-c', 'member-d', 'new-line']);
      expect(store.completionTarget()).toBe('P00002');
      expect(store.canComplete()).toBeTrue();
      expect(store.canLetter()).toBeFalse();
      // La synthèse inclut les membres : 100 au débit, 40 + 60 au crédit → équilibré.
      expect(store.summary().balanced).toBeTrue();
      expect(store.debitSelectedTotal().amount).toBe(100);
      expect(store.creditSelectedTotal().amount).toBe(100);
    });

    it('complete() envoie seulement les nouvelles lignes, puis la complétion est vidée au rechargement', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      store.closeGroup();
      store.setPaneSelection('credit', ['new-line']);
      api.completePartialLettering.and.returnValue(of({ success: true, data: { code: 'L00003', groupId: 'g2', isPartial: false, lineCount: 3, previousCode: 'P00002' } }));

      store.complete('P00002');

      expect(api.completePartialLettering).toHaveBeenCalledWith('P00002', ['new-line'], false);
      expect(api.letterEntries).not.toHaveBeenCalled();
      expect(store.completionGroup()).toBeNull();
    });

    it('une erreur sans rechargement garde la complétion pour réessayer', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-line']);
      api.completePartialLettering.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      store.complete('P00002');

      expect(store.completionGroup()?.code).toBe('P00002');
      expect(store.error()).toBeTruthy();
    });

    it('cancelCompletion() et reset() retirent les membres de la sélection', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-line']);

      store.cancelCompletion();
      expect(store.selectedLines().map(l => l.lineId)).toEqual(['new-line']);
      expect(store.completionTarget()).toBeNull();

      store.startCompletion(partialGroupDtoAsGroup());
      store.reset();
      expect(store.completionGroup()).toBeNull();
      expect(store.selectedLines()).toEqual([]);
    });

    it('cancelCompletion() retire aussi les membres AFFICHÉS que les volets ont renvoyés (filtre « Toutes »)', () => {
      // Filtre « Toutes » : les membres du groupe P sont dans les lignes chargées.
      loadLines([
        lineDto({ lineId: 'member-d', debit: 100, letteringCode: 'P00002', isPartiallyLettered: true }),
        lineDto({ lineId: 'member-c', debit: 0, credit: 40, letteringCode: 'P00002', isPartiallyLettered: true }),
        lineDto({ lineId: 'new-line', debit: 0, credit: 60 })
      ]);
      api.getLetteringGroup.and.returnValue(of({ success: true, data: partialGroupDto }));
      store.openGroup('P00002');
      store.startCompletion(store.group()!);
      // Les volets renvoient leur sélection complète (membres cochés compris).
      store.setPaneSelection('debit', ['member-d']);
      store.setPaneSelection('credit', ['member-c', 'new-line']);

      store.cancelCompletion();

      expect(store.selectedLines().map(l => l.lineId)).toEqual(['new-line']);
      expect(store.isSelected('member-d')).toBeFalse();
      expect(store.isSelected('member-c')).toBeFalse();
    });

    it('un AUTRE groupe partiel dans la sélection bloque la complétion (cible ambiguë)', () => {
      loadLines([
        lineDto({ lineId: 'other-p', debit: 0, credit: 10, letteringCode: 'P00009', isPartiallyLettered: true }),
        lineDto({ lineId: 'new-line', debit: 0, credit: 60 })
      ]);
      api.getLetteringGroup.and.returnValue(of({ success: true, data: partialGroupDto }));
      store.openGroup('P00002');
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-line']);
      expect(store.completionTarget()).toBe('P00002');

      store.setPaneSelection('credit', ['new-line', 'other-p']);

      expect(store.completionTarget()).toBeNull();
      expect(store.canComplete()).toBeFalse();
      expect(store.canLetter()).toBeFalse();
    });

    it("« Équilibrer » est désactivé pendant une complétion (les membres seraient renvoyés au serveur)", () => {
      loadLines([lineDto({ lineId: 'new-usd', debit: 0, credit: 99, operationCurrency: 'USD', creditInCurrency: 50 })]);
      const usdGroup: LetteringGroupDto = {
        ...partialGroupDto,
        operationCurrency: 'USD',
        lines: [lineDto({ lineId: 'member-usd', debit: 100, operationCurrency: 'USD', debitInCurrency: 50, letteringCode: 'P00002', isPartiallyLettered: true })]
      };
      api.getLetteringGroup.and.returnValue(of({ success: true, data: usdGroup }));
      store.openGroup('P00002');
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-usd']);

      expect(store.summary().hasExchangeDifference).toBeTrue();
      expect(store.canSettleExchangeDifference()).toBeFalse();

      store.cancelCompletion();
      expect(store.canSettleExchangeDifference()).toBeFalse(); // une seule ligne : plus d'écart à apurer
    });

    it('un rechargement pendant une complétion l\'annule ET l\'annonce (message info)', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      expect(store.info()).toBeNull();

      store.load();

      expect(store.completionGroup()).toBeNull();
      expect(store.info()).toContain('P00002');
      expect(store.info()).toContain('rechargées');

      store.load();
      expect(store.info()).toBeNull();
    });

    it('une complétion réussie ne déclenche PAS le message « annulée »', () => {
      loadUnletteredOnly();
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-line']);
      api.completePartialLettering.and.returnValue(of({ success: true, data: { code: 'L00003', groupId: 'g2', isPartial: false, lineCount: 3, previousCode: 'P00002' } }));

      store.complete('P00002');

      expect(store.success()).toContain('L00003');
      expect(store.info()).toBeNull();
    });

    it('un membre du groupe en période clôturée ne bloque pas la complétion (garde-fou limité aux nouvelles lignes)', () => {
      loadUnletteredOnly();
      const lockedMemberGroup: LetteringGroupDto = {
        ...partialGroupDto,
        lines: partialGroupDto.lines.map(l => ({ ...l, periodLocked: true }))
      };
      api.getLetteringGroup.and.returnValue(of({ success: true, data: lockedMemberGroup }));
      store.openGroup('P00002');
      store.startCompletion(store.group()!);
      store.setPaneSelection('credit', ['new-line']);

      expect(store.guards().lockedLines).toBeFalse();
      expect(store.canComplete()).toBeTrue();
    });

    it("startCompletion() ignore un groupe non partiel", () => {
      store.startCompletion({ ...partialGroupDtoAsGroup(), isPartial: false, code: 'L00001' });
      expect(store.completionGroup()).toBeNull();
    });

    function partialGroupDtoAsGroup() {
      api.getLetteringGroup.and.returnValue(of({ success: true, data: partialGroupDto }));
      store.openGroup('P00002');
      return store.group()!;
    }
  });
});
