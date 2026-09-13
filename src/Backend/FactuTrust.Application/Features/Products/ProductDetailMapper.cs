using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;

namespace FactuTrust.Application.Features.Products;

/// <summary>
/// Maps domain <see cref="Product"/> to API DTOs with computed pricing fields.
/// </summary>
internal static class ProductDetailMapper
{
    public static ProductDetailDto ToDetailDto(
        Product product,
        decimal? weightedAverageCost = null,
        decimal? minimumStock = null)
    {
        return new ProductDetailDto
        {
            Id = product.Id,
            Code = product.Code,
            Name = product.Name,
            Description = product.Description,
            Type = product.Type,
            TypeDisplay = product.Type.ToDisplayString(),
            UnitPrice = product.UnitPrice.Amount,
            PurchasePrice = product.PurchasePrice?.Amount,
            LastPurchasePrice = product.LastPurchasePrice?.Amount,
            WeightedAverageCost = weightedAverageCost,
            ProfitMarginPercent = product.ProfitMarginPercent,
            SalePriceTtc = product.CalculateSalePriceTtc(),
            Currency = product.UnitPrice.Currency,
            VatRate = product.VatRate,
            VatRatePercent = (int)product.VatRate,
            VatRateDisplay = product.VatRate.ToDisplayString(),
            Unit = product.Unit,
            Barcode = product.Barcode?.Value,
            IsActive = product.IsActive,
            IsStockManaged = product.IsStockManaged,
            IsFodecApplicable = product.IsFodecApplicable,
            IsDiscountEnabled = product.IsDiscountEnabled,
            MaxDiscountPercent = product.MaxDiscountPercent,
            CategoryId = product.CategoryId,
            CategoryName = product.Category.Name,
            ImageUrl = product.ImageUrl,
            PreferredSupplierId = product.PreferredSupplierId,
            MinimumStock = minimumStock is > 0 ? minimumStock : null,
            CreatedAt = product.CreatedAt,
            UpdatedAt = product.UpdatedAt,
            ParentProductId = product.ParentProductId,
            IsVariantTemplate = product.IsVariantTemplate,
            TrackingMode = product.TrackingMode,
            HasExpiryTracking = product.HasExpiryTracking,
            PickingPolicy = product.PickingPolicy,
            CostingMethod = product.CostingMethod,
            ExpiryAlertDays = product.ExpiryAlertDays
        };
    }

    public static ProductListDto ToListDto(
        Product product,
        decimal? quantityAvailable = null,
        decimal? weightedAverageCost = null)
    {
        return new ProductListDto
        {
            Id = product.Id,
            Code = product.Code,
            Name = product.Name,
            Type = product.Type.ToString(),
            UnitPrice = product.UnitPrice.Amount,
            PurchasePrice = product.PurchasePrice?.Amount,
            LastPurchasePrice = product.LastPurchasePrice?.Amount,
            WeightedAverageCost = weightedAverageCost,
            ProfitMarginPercent = product.ProfitMarginPercent,
            SalePriceTtc = ProductPricingCalculator.CalculateSaleTtc(
                product.UnitPrice.Amount,
                product.VatRate,
                product.IsFodecApplicable),
            Currency = product.UnitPrice.Currency,
            VatRatePercent = (int)product.VatRate,
            VatRateDisplay = product.VatRate.ToShortString(),
            Unit = product.Unit,
            Barcode = product.Barcode?.Value,
            IsActive = product.IsActive,
            IsStockManaged = product.IsStockManaged,
            IsFodecApplicable = product.IsFodecApplicable,
            IsDiscountEnabled = product.IsDiscountEnabled,
            MaxDiscountPercent = product.MaxDiscountPercent,
            CategoryId = product.CategoryId,
            CategoryName = product.Category.Name,
            ImageUrl = product.ImageUrl,
            QuantityAvailable = quantityAvailable,
            IsVariantTemplate = product.IsVariantTemplate,
            ParentProductId = product.ParentProductId,
            TrackingMode = product.TrackingMode,
            CostingMethod = product.CostingMethod
        };
    }

    public static ProductSelectDto ToSelectDto(Product product, string? attributeSummary = null)
    {
        return new ProductSelectDto
        {
            Id = product.Id,
            Code = product.Code,
            Name = product.Name,
            UnitPrice = product.UnitPrice.Amount,
            PurchasePrice = product.PurchasePrice?.Amount,
            VatRatePercent = (int)product.VatRate,
            Unit = product.Unit,
            IsFodecApplicable = product.IsFodecApplicable,
            IsDiscountEnabled = product.IsDiscountEnabled,
            MaxDiscountPercent = product.MaxDiscountPercent,
            AttributeSummary = attributeSummary,
            IsVariantTemplate = product.IsVariantTemplate,
            ParentProductId = product.ParentProductId
        };
    }

    public static string FormatAttributeSummary(IReadOnlyList<ProductVariantAttributePairDto> attributes)
        => string.Join(" / ", attributes.OrderBy(a => a.SortOrder).Select(a => a.ValueName));
}
