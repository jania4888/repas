using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Features.Forecasting.Services;

/// <summary>
/// Suggests a purchase unit price for replenishment → PO flows. Does not fall back to sale price
/// (<see cref="Product.UnitPrice"/>). Supplier-specific pricing (L3 catalogue) is reserved for a future step.
/// </summary>
public static class ReplenishmentPurchaseUnitPriceResolver
{
    /// <param name="supplierId">Reserved for per-supplier purchase prices; ignored until L3.</param>
    public static decimal? SuggestUnitPrice(Product product, Guid? supplierId = null)
    {
        _ = supplierId;
        return product.PurchasePrice?.Amount;
    }
}
