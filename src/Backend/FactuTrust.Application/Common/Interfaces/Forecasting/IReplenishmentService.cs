using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Forecasting.Dtos;

namespace FactuTrust.Application.Common.Interfaces.Forecasting;

/// <summary>
/// V2 of the replenishment pipeline (gated by <c>Features:Forecasting:ReplenishmentV2:Enabled</c>).
/// Differences vs <see cref="IReplenishmentService"/>:
/// <list type="bullet">
///   <item>Generation honours <c>StockItem.MinimumStock</c>, <c>Product.PreferredSupplier/MOQ/Packaging/LeadTimeOverride</c>
///         and on-order quantity (fix F-C4, F-M3, F-M16, F-M17).</item>
///   <item><see cref="GenerateRecommendationsAsync"/> accepts an optional <c>productId</c> (fix F-C3).</item>
///   <item><see cref="DismissAsync"/> requires a non-empty reason (fix F-M7).</item>
///   <item><see cref="CreatePurchaseOrdersAsync"/> actually creates draft <c>PurchaseOrder</c> entities grouped
///         by supplier and links each recommendation via <c>LinkedPurchaseOrderId</c> (fix F-C1, F-C2).</item>
///   <item>Exposes manual override, undo, notes, history, KPI and CSV/XLSX export.</item>
/// </list>
/// Every state-changing operation writes one <c>ReplenishmentDecisionAudit</c> row (fix F-M18).
/// </summary>
public interface IReplenishmentService
{
    /// <summary>
    /// Regenerates recommendations. <paramref name="productId"/> narrows the scope to a single product
    /// (used by the product-demand modal — fix F-C3). <paramref name="warehouseId"/> narrows to a single warehouse.
    /// Stale Pending recommendations in scope are marked Superseded before insertion.
    /// </summary>
    Task<int> GenerateRecommendationsAsync(
        Guid? warehouseId,
        Guid? productId,
        CancellationToken ct = default);

    /// <summary>Paged + filtered list of recommendations with V2 enrichment fields.</summary>
    Task<PagedResult<ReplenishmentRecommendationDto>> GetRecommendationsAsync(
        ReplenishmentFiltersDto filters,
        CancellationToken ct = default);

    /// <summary>Approve a recommendation (idempotent — fix F-M1). Writes an audit row.</summary>
    Task<ReplenishmentRecommendationDto> ApproveAsync(Guid recommendationId, CancellationToken ct = default);

    /// <summary>Dismiss a recommendation. <paramref name="reason"/> is mandatory (fix F-M7). Writes an audit row.</summary>
    Task<ReplenishmentRecommendationDto> DismissAsync(
        Guid recommendationId,
        string reason,
        CancellationToken ct = default);

    /// <summary>Apply a user-controlled override (manual qty and/or supplier) before PO preparation.</summary>
    Task<ReplenishmentRecommendationDto> OverrideAsync(
        Guid recommendationId,
        decimal? manualQty,
        Guid? manualSupplierId,
        CancellationToken ct = default);

    /// <summary>Revert a non-terminal decision back to Pending (only within <c>UndoWindowHours</c>).</summary>
    Task<ReplenishmentRecommendationDto> UndoLastDecisionAsync(Guid recommendationId, CancellationToken ct = default);

    /// <summary>Attach or update free-form notes on a recommendation.</summary>
    Task<ReplenishmentRecommendationDto> AttachNotesAsync(Guid recommendationId, string? notes, CancellationToken ct = default);

    /// <summary>
    /// Real V1→V2 fix: actually create draft <see cref="FactuTrust.Domain.Entities.PurchaseOrder"/> entities grouped
    /// by effective supplier, then link each recommendation via <c>LinkedPurchaseOrderId</c> (status → Ordered).
    /// Returns one entry per draft created, plus warnings (recos skipped because no supplier could be resolved, etc.).
    /// </summary>
    Task<CreatePurchaseOrdersResultDto> CreatePurchaseOrdersAsync(
        IReadOnlyList<Guid> recommendationIds,
        IReadOnlyList<CreatePurchaseOrderLinePriceDto>? linePrices,
        CancellationToken ct = default);

    /// <summary>
    /// Builds line prices from product purchase price for recommendations that would become PO lines.
    /// Throws when a linkable line has no purchase price on the product (assistant / non-UI flows).
    /// </summary>
    Task<IReadOnlyList<CreatePurchaseOrderLinePriceDto>> SuggestPurchaseOrderLinePricesAsync(
        IReadOnlyList<Guid> recommendationIds,
        CancellationToken ct = default);

    /// <summary>Returns the immutable decision history (oldest → newest) for one recommendation.</summary>
    Task<IReadOnlyList<ReplenishmentDecisionAuditDto>> GetHistoryAsync(Guid recommendationId, CancellationToken ct = default);

    /// <summary>Computes KPI tiles for the V2 board (service rate, stock-out rate, value to order, top-N urgencies).</summary>
    Task<ReplenishmentKpiDto> GetKpiAsync(Guid? warehouseId, CancellationToken ct = default);

    /// <summary>
    /// Exports filtered recommendations to CSV or XLSX. Returns the raw bytes + suggested filename + MIME type.
    /// </summary>
    Task<(byte[] Bytes, string FileName, string ContentType)> ExportAsync(
        ReplenishmentFiltersDto filters,
        string format,
        CancellationToken ct = default);
}
