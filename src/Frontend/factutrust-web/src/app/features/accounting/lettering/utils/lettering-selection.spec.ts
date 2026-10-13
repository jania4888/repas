import { LetteringLine } from '../models/lettering.models';
import { computeSelectionSummary, paneTotal, selectionGuards, sideCounts, splitBySide } from './lettering-selection';

function line(overrides: Partial<LetteringLine>): LetteringLine {
  return {
    lineId: 'l1',
    entryId: 'e1',
    entryDate: '2026-01-01',
    journalCode: 'JOD',
    entryNumber: 1,
    accountNumber: '4111',
    label: 'Ligne',
    pieceRef: null,
    documentType: null,
    thirdPartyId: null,
    thirdPartyKind: null,
    thirdPartyName: null,
    debit: 0,
    credit: 0,
    currency: 'TND',
    debitInCurrency: 0,
    creditInCurrency: 0,
    letteringCode: null,
    isPartiallyLettered: false,
    isDraft: false,
    isReversed: false,
    isReversal: false,
    periodLocked: false,
    ...overrides
  };
}

/**
 * Copie gelée de l'ancien `computed` de `lettering.component.ts` (avant extraction), conservée ici
 * uniquement pour le test de parité. Ne JAMAIS la faire évoluer : elle doit rester identique à ce
 * que l'écran historique calculait.
 */
function frozenLegacySelectionSummary(sel: readonly LetteringLine[]) {
  let debit = 0;
  let credit = 0;
  let debitCurrency = 0;
  let creditCurrency = 0;
  for (const l of sel) {
    debit += l.debit;
    credit += l.credit;
    debitCurrency += l.debitInCurrency;
    creditCurrency += l.creditInCurrency;
  }
  const currencies = new Set(sel.map(l => l.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const foreign = currency !== null && currency !== 'TND';
  const gap = Math.round((debit - credit) * 1000) / 1000;
  const currencyGap = Math.round((debitCurrency - creditCurrency) * 1000) / 1000;
  const balanced = sel.length >= 2 && (foreign ? currencyGap === 0 : gap === 0);
  return {
    count: sel.length,
    debit,
    credit,
    gap,
    balanced,
    currency,
    foreign,
    debitCurrency,
    creditCurrency,
    currencyGap,
    hasExchangeDifference: foreign && sel.length >= 2 && currencyGap === 0 && gap !== 0
  };
}

/** Générateur déterministe (sans Math.random) de jeux de sélection pour le test de parité. */
function generateDeterministicSelections(): LetteringLine[][] {
  const currencies = ['TND', 'EUR', 'USD'];
  const selections: LetteringLine[][] = [];
  let seed = 1;
  for (let setIndex = 0; setIndex < 200; setIndex++) {
    const size = 1 + (setIndex % 5);
    const lines: LetteringLine[] = [];
    for (let i = 0; i < size; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const amount = ((seed % 500000) / 1000) + 0.001 * ((seed >> 3) % 4);
      const currency = currencies[(setIndex + i) % currencies.length];
      const isDebit = (seed >> 5) % 2 === 0;
      lines.push(line({
        lineId: `l-${setIndex}-${i}`,
        currency,
        debit: isDebit ? amount : 0,
        credit: isDebit ? 0 : amount,
        debitInCurrency: isDebit && currency !== 'TND' ? amount / 3.3 : 0,
        creditInCurrency: !isDebit && currency !== 'TND' ? amount / 3.3 : 0
      }));
    }
    selections.push(lines);
  }
  return selections;
}

describe('computeSelectionSummary', () => {
  it('returns balanced=false and hasExchangeDifference=false for 0 or 1 line', () => {
    expect(computeSelectionSummary([]).balanced).toBeFalse();
    expect(computeSelectionSummary([]).hasExchangeDifference).toBeFalse();
    const one = computeSelectionSummary([line({ debit: 100 })]);
    expect(one.balanced).toBeFalse();
    expect(one.hasExchangeDifference).toBeFalse();
  });

  it('TND 1200,000 D + 1200,000 C => balanced, gap=0', () => {
    const s = computeSelectionSummary([
      line({ debit: 1200, lineId: 'a' }),
      line({ credit: 1200, lineId: 'b' })
    ]);
    expect(s.balanced).toBeTrue();
    expect(s.gap).toBe(0);
  });

  it('rounds floating point sums to 3 decimals before comparing', () => {
    const s = computeSelectionSummary([
      line({ debit: 0.1, lineId: 'a' }),
      line({ debit: 0.2, lineId: 'b' }),
      line({ credit: 0.3, lineId: 'c' })
    ]);
    expect(s.gap).toBe(0);
    expect(s.balanced).toBeTrue();
  });

  it('10.0004 vs 10 is balanced after rounding, 10.001 vs 10 is not', () => {
    const close = computeSelectionSummary([
      line({ debit: 10.0004, lineId: 'a' }),
      line({ credit: 10, lineId: 'b' })
    ]);
    expect(close.balanced).toBeTrue();

    const notClose = computeSelectionSummary([
      line({ debit: 10.001, lineId: 'a' }),
      line({ credit: 10, lineId: 'b' })
    ]);
    expect(notClose.balanced).toBeFalse();
  });

  it('EUR 1000D (rate 3.3) + 1000C (rate 3.4): foreign, currencyGap=0, exchange difference', () => {
    const s = computeSelectionSummary([
      line({ lineId: 'a', currency: 'EUR', debit: 3300, debitInCurrency: 1000 }),
      line({ lineId: 'b', currency: 'EUR', credit: 3400, creditInCurrency: 1000 })
    ]);
    expect(s.foreign).toBeTrue();
    expect(s.currencyGap).toBe(0);
    expect(s.gap).toBe(-100);
    expect(s.balanced).toBeTrue();
    expect(s.hasExchangeDifference).toBeTrue();
  });

  it('EUR unbalanced in currency => balanced=false', () => {
    const s = computeSelectionSummary([
      line({ lineId: 'a', currency: 'EUR', debit: 3300, debitInCurrency: 1000 }),
      line({ lineId: 'b', currency: 'EUR', credit: 3400, creditInCurrency: 900 })
    ]);
    expect(s.balanced).toBeFalse();
  });

  it('mixed EUR + USD => currency=null, foreign=false, balance judged in TND (frozen behavior)', () => {
    const s = computeSelectionSummary([
      line({ lineId: 'a', currency: 'EUR', debit: 100 }),
      line({ lineId: 'b', currency: 'USD', credit: 100 })
    ]);
    expect(s.currency).toBeNull();
    expect(s.foreign).toBeFalse();
    expect(s.balanced).toBeTrue();
    expect(selectionGuards([
      line({ lineId: 'a', currency: 'EUR', debit: 100 }),
      line({ lineId: 'b', currency: 'USD', credit: 100 })
    ]).mixedCurrencies).toBeTrue();
  });

  it('gap sign: debit > credit is positive', () => {
    const s = computeSelectionSummary([
      line({ lineId: 'a', debit: 150 }),
      line({ lineId: 'b', credit: 100 })
    ]);
    expect(s.gap).toBe(50);
  });

  it('parity: matches the frozen legacy computed on ~200 deterministic selections', () => {
    for (const sel of generateDeterministicSelections()) {
      expect(computeSelectionSummary(sel)).toEqual(frozenLegacySelectionSummary(sel));
    }
  });
});

describe('selectionGuards', () => {
  it('flags multipleAccounts when more than one account number is present', () => {
    const g = selectionGuards([
      line({ lineId: 'a', accountNumber: '4111' }),
      line({ lineId: 'b', accountNumber: '41110001' })
    ]);
    expect(g.multipleAccounts).toBeTrue();
  });

  it('does not flag a single-account, single-currency selection', () => {
    const g = selectionGuards([line({ lineId: 'a' }), line({ lineId: 'b' })]);
    expect(g.mixedCurrencies).toBeFalse();
    expect(g.multipleAccounts).toBeFalse();
  });
});

describe('splitBySide', () => {
  it('routes a line with debit !== 0 to the debit side, otherwise credit', () => {
    const { debit, credit } = splitBySide([
      line({ lineId: 'a', debit: 10 }),
      line({ lineId: 'b', credit: 10 }),
      line({ lineId: 'c', debit: 0, credit: 0 })
    ]);
    expect(debit.map(l => l.lineId)).toEqual(['a']);
    expect(credit.map(l => l.lineId)).toEqual(['b', 'c']);
  });
});

describe('sideCounts', () => {
  it('counts debit and credit lines independently', () => {
    const c = sideCounts([
      line({ lineId: 'a', debit: 10 }),
      line({ lineId: 'b', debit: 20 }),
      line({ lineId: 'c', credit: 30 })
    ]);
    expect(c).toEqual({ debitCount: 2, creditCount: 1 });
  });
});

describe('paneTotal', () => {
  it('sums TND and currency amounts for the requested side', () => {
    const t = paneTotal([
      line({ lineId: 'a', debit: 100, debitInCurrency: 30, currency: 'EUR' }),
      line({ lineId: 'b', debit: 50, debitInCurrency: 15, currency: 'EUR' })
    ], 'debit');
    expect(t).toEqual({ amount: 150, amountInCurrency: 45 });
  });
});
