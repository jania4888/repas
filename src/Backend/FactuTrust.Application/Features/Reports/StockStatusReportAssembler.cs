using FactuTrust.Application.DTOs;

namespace FactuTrust.Application.Features.Reports;

public static class StockStatusReportAssembler
{
    public static StockStatusGroupingMode ParseGroupingMode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return StockStatusGroupingMode.WarehouseThenCategory;

        return value.Trim().ToLowerInvariant() switch
        {
            "category_then_warehouse" or "category" => StockStatusGroupingMode.CategoryThenWarehouse,
            _ => StockStatusGroupingMode.WarehouseThenCategory
        };
    }

    public static string GroupingModeDisplayLabel(StockStatusGroupingMode mode) =>
        mode == StockStatusGroupingMode.CategoryThenWarehouse
            ? "Par catégorie puis entrepôt"
            : "Par entrepôt puis catégorie";

    public static string? SanitizeSearch(string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
            return null;

        var trimmed = search.Trim();
        if (trimmed.Length > StockStatusReportConstants.MaxSearchLength)
            trimmed = trimmed[..StockStatusReportConstants.MaxSearchLength];

        return trimmed
            .Replace("[", "[[]")
            .Replace("%", "[%]")
            .Replace("_", "[_]");
    }
}
