import {
  calculateMarginPercent,
  calculatePurchaseTtc,
  calculateSaleTtc,
  calculateUnitPriceFromMargin,
  deriveUnitPriceFromTtc,
  recalculatePricing,
  resolvePurchaseTtc
} from './product-pricing.utils';

describe('product-pricing.utils', () => {
  it('calculates Axeane example HT from margin', () => {
    expect(calculateUnitPriceFromMargin(45000, 12)).toBe(50400);
  });

  it('calculates sale TTC with 13% VAT', () => {
    expect(calculateSaleTtc(50400, 13, false)).toBe(56952);
  });

  describe('purchase TTC (HT + VAT, no FODEC)', () => {
    it('calculates catalog purchase TTC for 10.432 HT at 19% VAT', () => {
      expect(calculatePurchaseTtc(10.432, 19)).toBe(12.414);
    });

    it('resolvePurchaseTtc returns null when HT is null', () => {
      expect(resolvePurchaseTtc(null, 19)).toBeNull();
      expect(resolvePurchaseTtc(undefined, 19)).toBeNull();
    });

    it('returns HT when VAT is 0%', () => {
      expect(calculatePurchaseTtc(100, 0)).toBe(100);
    });

    it('matches purchase-order style VAT on integer HT', () => {
      expect(calculatePurchaseTtc(50400, 13)).toBe(56952);
    });
  });

  it('round-trips HT from TTC', () => {
    const ttc = calculateSaleTtc(50, 13, false);
    expect(deriveUnitPriceFromTtc(ttc, 13, false)).toBe(50);
  });

  it('recalculates from margin driver', () => {
    const result = recalculatePricing(
      {
        purchasePrice: 45000,
        profitMarginPercent: 12,
        unitPriceHt: 0,
        saleTtc: 0,
        vatRatePercent: 13,
        isFodecApplicable: false
      },
      'margin'
    );

    expect(result.unitPriceHt).toBe(50400);
    expect(result.saleTtc).toBe(56952);
  });

  it('recalculates margin from HT', () => {
    const result = recalculatePricing(
      {
        purchasePrice: 45000,
        profitMarginPercent: null,
        unitPriceHt: 50400,
        saleTtc: 56952,
        vatRatePercent: 13,
        isFodecApplicable: false
      },
      'unitPriceHt'
    );

    expect(calculateMarginPercent(45000, result.unitPriceHt)).toBe(12);
  });

  it('matches product-form capture case: 1400 HT purchase → 1500 HT sale ≈ 7.143% margin', () => {
    expect(calculateMarginPercent(1400, 1500)).toBe(7.143);

    const fromHt = recalculatePricing(
      {
        purchasePrice: 1400,
        profitMarginPercent: null,
        unitPriceHt: 1500,
        saleTtc: 0,
        vatRatePercent: 19,
        isFodecApplicable: false
      },
      'unitPriceHt'
    );
    expect(fromHt.profitMarginPercent).toBe(7.143);
    expect(fromHt.saleTtc).toBe(1785);

    // Reverse path: 3-decimal margin rounding can drift by a few millimes (1400 × 1.07143).
    const fromMargin = recalculatePricing(
      {
        purchasePrice: 1400,
        profitMarginPercent: 7.143,
        unitPriceHt: 0,
        saleTtc: 0,
        vatRatePercent: 19,
        isFodecApplicable: false
      },
      'margin'
    );
    expect(fromMargin.unitPriceHt).toBeCloseTo(1500, 2);
    expect(fromMargin.saleTtc).toBeCloseTo(1785, 2);
  });
});
