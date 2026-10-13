import { BankLineProposal, BankStatementImportSession } from './bank-statement-import.models';
import {
  computeBalanceMode,
  isRowReady,
  isSettledRow,
  maskRib,
  methodLabel,
  needsThirdPartyRow,
  pageList,
  pageStates,
  ribTail,
  rowToGenerateItem,
  toReviewRow
} from './bank-statement-posting.logic';

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

function session(overrides: Partial<BankStatementImportSession> = {}): BankStatementImportSession {
  return {
    id: 's-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'acc-1',
    journalCode: 'JB',
    fileName: 'releve.pdf',
    pageCount: 1,
    extractionMethod: 'layout',
    profileId: null,
    aiProviderKind: null,
    errorCode: null,
    statementId: 'st-1',
    expiresAt: '2026-10-14T00:00:00',
    extraction: null,
    balanceCheck: null,
    canConfirm: true,
    ...overrides
  };
}

describe('bank-statement-posting.logic', () => {
  describe('toReviewRow', () => {
    it('maps a proposal to an editable row with safe defaults', () => {
      const p = proposal({ vatSplit: { netAmount: 100, vatAmount: 19, vatAccountNumber: '4366', implied: false } });
      const row = toReviewRow(p);
      expect(row.proposal).toBe(p);
      expect(row.selected).toBe(true);
      expect(row.account).toBe('6278');
      expect(row.thirdPartyName).toBe('');
      expect(row.splitVat).toBe(true);
      expect(row.remember).toBe(false);
    });

    it('does not propose VAT split when the proposal already implies it', () => {
      const p = proposal({ vatSplit: { netAmount: 100, vatAmount: 19, vatAccountNumber: '4366', implied: true } });
      expect(toReviewRow(p).splitVat).toBe(false);
    });
  });

  describe('isSettledRow / needsThirdPartyRow', () => {
    it('treats Generated/Reconciled/AlreadyPosted/AlreadyImported as settled', () => {
      expect(isSettledRow(toReviewRow(proposal({ status: 'Generated' })))).toBe(true);
      expect(isSettledRow(toReviewRow(proposal({ status: 'AlreadyImported' })))).toBe(true);
      expect(isSettledRow(toReviewRow(proposal({ status: 'Proposed' })))).toBe(false);
    });

    it('requires a third party only for collective accounts', () => {
      expect(needsThirdPartyRow(toReviewRow(proposal({ accountNumber: '411001' })))).toBe(true);
      expect(needsThirdPartyRow(toReviewRow(proposal({ accountNumber: '6278' })))).toBe(false);
    });
  });

  describe('isRowReady', () => {
    const isActive = (account: string): boolean => account === '6278' || account === '411001';

    it('rejects a row without account', () => {
      const row = toReviewRow(proposal({ accountNumber: null }));
      expect(isRowReady(row, isActive)).toBe(false);
    });

    it('rejects a row whose account is not active', () => {
      const row = toReviewRow(proposal({ accountNumber: '9999' }));
      expect(isRowReady(row, isActive)).toBe(false);
    });

    it('accepts a non-collective active account without third party', () => {
      const row = toReviewRow(proposal({ accountNumber: '6278' }));
      expect(isRowReady(row, isActive)).toBe(true);
    });

    it('requires a matching third party kind on a collective account', () => {
      const row = toReviewRow(proposal({ accountNumber: '411001', thirdPartyId: null }));
      expect(isRowReady(row, isActive)).toBe(false);
      row.thirdPartyId = 'tp-1';
      row.thirdPartyKind = 1; // client, matches 411
      expect(isRowReady(row, isActive)).toBe(true);
      row.thirdPartyKind = 2; // supplier does not match 411
      expect(isRowReady(row, isActive)).toBe(false);
    });
  });

  describe('rowToGenerateItem', () => {
    it('drops the third party on non-collective accounts even if one was set', () => {
      const row = toReviewRow(proposal({ accountNumber: '6278', thirdPartyId: 'tp-1', thirdPartyKind: 'Client' as never }));
      const item = rowToGenerateItem(row);
      expect(item.accountNumber).toBe('6278');
      expect(item.thirdPartyId).toBeNull();
      expect(item.thirdPartyKind).toBe('None');
    });

    it('splits VAT only on the debit side when splitVat is set', () => {
      const vatSplit = { netAmount: 100, vatAmount: 19, vatAccountNumber: '4366', implied: false };
      const debitRow = toReviewRow(proposal({ isDebit: true, vatSplit }));
      expect(rowToGenerateItem(debitRow).vatAmount).toBe(19);

      const creditRow = toReviewRow(proposal({ isDebit: false, vatSplit }));
      expect(rowToGenerateItem(creditRow).vatAmount).toBeNull();
    });

    it('keeps rememberRule and an explicit label', () => {
      const row = toReviewRow(proposal());
      row.remember = true;
      expect(rowToGenerateItem(row, 'Virement client').label).toBe('Virement client');
      expect(rowToGenerateItem(row).rememberRule).toBe(true);
    });
  });

  describe('computeBalanceMode', () => {
    it('returns null without a balance check', () => {
      expect(computeBalanceMode(session({ balanceCheck: null }))).toBeNull();
    });

    it('returns ok when balanced', () => {
      const s = session({ balanceCheck: { sumDebits: 100, sumCredits: 100, computedClosing: 0, difference: 0, isBalanced: true } });
      expect(computeBalanceMode(s)).toBe('ok');
    });

    it('returns warning when unbalanced but acknowledgement is allowed by the server', () => {
      const s = session({
        balanceCheck: { sumDebits: 100, sumCredits: 90, computedClosing: 0, difference: 10, isBalanced: false },
        requiresBalanceAcknowledgement: true
      });
      expect(computeBalanceMode(s)).toBe('warning');
    });

    it('returns blocking when unbalanced and the server disallows acknowledgement', () => {
      const s = session({
        balanceCheck: { sumDebits: 100, sumCredits: 90, computedClosing: 0, difference: 10, isBalanced: false },
        requiresBalanceAcknowledgement: false
      });
      expect(computeBalanceMode(s)).toBe('blocking');
    });
  });

  describe('maskRib / ribTail', () => {
    it('masks a RIB keeping the first two and last four digits', () => {
      expect(maskRib('07123456789012345678')).toBe('07 … 5678');
    });

    it('returns a dash when there is no RIB', () => {
      expect(maskRib(null)).toBe('—');
    });

    it('extracts the last four digits ignoring separators', () => {
      expect(ribTail('07 1234 5678')).toBe('5678');
      expect(ribTail('1')).toBe('????');
    });
  });

  describe('pageStates / pageList', () => {
    it('returns an empty list without any page', () => {
      expect(pageStates(session({ pageCount: 0, extraction: null }))).toEqual([]);
    });

    it('marks pages already read as done and the next one as current', () => {
      const s = session({
        pageCount: 3,
        progressPercent: 0,
        extraction: {
          header: null as never,
          lines: [],
          issues: [],
          profileId: 'p-1',
          pageCount: 3,
          unresolvedPages: [],
          aiPlan: {
            scannedPages: [1, 2, 3],
            textPages: [],
            reason: null,
            estimatedCalls: 3,
            estimatedSeconds: 0,
            pageReadings: [{ page: 1, engine: 'vision-model', model: null, attempts: 1, durationMs: 0, lineCount: 0, failureReason: null }]
          }
        }
      });
      const states = pageStates(s);
      expect(states).toEqual([
        { page: 1, state: 'done' },
        { page: 2, state: 'current' },
        { page: 3, state: 'todo' }
      ]);
    });

    it('joins page numbers sorted ascending', () => {
      expect(pageList([3, 1, 2])).toBe('1, 2, 3');
    });
  });

  describe('methodLabel', () => {
    it('reports no AI reading when the ai_unavailable issue blocks the session', () => {
      const s = session({
        extractionMethod: 'ai',
        extraction: {
          header: null as never,
          lines: [],
          issues: [{ code: 'statement.ai_unavailable', severity: 'Blocking', message: '', pageNumber: null, lineIndex: null }],
          profileId: 'p-1',
          pageCount: 1,
          unresolvedPages: []
        }
      });
      expect(methodLabel(s)).toContain('Lecture IA non effectuée');
    });

    it('reports a direct read without AI for layout extraction', () => {
      expect(methodLabel(session({ extractionMethod: 'layout' }))).toContain('Lecture directe du PDF');
    });

    it('returns a dash for an unknown extraction method', () => {
      expect(methodLabel(session({ extractionMethod: 'something-else' }))).toBe('—');
    });
  });
});
