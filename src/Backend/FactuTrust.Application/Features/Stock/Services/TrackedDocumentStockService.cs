using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Stock.Services;

public sealed record TrackedDocumentLine(
    Guid ProductId,
    decimal Quantity,
    Guid DocumentLineId,
    StockDocumentKind DocumentKind,
    IReadOnlyList<StockAllocationInput>? Allocations = null,
    decimal? UnitCost = null);

public interface ITrackedDocumentStockService
{
    bool IsLiveTracked(Product product);

    Task<Result> ApplyEntriesAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false);

    Task<Result> ApplyExitsAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false);
}

public sealed class TrackedDocumentStockService : ITrackedDocumentStockService
{
    private readonly IProductRepository _products;
    private readonly IStockMutationService _mutation;
    private readonly StockTraceabilityOptions _options;

    public TrackedDocumentStockService(
        IProductRepository products,
        IStockMutationService mutation,
        IOptions<StockTraceabilityOptions> options)
    {
        _products = products;
        _mutation = mutation;
        _options = options.Value;
    }

    public bool IsLiveTracked(Product product)
    {
        if (product.TrackingMode == TrackingMode.Lot && _options.LotTrackingEnabled)
            return true;
        if (product.TrackingMode == TrackingMode.Serial && _options.SerialTrackingEnabled)
            return true;
        // Règle partagée : surtout pas une copie du test. Voir StockCostingPolicy.
        if (_options.RequiresLayeredCosting(product))
            return true;
        return false;
    }

    public Task<Result> ApplyEntriesAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false) =>
        ApplyAsync(warehouseId, reference, reason, lines, StockMutationKind.Entry, cancellationToken, includeUntracked);

    public Task<Result> ApplyExitsAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false) =>
        ApplyAsync(warehouseId, reference, reason, lines, StockMutationKind.Exit, cancellationToken, includeUntracked);

    private async Task<Result> ApplyAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        StockMutationKind kind,
        CancellationToken cancellationToken,
        bool includeUntracked = false)
    {
        foreach (var line in lines)
        {
            var product = await _products.GetByIdAsync(line.ProductId, cancellationToken);
            if (product is null || !product.IsStockManaged)
                continue;
            if (!IsLiveTracked(product) && !includeUntracked)
                continue;

            var result = await _mutation.ApplyAsync(new StockMutationRequest
            {
                ProductId = line.ProductId,
                WarehouseId = warehouseId,
                Kind = kind,
                Quantity = line.Quantity,
                UnitCost = line.UnitCost ?? 0,
                Reason = reason,
                Reference = reference,
                DocumentLineId = line.DocumentLineId,
                DocumentKind = line.DocumentKind,
                Allocations = line.Allocations
            }, cancellationToken);

            if (result.IsFailure)
                return Result.Failure(result.Error);
        }

        return Result.Success();
    }
}
