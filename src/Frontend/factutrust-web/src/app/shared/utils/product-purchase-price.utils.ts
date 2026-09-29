/** Aligné sur Product.GetPurchasePrice() côté backend (PurchasePrice ?? UnitPrice). */
export function resolvePurchaseUnitPriceHt(
  product: { purchasePrice?: number | null; unitPrice: number }
): number {
  return product.purchasePrice ?? product.unitPrice ?? 0;
}
