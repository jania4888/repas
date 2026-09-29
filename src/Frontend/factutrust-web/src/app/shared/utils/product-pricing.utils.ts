/** Default FODEC rate (%) — aligned with backend ProductPricingCalculator. */
export const DEFAULT_FODEC_RATE_PERCENT = 1;

export type PricingEditSource =
  | 'purchasePrice'
  | 'margin'
  | 'unitPriceHt'
  | 'saleTtc'
  | 'vatRate'
  | 'fodec';

export interface ProductPricingInput {
  purchasePrice: number | null;
  profitMarginPercent: number | null;
  unitPriceHt: number;
  saleTtc: number;
  vatRatePercent: number;
  isFodecApplicable: boolean;
  fodecRatePercent?: number;
}

export function roundTnd(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function calculateFodecAmount(
  unitPriceHt: number,
  isFodecApplicable: boolean,
  fodecRatePercent = DEFAULT_FODEC_RATE_PERCENT
): number {
  if (!isFodecApplicable || fodecRatePercent <= 0) {
    return 0;
  }
  return roundTnd(unitPriceHt * fodecRatePercent / 100);
}

export function calculateVatAmount(
  unitPriceHt: number,
  fodecAmount: number,
  vatRatePercent: number
): number {
  const vatBase = unitPriceHt + fodecAmount;
  return roundTnd(vatBase * vatRatePercent / 100);
}

export function calculateSaleTtc(
  unitPriceHt: number,
  vatRatePercent: number,
  isFodecApplicable: boolean,
  fodecRatePercent = DEFAULT_FODEC_RATE_PERCENT
): number {
  const fodecAmount = calculateFodecAmount(unitPriceHt, isFodecApplicable, fodecRatePercent);
  const vatAmount = calculateVatAmount(unitPriceHt, fodecAmount, vatRatePercent);
  return roundTnd(unitPriceHt + fodecAmount + vatAmount);
}

export function deriveUnitPriceFromTtc(
  saleTtc: number,
  vatRatePercent: number,
  isFodecApplicable: boolean,
  fodecRatePercent = DEFAULT_FODEC_RATE_PERCENT
): number {
  const fodecFactor = isFodecApplicable && fodecRatePercent > 0
    ? 1 + fodecRatePercent / 100
    : 1;
  const vatFactor = 1 + vatRatePercent / 100;
  return roundTnd(saleTtc / (fodecFactor * vatFactor));
}

export function calculateMarginPercent(
  purchasePrice: number | null | undefined,
  unitPriceHt: number
): number | null {
  if (purchasePrice == null || purchasePrice <= 0) {
    return null;
  }
  return roundTnd(((unitPriceHt - purchasePrice) / purchasePrice) * 100);
}

export function calculateUnitPriceFromMargin(
  purchasePrice: number,
  marginPercent: number
): number {
  return roundTnd(purchasePrice * (1 + marginPercent / 100));
}

export function recalculatePricing(
  current: ProductPricingInput,
  source: PricingEditSource
): ProductPricingInput {
  const fodecRatePercent = current.fodecRatePercent ?? DEFAULT_FODEC_RATE_PERCENT;
  let purchasePrice = current.purchasePrice;
  let profitMarginPercent = current.profitMarginPercent;
  let unitPriceHt = current.unitPriceHt;
  let saleTtc = current.saleTtc;

  switch (source) {
    case 'purchasePrice':
    case 'margin':
      if (purchasePrice != null && purchasePrice > 0 && profitMarginPercent != null) {
        unitPriceHt = calculateUnitPriceFromMargin(purchasePrice, profitMarginPercent);
      }
      saleTtc = calculateSaleTtc(unitPriceHt, current.vatRatePercent, current.isFodecApplicable, fodecRatePercent);
      break;

    case 'unitPriceHt':
      profitMarginPercent = calculateMarginPercent(purchasePrice, unitPriceHt);
      saleTtc = calculateSaleTtc(unitPriceHt, current.vatRatePercent, current.isFodecApplicable, fodecRatePercent);
      break;

    case 'saleTtc':
      unitPriceHt = deriveUnitPriceFromTtc(
        saleTtc,
        current.vatRatePercent,
        current.isFodecApplicable,
        fodecRatePercent
      );
      profitMarginPercent = calculateMarginPercent(purchasePrice, unitPriceHt);
      break;

    case 'vatRate':
    case 'fodec':
      saleTtc = calculateSaleTtc(unitPriceHt, current.vatRatePercent, current.isFodecApplicable, fodecRatePercent);
      break;
  }

  return {
    purchasePrice,
    profitMarginPercent,
    unitPriceHt,
    saleTtc,
    vatRatePercent: current.vatRatePercent,
    isFodecApplicable: current.isFodecApplicable,
    fodecRatePercent
  };
}

/** TTC achat catalogue : HT + TVA uniquement (pas de FODEC). */
export function calculatePurchaseTtc(
  purchasePriceHt: number,
  vatRatePercent: number
): number {
  return calculateSaleTtc(purchasePriceHt, vatRatePercent, false);
}

export function resolvePurchaseTtc(
  purchasePriceHt: number | null | undefined,
  vatRatePercent: number
): number | null {
  if (purchasePriceHt == null) {
    return null;
  }
  return calculatePurchaseTtc(purchasePriceHt, vatRatePercent);
}

export function getEffectiveMaxDiscountPercent(
  isDiscountEnabled: boolean | undefined,
  productMaxDiscountPercent: number | null | undefined,
  globalMax = 100
): number {
  if (isDiscountEnabled && productMaxDiscountPercent != null) {
    return Math.min(productMaxDiscountPercent, globalMax);
  }
  return globalMax;
}
