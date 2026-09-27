import { ProductListItem } from '@core/services/product.service';

export interface SellCheckResult {
  ok: boolean;
  message: string;
}

export function buildInsufficientStockMessage(
  productName: string,
  requested: number,
  available: number
): string {
  return $localize`:@@pos.pos-stock-guard.ts.stock.insuffisant.pour.productname.dans.d920260c:Stock insuffisant pour ${productName}:productName: dans cet entrepôt (demandé ${requested}:requested:, disponible ${available}:available:).`;
}

/** Clé de cache : entrepôt + lignes (produit:qté). Un TTL seul réutilisait un « tout dispo » d'un autre panier. */
export function buildOrderStockCacheKey(
  warehouseId: string | null | undefined,
  lines: ReadonlyArray<{ productId: string; quantity: number }>
): string {
  const fingerprint = lines
    .map(l => `${l.productId}:${l.quantity}`)
    .sort()
    .join(',');
  return `${warehouseId ?? ''}|${fingerprint}`;
}

/**
 * Autorise la vente si le produit n'est pas géré en stock, ou si la quantité catalogue
 * n'est pas connue (ex. scan code-barres). Sinon refuse dès que demandé > disponible.
 */
export function canSellProduct(
  product: Pick<ProductListItem, 'name' | 'isStockManaged' | 'quantityAvailable'>,
  extraQty: number,
  currentLineQty: number
): SellCheckResult {
  if (!product.isStockManaged || product.quantityAvailable == null) {
    return { ok: true, message: '' };
  }
  const requested = currentLineQty + extraQty;
  const available = product.quantityAvailable;
  if (requested <= available) {
    return { ok: true, message: '' };
  }
  return {
    ok: false,
    message: buildInsufficientStockMessage(product.name, requested, available)
  };
}
