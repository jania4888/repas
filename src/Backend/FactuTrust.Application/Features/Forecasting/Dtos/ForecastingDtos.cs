using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Forecasting.Dtos;

// ────────────────────── Sales / revenue forecasts ──────────────────────────

public sealed record ForecastBreakdownPointDto(
    DateTime PeriodStart,
    DateTime PeriodEnd,
    decimal Expected,
    decimal Low,
    decimal High);

public sealed record SalesForecastDto(
    Guid Id,
    ForecastScopeType ScopeType,
    Guid? ScopeId,
    string? ScopeLabel,
    ForecastHorizon Horizon,
    DateTime GeneratedAt,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    decimal Expected,
    decimal Low,
    decimal High,
    string Currency,
    decimal ConfidencePercent,
    ForecastMethod MethodUsed,
    string? Notes,
    IReadOnlyList<ForecastBreakdownPointDto> Breakdown);

public sealed record ProductDemandForecastDto(
    Guid ProductId,
    string ProductCode,
    string ProductName,
    ForecastHorizon Horizon,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    decimal ExpectedQty,
    decimal LowQty,
    decimal HighQty,
    decimal CurrentStockOnHand,
    decimal SuggestedReplenishmentQty,
    decimal? DaysOfStockRemaining,
    decimal ConfidencePercent,
    ForecastMethod MethodUsed);

// ────────────────────── Replenishment ─────────────────────────────────
// V1 DTOs (ReplenishmentRecommendationDto without enrichment, ReplenishmentDecisionDto,
// PreparePurchaseOrderDraft{Request,Result}Dto, DismissReplenishmentRequestDto) have been
// removed in the 2026-05-13 cutover — V2 DTOs below are the only contract.

// ────────────────────── Replenishment enrichments ────────────────────────

/// <summary>
/// V2 extension of <see cref="ReplenishmentRecommendationDto"/> — adds supplier hints, on-order qty,
/// manual overrides, days-of-stock estimate and free-form user notes.
/// All extra fields are nullable / defaulted so the V1 frontend can read this DTO without changes.
/// </summary>
public sealed record ReplenishmentRecommendationDto(
    Guid Id,
    Guid ProductId,
    string ProductCode,
    string ProductName,
    Guid WarehouseId,
    string WarehouseName,
    DateTime GeneratedAt,
    decimal CurrentStockOnHand,
    decimal RecommendedQty,
    decimal Rop,
    decimal SafetyStock,
    int LeadTimeDays,
    decimal DailyDemand,
    IReadOnlyList<string> ReasonCodes,
    ReplenishmentStatus Status,
    Guid? LinkedPurchaseOrderId,
    DateTime? ProcessedAt,
    string? ProductUnit,
    // V2 additions ↓
    Guid? PreferredSupplierId,
    string? PreferredSupplierName,
    decimal QuantityOnOrder,
    decimal EffectiveQty,
    decimal? ManualQtyOverride,
    Guid? ManualSupplierOverride,
    decimal? DaysOfStockRemaining,
    string? UserNotes,
    string UrgencyLevel,
    /// <summary>Prix d'achat HT produit pour préremplissage modale BC (null si non renseigné sur la fiche).</summary>
    decimal? SuggestedPurchaseUnitPrice);

/// <summary>
/// Filters accepted by the V2 list endpoint. All fields are optional. When omitted, the corresponding
/// constraint is not applied. Strings are trimmed; <c>Search</c> matches productCode/productName/supplierName.
/// </summary>
public sealed record ReplenishmentFiltersDto(
    Guid? WarehouseId = null,
    Guid? SupplierId = null,
    ReplenishmentStatus? Status = null,
    string? Search = null,
    string? UrgencyLevel = null,
    DateTime? FromGeneratedAt = null,
    DateTime? ToGeneratedAt = null,
    string? OrderBy = null,
    bool OrderDesc = true,
    int Page = 1,
    int PageSize = 50);

public sealed record DismissReplenishmentRequestDto(string Reason);

public sealed record OverrideReplenishmentRequestDto(decimal? ManualQty, Guid? ManualSupplierId);

public sealed record AttachNotesRequestDto(string? Notes);

public sealed record CreatePurchaseOrderLinePriceDto(Guid RecommendationId, decimal UnitPrice);

public sealed record CreatePurchaseOrdersRequestDto(
    IReadOnlyList<Guid> RecommendationIds,
    IReadOnlyList<CreatePurchaseOrderLinePriceDto>? LinePrices);

public sealed record CreatePurchaseOrdersResultDto(
    int CreatedPurchaseOrdersCount,
    int LinkedRecommendationsCount,
    decimal TotalEstimatedQty,
    IReadOnlyList<CreatedPurchaseOrderDto> CreatedPurchaseOrders,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<Guid> UnlinkedRecommendationIds);

public sealed record CreatedPurchaseOrderDto(
    Guid PurchaseOrderId,
    string PurchaseOrderNumber,
    Guid SupplierId,
    string SupplierName,
    int LinesCount,
    decimal TotalAmount,
    IReadOnlyList<Guid> RecommendationIds);

public sealed record ReplenishmentKpiDto(
    int PendingCount,
    int UrgentCount,
    int OutOfStockCount,
    decimal EstimatedValueToOrder,
    string Currency,
    decimal ServiceLevelPercent,
    decimal StockOutRatePercent,
    DateTime ComputedAt,
    IReadOnlyList<KpiTopUrgencyDto> TopUrgencies);

public sealed record KpiTopUrgencyDto(
    Guid RecommendationId,
    string ProductCode,
    string ProductName,
    decimal CurrentStockOnHand,
    decimal? DaysOfStockRemaining,
    decimal RecommendedQty);

public sealed record ReplenishmentDecisionAuditDto(
    Guid Id,
    Guid RecommendationId,
    ReplenishmentStatus FromStatus,
    ReplenishmentStatus ToStatus,
    string ActionType,
    string? Reason,
    string ActorUserId,
    DateTime ActedAt,
    string? PayloadJson);

// ────────────────────── Promotion recommendations ─────────────────────────

public sealed record PromotionRecommendationDto(
    Guid Id,
    Guid? ProductId,
    string? ProductCode,
    string? ProductName,
    Guid? CategoryId,
    string? CategoryName,
    DateTime GeneratedAt,
    PromotionRecommendationType Type,
    decimal SuggestedDiscountPercent,
    decimal ExpectedUpliftPercent,
    DateTime ValidFrom,
    DateTime ValidUntil,
    string ReasoningSummary,
    IReadOnlyList<string> ReasonCodes,
    PromotionRecommendationStatus Status,
    string? RelatedEventCode);

public sealed record PromotionSimulationRequestDto(
    Guid ProductId,
    decimal DiscountPercent,
    int DurationDays);

public sealed record PromotionSimulationResultDto(
    Guid ProductId,
    string ProductCode,
    string ProductName,
    decimal DiscountPercent,
    int DurationDays,
    decimal BaselineRevenue,
    decimal ProjectedRevenueWithoutPromo,
    decimal ProjectedRevenueWithPromo,
    decimal ExpectedUpliftPercent,
    decimal MarginImpactPercent,
    decimal ApproxElasticity,
    string Notes);

public sealed record PreparePromotionDraftResultDto(
    Guid PromotionRecommendationId,
    Guid? ProductId,
    Guid? CategoryId,
    decimal SuggestedDiscountPercent,
    DateTime ValidFrom,
    DateTime ValidUntil,
    string Notes);

// ────────────────────── ABC / XYZ ─────────────────────────────────────────

public sealed record AbcXyzCellDto(
    string MatrixCode,
    AbcClass AbcClass,
    XyzClass XyzClass,
    int ProductCount,
    decimal RevenueShare);

public sealed record ProductClassificationDto(
    Guid ProductId,
    string ProductCode,
    string ProductName,
    AbcClass AbcClass,
    XyzClass XyzClass,
    string MatrixCode,
    decimal CumulativeRevenuePercent,
    decimal DemandCv,
    decimal ReferenceRevenue,
    int ActiveMonths,
    DateTime ComputedAt);

public sealed record AbcXyzMatrixDto(
    DateTime ComputedAt,
    int TotalProducts,
    decimal TotalReferenceRevenue,
    IReadOnlyList<AbcXyzCellDto> Cells,
    IReadOnlyList<ProductClassificationDto> Products);

// ────────────────────── Calendar ──────────────────────────────────────────

public sealed record CalendarEventDto(
    string Code,
    string DisplayName,
    DateTime StartDate,
    DateTime EndDate,
    bool IsHoliday,
    bool IsCommercialWindow,
    string Category);

// ────────────────────── Seasonal impact analysis ──────────────────────────

public sealed record SeasonalImpactDto(
    Guid? ProductId,
    string? ProductName,
    Guid? CategoryId,
    string? CategoryName,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    IReadOnlyList<CalendarEventDto> ApplicableEvents,
    double WeightedSeasonalFactor,
    decimal BaselineExpected,
    decimal AdjustedExpected,
    string Currency,
    string Notes);

// ────────────────────── Recompute ─────────────────────────────────────────

public sealed record RecomputeAuditDto(
    Guid Id,
    DateTime StartedAt,
    DateTime? CompletedAt,
    long DurationMs,
    string TriggerType,
    string? TriggeredBy,
    int ForecastsGenerated,
    int ReplenishmentsGenerated,
    int PromotionsGenerated,
    int ClassificationsUpdated,
    bool Success,
    string? ErrorMessage);

public sealed record RecomputeResultDto(
    DateTime StartedAt,
    DateTime CompletedAt,
    long DurationMs,
    int ForecastsGenerated,
    int ReplenishmentsGenerated,
    int PromotionsGenerated,
    int ClassificationsUpdated,
    bool Success,
    string? ErrorMessage);
