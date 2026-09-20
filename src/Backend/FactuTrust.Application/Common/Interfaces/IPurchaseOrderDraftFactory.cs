using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Builds draft <see cref="PurchaseOrder"/> entities from a set of <see cref="ReplenishmentRecommendation"/>.
/// The factory **does not persist** — it returns hydrated, validated <c>PurchaseOrder</c> aggregates and
/// the matching pairing with each recommendation. Persistence + linking are performed by the caller in
/// a single <c>SaveChangesAsync</c> so the whole batch is atomic.
/// </summary>
/// <remarks>
/// This split (Phase 2 review C1) lets <see cref="ReplenishmentService"/> attach the POs to its own
/// <c>DbContext</c> and commit POs + recommendation status changes + audit rows together. The previous
/// design used two separate <c>SaveChangesAsync</c> calls on two different connections, which could
/// leave orphan POs when the second one failed.
/// </remarks>
public interface IPurchaseOrderDraftFactory
{
    /// <summary>
    /// Builds (but does not save) one draft <see cref="PurchaseOrder"/> per distinct
    /// (effective supplier, warehouse) pair resolved from <paramref name="recommendations"/>.
    /// The warehouse is part of the grouping so each PO carries a non-null <c>WarehouseId</c> —
    /// the replenishment engine only counts on-order quantities for warehouse-bound POs.
    /// The caller is responsible for:
    /// 1. Attaching each <c>PurchaseOrder</c> to its <c>DbContext</c>.
    /// 2. Calling <see cref="ReplenishmentRecommendation.LinkToPurchaseOrder"/> on each recommendation
    ///    listed in <see cref="BuiltDraftPurchaseOrder.RecommendationIds"/>.
    /// 3. Executing a single <c>SaveChangesAsync</c>.
    /// </summary>
    /// <param name="recommendations">
    /// Eligible recommendations (typically <c>Approved</c> status). Each must already have its
    /// V2 enrichment fields populated so <see cref="ReplenishmentRecommendation.GetEffectiveSupplierId"/>
    /// returns a valid value (otherwise the recommendation is reported in <see cref="PurchaseOrderDraftBatchResult.Warnings"/>).
    /// </param>
    /// <param name="products">Products required for line creation (avoid an extra round trip in the factory).</param>
    /// <param name="suppliers">Active suppliers indexed by id; inactive or missing suppliers produce warnings.</param>
    /// <param name="actorUserId">Used for <c>SetAuditInfo</c> on the freshly-built POs.</param>
    /// <param name="tenantId">
    /// Tenant owning the numbering sequence. Each kept draft reserves its <c>PurchaseOrderNumber</c>
    /// through the unified, transaction-safe <c>IDocumentNumberService</c> (serializable scheme-row
    /// update) — never by reading the latest number and incrementing in memory, which produced
    /// duplicate BC numbers under concurrency (Phase 2 review M3). A number is reserved only for a
    /// group that has at least one usable line, so skipped groups do not burn sequence values.
    /// </param>
    Task<PurchaseOrderDraftBatchResult> BuildDraftPurchaseOrdersAsync(
        IReadOnlyList<ReplenishmentRecommendation> recommendations,
        IReadOnlyDictionary<Guid, Product> products,
        IReadOnlyDictionary<Guid, Supplier> suppliers,
        IReadOnlyDictionary<Guid, Money> unitPriceByRecommendationId,
        string actorUserId,
        Guid tenantId,
        CancellationToken ct = default);
}

/// <summary>Aggregated result of a batch PO build call.</summary>
/// <param name="Drafts">Draft POs built (not yet persisted), one per resolved active (supplier, warehouse) pair.</param>
/// <param name="Warnings">Human-readable explanations for each recommendation that was not linked.</param>
/// <param name="UnlinkedRecommendationIds">
/// Ids of recommendations that could not be attached to any draft PO (no supplier resolved,
/// supplier missing/inactive, product missing, non-positive qty, or line/PO build failure).
/// The skip logic itself is unchanged — this list only surfaces *which* recommendations were
/// skipped so the caller/UI can guide the user (e.g. "assign a supplier then retry").
/// </param>
public sealed record PurchaseOrderDraftBatchResult(
    IReadOnlyList<BuiltDraftPurchaseOrder> Drafts,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<Guid> UnlinkedRecommendationIds);

/// <summary>
/// A single draft PO that has been built but **not yet persisted**. The caller must attach
/// <see cref="PurchaseOrder"/> to its DbContext and call <c>SaveChangesAsync</c>.
/// </summary>
public sealed record BuiltDraftPurchaseOrder(
    PurchaseOrder PurchaseOrder,
    IReadOnlyList<Guid> RecommendationIds);
