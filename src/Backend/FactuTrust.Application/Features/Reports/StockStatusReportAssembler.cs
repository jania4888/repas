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
        StockStatusLabels.GroupingMode(mode);

    public static string? BuildFiltersSummary(
        string? warehouseName,
        string? categoryName,
        string? search,
        bool includeZeroStock)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(warehouseName))
            parts.Add($"{StockStatusLabels.Warehouse()} : {warehouseName}");
        if (!string.IsNullOrWhiteSpace(categoryName))
            parts.Add($"{StockStatusLabels.Category()} : {categoryName}");
        if (!string.IsNullOrWhiteSpace(search))
            parts.Add($"{StockStatusLabels.Search()} : {search}");
        if (includeZeroStock)
            parts.Add(StockStatusLabels.IncludesZeroStock());
        return parts.Count == 0 ? null : string.Join(" — ", parts);
    }

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
