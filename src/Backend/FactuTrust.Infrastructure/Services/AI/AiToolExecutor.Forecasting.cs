using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Forecasting.Dtos;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// AI tool handlers for the Forecasting module.
/// Kept in a partial file to isolate the new module — no existing handler is touched.
/// All numeric outputs come from the deterministic forecasting services; the LLM never invents values.
/// </summary>
public sealed partial class AiToolExecutor
{
    private AiToolResult? GuardForecastingEnabled()
    {
        if (!_forecastingOptions.Enabled || _forecasting is null || _replenishment is null
            || _promotions is null || _abcXyz is null || _calendar is null)
        {
            return AiToolResult.Error("Le module Prévisions IA n'est pas activé pour cet espace.");
        }
        return null;
    }

    // ────────────────────── forecast_revenue ──────────────────────────────

    private async Task<AiToolResult> HandleForecastRevenue(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;

        var scopeStr = GetStringArg(args, "scope_type");
        if (!Enum.TryParse<ForecastScopeType>(scopeStr, true, out var scope))
            return AiToolResult.Error("scope_type invalide (Global / Category / Product / Warehouse / Client).");

        var scopeId = ParseGuidOrNull(args, "scope_id");
        if (scope != ForecastScopeType.Global && scopeId is null)
            return AiToolResult.Error("scope_id est obligatoire quand scope_type ≠ Global.");

        if (!Enum.TryParse<ForecastHorizon>(GetStringArg(args, "horizon"), true, out var horizon))
            return AiToolResult.Error("horizon invalide (Week / Month / Quarter / Custom).");

        DateTime? from = null, to = null;
        if (horizon == ForecastHorizon.Custom)
        {
            from = ParseOptionalDate(args, "from_date");
            to = ParseOptionalDate(args, "to_date");
            if (from is null || to is null)
                return AiToolResult.Error("from_date et to_date sont requis pour horizon = Custom.");
        }

        var dto = await _forecasting!.ForecastRevenueAsync(scope, scopeId, horizon, from, to, ct);
        return AiToolResult.Ok(Serialize(dto));
    }

    // ────────────────────── forecast_product_demand ───────────────────────

    private async Task<AiToolResult> HandleForecastProductDemand(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var productId = ParseGuidOrNull(args, "product_id")
            ?? throw new ArgumentException("product_id est obligatoire.");
        if (!Enum.TryParse<ForecastHorizon>(GetStringArg(args, "horizon"), true, out var horizon))
            return AiToolResult.Error("horizon invalide.");
        var dto = await _forecasting!.ForecastProductDemandAsync(productId, horizon, ct);
        return AiToolResult.Ok(Serialize(dto));
    }

    // ────────────────────── get_replenishment_recommendations ─────────────

    private async Task<AiToolResult> HandleGetReplenishment(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var warehouseId = ParseGuidOrNull(args, "warehouse_id");
        ReplenishmentStatus? status = null;
        if (args.TryGetValue("status", out var rawStatus) && rawStatus is not null
            && Enum.TryParse<ReplenishmentStatus>(rawStatus.ToString(), true, out var st))
            status = st;
        var topN = ParseIntOrDefault(args, "top_n", 20);
        if (topN < 1 || topN > 200) topN = 20;
        // V2 service uses a filters DTO — keep the LLM-facing schema unchanged (warehouse, status, top_n).
        var filters = new ReplenishmentFiltersDto(
            WarehouseId: warehouseId,
            SupplierId: null,
            Status: status ?? ReplenishmentStatus.Pending,
            Search: null,
            UrgencyLevel: null,
            FromGeneratedAt: null,
            ToGeneratedAt: null,
            OrderBy: null,
            OrderDesc: true,
            Page: 1,
            PageSize: topN);
        var paged = await _replenishment!.GetRecommendationsAsync(filters, ct);
        return AiToolResult.Ok(Serialize(new
        {
            totalCount = paged.TotalCount,
            items = paged.Items
        }));
    }

    // ────────────────────── get_promotion_recommendations ─────────────────

    private async Task<AiToolResult> HandleGetPromotions(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var productId = ParseGuidOrNull(args, "product_id");
        var categoryId = ParseGuidOrNull(args, "category_id");
        var fromDate = ParseOptionalDate(args, "from_date");
        var toDate = ParseOptionalDate(args, "to_date");
        var paged = await _promotions!.GetActiveAsync(productId, categoryId, fromDate, toDate, 1, 50, ct);
        return AiToolResult.Ok(Serialize(new { totalCount = paged.TotalCount, items = paged.Items }));
    }

    // ────────────────────── get_abc_xyz_classification ────────────────────

    private async Task<AiToolResult> HandleGetAbcXyz(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var warehouseId = ParseGuidOrNull(args, "warehouse_id");
        AbcClass? abc = null;
        XyzClass? xyz = null;
        if (args.TryGetValue("abc_class", out var rawA) && rawA is not null
            && Enum.TryParse<AbcClass>(rawA.ToString(), true, out var av)) abc = av;
        if (args.TryGetValue("xyz_class", out var rawX) && rawX is not null
            && Enum.TryParse<XyzClass>(rawX.ToString(), true, out var xv)) xyz = xv;

        var matrix = await _abcXyz!.GetMatrixAsync(warehouseId, abc, xyz, ct);
        return AiToolResult.Ok(Serialize(new
        {
            computedAt = matrix.ComputedAt,
            totalProducts = matrix.TotalProducts,
            totalReferenceRevenue = matrix.TotalReferenceRevenue,
            cells = matrix.Cells,
            // Cap to avoid blowing up token budgets in conversations.
            products = matrix.Products.Take(50)
        }));
    }

    // ────────────────────── get_tunisian_commercial_calendar ──────────────

    private AiToolResult HandleGetTunisianCalendar(Dictionary<string, object?> args)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var from = ParseDate(args, "from_date");
        var to = ParseDate(args, "to_date");
        var events = _calendar!.GetEvents(from, to)
            .Select(e => new CalendarEventDto(e.Code, e.DisplayName, e.StartDate, e.EndDate, e.IsHoliday, e.IsCommercialWindow, e.Category))
            .ToList();
        return AiToolResult.Ok(Serialize(new { count = events.Count, events }));
    }

    // ────────────────────── analyze_seasonal_impact ───────────────────────

    private async Task<AiToolResult> HandleAnalyzeSeasonalImpact(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var productId = ParseGuidOrNull(args, "product_id");
        var categoryId = ParseGuidOrNull(args, "category_id");
        if (productId is null && categoryId is null)
            return AiToolResult.Error("product_id ou category_id est obligatoire.");
        var from = ParseDate(args, "from_date");
        var to = ParseDate(args, "to_date");
        var dto = await _forecasting!.AnalyzeSeasonalImpactAsync(productId, categoryId, from, to, ct);
        return AiToolResult.Ok(Serialize(dto));
    }

    // ────────────────────── simulate_promotion_impact ─────────────────────

    private async Task<AiToolResult> HandleSimulatePromotionImpact(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var productId = ParseGuidOrNull(args, "product_id")
            ?? throw new ArgumentException("product_id est obligatoire.");
        var discount = ParseDecimalOrDefault(args, "discount_percent", 0m);
        var duration = ParseIntOrDefault(args, "duration_days", 7);
        var dto = await _forecasting!.SimulatePromotionImpactAsync(productId, discount, duration, ct);
        return AiToolResult.Ok(Serialize(dto));
    }

    // ────────────────────── prepare_purchase_order_from_replenishment ─────

    private async Task<AiToolResult> HandlePreparePurchaseOrderFromReplenishment(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var csv = GetStringArg(args, "recommendation_ids_csv");
        if (string.IsNullOrWhiteSpace(csv))
            return AiToolResult.Error("recommendation_ids_csv est obligatoire (GUID séparés par virgule).");
        var ids = csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty)
            .Where(g => g != Guid.Empty)
            .Distinct()
            .ToList();
        if (ids.Count == 0) return AiToolResult.Error("Aucun GUID valide trouvé dans recommendation_ids_csv.");
        IReadOnlyList<CreatePurchaseOrderLinePriceDto> linePrices;
        try
        {
            linePrices = await _replenishment!.SuggestPurchaseOrderLinePricesAsync(ids, ct);
        }
        catch (ArgumentException ex)
        {
            return AiToolResult.Error(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return AiToolResult.Error(ex.Message);
        }

        // V2 service actually creates draft POs (vs. V1 which only flipped statuses to Approved).
        var dto = await _replenishment.CreatePurchaseOrdersAsync(ids, linePrices, ct);
        var notes = dto.CreatedPurchaseOrdersCount == 0
            ? "Aucun bon de commande créé. Voir warnings."
            : $"{dto.CreatedPurchaseOrdersCount} bon(s) de commande créé(s), {dto.LinkedRecommendationsCount} recommandation(s) liée(s).";
        return AiToolResult.Ok(Serialize(new
        {
            createdPurchaseOrdersCount = dto.CreatedPurchaseOrdersCount,
            linkedRecommendationsCount = dto.LinkedRecommendationsCount,
            totalEstimatedQty = dto.TotalEstimatedQty,
            notes,
            warnings = dto.Warnings,
            createdPurchaseOrders = dto.CreatedPurchaseOrders
        }));
    }

    // ────────────────────── prepare_promotion_application ─────────────────

    private async Task<AiToolResult> HandlePreparePromotionApplication(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (GuardForecastingEnabled() is { } guard) return guard;
        var id = ParseGuidOrNull(args, "promotion_recommendation_id")
            ?? throw new ArgumentException("promotion_recommendation_id est obligatoire.");
        var dto = await _promotions!.PrepareDiscountDraftAsync(id, ct);
        return AiToolResult.Ok(Serialize(dto));
    }

    // ────────────────────── helpers (private to this partial) ─────────────

    private static decimal ParseDecimalOrDefault(Dictionary<string, object?> args, string key, decimal defaultValue)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null) return defaultValue;
        var s = raw.ToString();
        if (string.IsNullOrWhiteSpace(s)) return defaultValue;
        return decimal.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? v : defaultValue;
    }

    private static int ParseIntOrDefault(Dictionary<string, object?> args, string key, int defaultValue)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null) return defaultValue;
        var s = raw.ToString();
        return int.TryParse(s, out var v) ? v : defaultValue;
    }

    private static DateTime? ParseOptionalDate(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null) return null;
        var s = raw.ToString();
        if (string.IsNullOrWhiteSpace(s)) return null;
        return DateTime.TryParseExact(s, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out var dt) ? dt : null;
    }
}
