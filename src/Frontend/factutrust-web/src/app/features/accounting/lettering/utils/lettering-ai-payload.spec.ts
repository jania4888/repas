import {
  LETTERING_AI_MAX_HIGHLIGHTS,
  LETTERING_AI_MAX_PIECE_REFS,
  LETTERING_AI_MAX_TEXT,
  LetteringAiPayloadState,
  buildLetteringAnalyzePayload
} from './lettering-ai-payload';
import { LetteringLine } from '../models/lettering.models';
import { LetteringSuggestion } from '../models/lettering-suggestions.models';
import { mapSuggestion } from './lettering-suggestions';
import type { LetteringSuggestionDto, LetteringSuggestionLineDto } from '../../services/accounting.service';

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

  describe('propositions de lettrage (Phase 3, décision 17)', () => {
    const base: LetteringAiPayloadState = {
      account: '4111', from: '2026-01-01', to: '2026-12-31',
      lines: [line({}), line({ lineId: 'l2', entryDate: '2026-01-01', credit: 100, debit: 0 })],
      selectedCount: 1, selectionBalanced: false
    };

    function sLine(id: string, over: Partial<LetteringSuggestionLineDto> = {}): LetteringSuggestionLineDto {
      return {
        lineId: id, entryId: `entry-${id}`, entryDate: '2026-05-01T00:00:00', journalCode: 'JV', entryNumber: 1,
        pieceRef: null, label: `Libellé ${id}`, debit: 0, credit: 0, debitInCurrency: 0, creditInCurrency: 0, ...over
      };
    }

    function suggestion(i: number, over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestion {
      return mapSuggestion({
        key: `sugg-key-${i}`, kind: 'SameReference', category: 'Exact', score: 50 + i,
        confidence: i % 2 ? 'High' : 'Medium',
        accountNumber: '4111999', currencyCode: 'EUR', thirdPartyId: `tp-uuid-${i}`, thirdPartyKind: 1,
        thirdPartyName: `Tiers Secret ${i}`,
        debitLines: [sLine(`dline-${i}`, { debit: 10, pieceRef: `FAC-${i}` })],
        creditLines: [sLine(`cline-${i}`, { credit: 10, pieceRef: `REG-${i}` })],
        totalAmount: 10 + i, localGap: 0, hasExchangeDifference: false, bulkEligible: true,
        reasons: [{ code: 'SAME_REFERENCE', args: { reference: `FAC-${i}`, thirdParty: `Tiers Secret ${i}` } }],
        ...over
      });
    }

    function withoutCapturedAt(payload: unknown): Record<string, unknown> {
      const { capturedAt: _ignored, ...rest } = payload as Record<string, unknown>;
      return rest;
    }

    it('sans propositions (absentes, null ou liste vide) : payload strictement identique', () => {
      const reference = withoutCapturedAt(buildLetteringAnalyzePayload(base));
      for (const suggestions of [undefined, null, { list: [], totalFound: 0, truncated: false }]) {
        expect(withoutCapturedAt(buildLetteringAnalyzePayload({ ...base, suggestions }))).toEqual(reference);
      }
      expect(reference['highlights']).toEqual([]);
      expect(Object.keys(reference['summary'] as object).sort()).toEqual(['selectedCount', 'selectionBalanced', 'totalLines']);
    });

    it('avec 15 propositions : 5 points au plus, meilleurs scores d\'abord, résumé scalaire', () => {
      const list = Array.from({ length: 15 }, (_, i) => suggestion(i));
      const payload = buildLetteringAnalyzePayload({ ...base, suggestions: { list, totalFound: 15, truncated: false } }) as Record<string, unknown>;

      const summary = payload['summary'] as Record<string, unknown>;
      expect(summary['suggestionsCount']).toBe(15);
      expect(summary['suggestionsHighCount']).toBe(7);
      expect('suggestionsHigh' in summary).toBeFalse();
      expect(summary['suggestionsTruncated']).toBeFalse();
      for (const v of Object.values(summary)) expect(['number', 'boolean', 'string']).toContain(typeof v);

      const highlights = payload['highlights'] as Array<Record<string, unknown>>;
      expect(LETTERING_AI_MAX_HIGHLIGHTS).toBe(5);
      expect(highlights.length).toBe(LETTERING_AI_MAX_HIGHLIGHTS);
      expect(highlights.map(h => (h['value'] as { score: number }).score)).toEqual([64, 63, 62, 61, 60]);
      expect(highlights[0]).toEqual({
        type: 'top',
        label: 'Lettrage : match exact · 24 EUR',
        value: { score: 64, confidence: 'Medium', amount: 24, currency: 'EUR', lineCount: 2, reason: 'SAME_REFERENCE', pieceRefs: ['FAC-14', 'REG-14'] },
        context: 'Même référence de pièce'
      });
      // Les lignes et filtres ne changent pas.
      const reference = withoutCapturedAt(buildLetteringAnalyzePayload(base));
      expect(payload['rows']).toEqual(reference['rows']);
      expect(payload['filters']).toEqual(reference['filters']);
    });

    it('liste partielle ou tronquée : suggestionsTruncated vrai, suggestionsCount = total trouvé', () => {
      const payload = buildLetteringAnalyzePayload({
        ...base, suggestions: { list: [suggestion(1)], totalFound: 120, truncated: false }
      }) as Record<string, unknown>;
      const summary = payload['summary'] as Record<string, unknown>;
      expect(summary['suggestionsCount']).toBe(120);
      expect(summary['suggestionsTruncated']).toBeTrue();

      const truncated = buildLetteringAnalyzePayload({
        ...base, suggestions: { list: [suggestion(1)], totalFound: 1, truncated: true }
      }) as Record<string, unknown>;
      expect((truncated['summary'] as Record<string, unknown>)['suggestionsTruncated']).toBeTrue();
    });

    it('scores égaux : ordre stable par clé, quel que soit l\'ordre reçu', () => {
      const b = suggestion(1, { score: 80, key: 'b', debitLines: [sLine('x', { debit: 1, pieceRef: 'REF-B' })] });
      const a = suggestion(2, { score: 80, key: 'a', debitLines: [sLine('y', { debit: 1, pieceRef: 'REF-A' })] });
      for (const list of [[b, a], [a, b]]) {
        const payload = buildLetteringAnalyzePayload({ ...base, suggestions: { list, totalFound: 2, truncated: false } }) as Record<string, unknown>;
        const refs = (payload['highlights'] as Array<{ value: { pieceRefs: string[] } }>).map(h => h.value.pieceRefs[0]);
        expect(refs).toEqual(['REF-A', 'REF-B']);
      }
    });

    it('aucun id, aucun tiers, aucun compte de proposition dans le JSON envoyé', () => {
      const list = Array.from({ length: 15 }, (_, i) => suggestion(i));
      const serialized = JSON.stringify(buildLetteringAnalyzePayload({ ...base, suggestions: { list, totalFound: 15, truncated: false } }));
      for (const forbidden of ['sugg-key-', 'dline-', 'cline-', 'entry-', 'tp-uuid-', 'Tiers Secret', '4111999', 'Libellé dline']) {
        expect(serialized).withContext(forbidden).not.toContain(forbidden);
      }
    });

    it('chaînes bornées à 50 caractères, 2 références de pièce au plus, sans doublon ni vide', () => {
      const long = 'R'.repeat(80);
      const s = suggestion(1, {
        currencyCode: 'C'.repeat(70),
        debitLines: [
          sLine('a', { debit: 1, pieceRef: long }), sLine('b', { debit: 1, pieceRef: long }),
          sLine('c', { debit: 1, pieceRef: '  ' }), sLine('d', { debit: 1, pieceRef: 'P1' }),
          sLine('e', { debit: 1, pieceRef: 'P2' }), sLine('f', { debit: 1, pieceRef: 'P3' }), sLine('g', { debit: 1, pieceRef: 'P4' })
        ],
        reasons: [{ code: 'X'.repeat(90), args: {} }]
      });
      const payload = buildLetteringAnalyzePayload({ ...base, suggestions: { list: [s], totalFound: 1, truncated: false } }) as Record<string, unknown>;
      const h = (payload['highlights'] as Array<Record<string, unknown>>)[0];
      const value = h['value'] as { pieceRefs: string[]; currency: string; reason: string };

      expect(LETTERING_AI_MAX_PIECE_REFS).toBe(2);
      expect(value.pieceRefs).toEqual(['R'.repeat(LETTERING_AI_MAX_TEXT), 'P1']);
      expect((h['label'] as string).length).toBe(LETTERING_AI_MAX_TEXT);
      expect(value.currency.length).toBe(LETTERING_AI_MAX_TEXT);
      expect(value.reason.length).toBe(LETTERING_AI_MAX_TEXT);
      const strings: string[] = [];
      JSON.stringify(h, (_k, v) => { if (typeof v === 'string') strings.push(v); return v; });
      for (const text of strings) expect(text.length).toBeLessThanOrEqual(LETTERING_AI_MAX_TEXT);
    });

    it('proposition sans raison : reason null', () => {
      const payload = buildLetteringAnalyzePayload({
        ...base, suggestions: { list: [suggestion(1, { reasons: [] })], totalFound: 1, truncated: false }
      }) as Record<string, unknown>;
      expect(((payload['highlights'] as Array<Record<string, unknown>>)[0]['value'] as { reason: unknown }).reason).toBeNull();
    });
  });
});
