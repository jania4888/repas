import { resolvePurchaseUnitPriceHt } from './product-purchase-price.utils';

describe('resolvePurchaseUnitPriceHt', () => {
  it('returns purchase price when set', () => {
    expect(resolvePurchaseUnitPriceHt({ purchasePrice: 50, unitPrice: 75 })).toBe(50);
  });

  it('falls back to unit price when purchase price is null', () => {
    expect(resolvePurchaseUnitPriceHt({ purchasePrice: null, unitPrice: 95 })).toBe(95);
  });

  it('falls back to unit price when purchase price is undefined', () => {
    expect(resolvePurchaseUnitPriceHt({ unitPrice: 42 })).toBe(42);
  });

  it('returns 0 when both are zero', () => {
    expect(resolvePurchaseUnitPriceHt({ purchasePrice: 0, unitPrice: 0 })).toBe(0);
  });
});
