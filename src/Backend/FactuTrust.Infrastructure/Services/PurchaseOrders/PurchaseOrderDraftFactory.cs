using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.PurchaseOrders;

/// <summary>
/// Default implementation of <see cref="IPurchaseOrderDraftFactory"/>. Pure **builder**:
/// constructs <see cref="PurchaseOrder"/> aggregates (Draft status) ready to be attached
/// to the caller's <c>DbContext</c>. It does NOT persist anything itself — that is the
/// caller's responsibility, so the whole batch (POs + recommendation status transitions
/// + audit rows) can be saved atomically with one <c>SaveChangesAsync</c>.
/// PO numbers are reserved through <see cref="IDocumentNumberService"/> (serializable
/// scheme-row update, execution-strategy retries) — the only atomic numbering path in the
/// codebase — instead of a read-latest + in-memory increment that raced under concurrency
/// and produced duplicate BC numbers (Phase 2 review M3).
/// </summary>
public sealed class PurchaseOrderDraftFactory : IPurchaseOrderDraftFactory
{
    private readonly IDocumentNumberService _documentNumberService;
    private readonly ILogger<PurchaseOrderDraftFactory> _logger;

    public PurchaseOrderDraftFactory(
        IDocumentNumberService documentNumberService,
        ILogger<PurchaseOrderDraftFactory> logger)
    {
        _documentNumberService = documentNumberService;
        _logger = logger;
    }

    public async Task<PurchaseOrderDraftBatchResult> BuildDraftPurchaseOrdersAsync(
        IReadOnlyList<ReplenishmentRecommendation> recommendations,
        IReadOnlyDictionary<Guid, Product> products,
        IReadOnlyDictionary<Guid, Supplier> suppliers,
        IReadOnlyDictionary<Guid, Money> unitPriceByRecommendationId,
        string actorUserId,
        Guid tenantId,
        CancellationToken ct = default)
    {
        if (recommendations is null || recommendations.Count == 0)
            return new PurchaseOrderDraftBatchResult(
                Array.Empty<BuiltDraftPurchaseOrder>(), Array.Empty<string>(), Array.Empty<Guid>());

        var warnings = new List<string>();
        var drafts = new List<BuiltDraftPurchaseOrder>();
        // Recommendations that end up attached to no draft PO (skip reasons below).
        var unlinked = new List<Guid>();

        // Partition recommendations by (effective supplier, warehouse) — manual override > preferred.
        // The warehouse is part of the key because the generated PO MUST carry a WarehouseId:
        // the replenishment engine only counts on-order quantities for POs whose WarehouseId is set
        // (ReplenishmentService filters `po.WarehouseId.HasValue`). A PO without warehouse was
        // therefore invisible to the next generation run, which re-created the same recommendation
        // (double-order risk + Pending/Ordered/Superseded duplicates on the board).
        var bySupplierAndWarehouse = recommendations
            .GroupBy(r => new { SupplierId = r.GetEffectiveSupplierId(), r.WarehouseId })
            .ToList();

        var year = DateTime.UtcNow.Year;

        foreach (var group in bySupplierAndWarehouse)
        {
            var supplierId = group.Key.SupplierId;
            if (supplierId is null)
            {
                foreach (var rec in group)
                    warnings.Add($"Recommandation {rec.Id} non liée : aucun fournisseur (préféré ou manuel) résolu.");
                unlinked.AddRange(group.Select(r => r.Id));
                continue;
            }

            if (!suppliers.TryGetValue(supplierId.Value, out var supplier))
            {
                foreach (var rec in group)
                    warnings.Add($"Recommandation {rec.Id} non liée : fournisseur {supplierId} introuvable.");
                unlinked.AddRange(group.Select(r => r.Id));
                continue;
            }

            if (!supplier.IsActive)
            {
                foreach (var rec in group)
                    warnings.Add($"Recommandation {rec.Id} non liée : fournisseur {supplier.Name} désactivé.");
                unlinked.AddRange(group.Select(r => r.Id));
                continue;
            }

            // Pre-validate lines BEFORE reserving a number: a group with no usable line
            // must not burn a sequence value (numbering gap).
            var candidates = new List<(ReplenishmentRecommendation Rec, Product Product, decimal Qty)>();
            foreach (var rec in group)
            {
                if (!products.TryGetValue(rec.ProductId, out var product))
                {
                    warnings.Add($"Recommandation {rec.Id} non liée : produit {rec.ProductId} introuvable.");
                    unlinked.Add(rec.Id);
                    continue;
                }

                var qty = rec.GetEffectiveOrderQty();
                if (qty <= 0)
                {
                    warnings.Add($"Recommandation {rec.Id} non liée : quantité effective <= 0.");
                    unlinked.Add(rec.Id);
                    continue;
                }

                candidates.Add((rec, product, qty));
            }

            if (candidates.Count == 0)
            {
                _logger.LogWarning("PO draft for supplier {Supplier} skipped: no usable line.", supplier.Name);
                continue;
            }

            // M3: atomic number reservation through the unified numbering service (serializable
            // scheme-row update + execution-strategy retries). A missing scheme is seeded from the
            // max existing PO sequence, so continuity with previously issued BC numbers is preserved.
            var reservation = await _documentNumberService.ReserveNextAsync(
                tenantId,
                NumberingDocumentType.PurchaseOrder,
                year,
                DateTime.UtcNow,
                ct);
            var number = DocumentNumberMapper.ToPurchaseOrderNumber(reservation);

            var poResult = PurchaseOrder.Create(
                number,
                supplier,
                orderDate: DateTime.UtcNow.Date,
                expectedDeliveryDate: null,
                reference: null,
                notes: "Brouillon créé automatiquement depuis le module Prévisions IA — Réapprovisionnement V2.",
                warehouseId: group.Key.WarehouseId);

            if (poResult.IsFailure)
            {
                // The reserved number is abandoned (gap). Very rare: Create only fails on invalid
                // arguments, which the checks above already exclude.
                _logger.LogWarning(
                    "PO draft {Number} abandoned for supplier {Supplier}: {Error}. The reserved number is lost (gap).",
                    number.Value, supplier.Name, poResult.Error.Description);
                foreach (var candidate in candidates)
                    warnings.Add($"Recommandation {candidate.Rec.Id} non liée : échec création BC ({poResult.Error.Description}).");
                unlinked.AddRange(candidates.Select(c => c.Rec.Id));
                continue;
            }

            var po = poResult.Value;
            po.SetAuditInfo(actorUserId);

            var linkedIds = new List<Guid>();
            foreach (var (rec, product, qty) in candidates)
            {
                if (!unitPriceByRecommendationId.TryGetValue(rec.Id, out var unitPrice))
                {
                    warnings.Add($"Recommandation {rec.Id} non liée : prix unitaire manquant.");
                    unlinked.Add(rec.Id);
                    continue;
                }

                var addLine = po.AddLine(product, qty, unitPrice);
                if (addLine.IsFailure)
                {
                    warnings.Add($"Recommandation {rec.Id} non liée : {addLine.Error.Description}.");
                    unlinked.Add(rec.Id);
                    continue;
                }

                linkedIds.Add(rec.Id);
            }

            if (linkedIds.Count == 0)
            {
                _logger.LogWarning(
                    "PO draft {Number} for supplier {Supplier} skipped: every line was rejected. The reserved number is lost (gap).",
                    po.Number.Value, supplier.Name);
                continue;
            }

            drafts.Add(new BuiltDraftPurchaseOrder(PurchaseOrder: po, RecommendationIds: linkedIds));
        }

        _logger.LogInformation(
            "PO drafts built (not yet persisted): {Count} draft(s), {Linked} recommendation(s) targeted, {Unlinked} unlinked, {WarningCount} warning(s).",
            drafts.Count,
            drafts.Sum(d => d.RecommendationIds.Count),
            unlinked.Count,
            warnings.Count);

        return new PurchaseOrderDraftBatchResult(drafts, warnings, unlinked);
    }
}
