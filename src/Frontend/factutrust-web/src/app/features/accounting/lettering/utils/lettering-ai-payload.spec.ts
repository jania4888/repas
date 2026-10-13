import { buildLetteringAnalyzePayload } from './lettering-ai-payload';
import { LetteringLine } from '../models/lettering.models';

function line(overrides: Partial<LetteringLine>): LetteringLine {
  return {
    lineId: 'l1', entryId: 'e1', entryDate: '2026-01-02', journalCode: 'JOD', entryNumber: 1,
    accountNumber: '4111', label: 'Ligne', pieceRef: null, documentType: null,
    thirdPartyId: null, thirdPartyKind: null, thirdPartyName: null,
    debit: 100, credit: 0, currency: 'TND', debitInCurrency: 0, creditInCurrency: 0,
    letteringCode: null, isPartiallyLettered: false, isDraft: false, isReversed: false,
    isReversal: false, periodLocked: false, ...overrides
  };
}

describe('buildLetteringAnalyzePayload', () => {
  it('produces the legacy shape: screenId, filters, summary, rows under "lines"', () => {
    const payload = buildLetteringAnalyzePayload({
      account: '4111', from: '2026-01-01', to: '2026-12-31',
      lines: [line({})],
      selectedCount: 1, selectionBalanced: false
    }) as Record<string, unknown>;

    expect(payload['screenId']).toBe('accounting-lettering');
    expect(payload['filters']).toEqual({ account: '4111', from: '2026-01-01', to: '2026-12-31' });
    expect(payload['summary']).toEqual(jasmine.objectContaining({ totalLines: 1, selectedCount: 1, selectionBalanced: false }));
    expect((payload['rows'] as unknown[]).length).toBe(1);
    expect(payload['rows']).toEqual([
      { entryDate: '2026-01-02', label: 'Ligne', debit: 100, credit: 0, letteringCode: null }
    ]);
  });

  it('nulls out empty filters', () => {
    const payload = buildLetteringAnalyzePayload({
      account: '', from: '', to: '', lines: [], selectedCount: 0, selectionBalanced: false
    }) as Record<string, unknown>;
    expect(payload['filters']).toEqual({ account: null, from: null, to: null });
  });

  it('caps rows at 200 lines, sorted by date, and adds no extra fields', () => {
    const lines = Array.from({ length: 250 }, (_, i) => line({
      lineId: `l-${i}`,
      entryDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`
    }));
    const payload = buildLetteringAnalyzePayload({
      account: '4111', from: '2026-01-01', to: '2026-12-31',
      lines, selectedCount: 0, selectionBalanced: false
    }) as Record<string, unknown>;
    const rows = payload['rows'] as Record<string, unknown>[];
    expect(rows.length).toBe(200);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['credit', 'debit', 'entryDate', 'label', 'letteringCode']);
    }
  });

  it('never includes third-party names or line ids', () => {
    const payload = buildLetteringAnalyzePayload({
      account: '4111', from: '2026-01-01', to: '2026-12-31',
      lines: [line({ thirdPartyName: 'Secret Co.' })],
      selectedCount: 0, selectionBalanced: false
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Secret Co.');
    expect(serialized).not.toContain('l1');
  });
});
