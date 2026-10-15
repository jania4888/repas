using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Stock.Queries;
using FactuTrust.Application.Features.Stock.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Tests.Stock;

internal sealed class FakePassthroughStockMutationService : IStockMutationService
{
    private readonly IStockItemRepository _items;

    public FakePassthroughStockMutationService(IStockItemRepository items)
    {
        _items = items;
    }

    public Result Apply(
        StockItem stockItem,
        StockMutationRequest request,
        Product? product = null,
        IStockTraceabilityStore? store = null) =>
        StockMutationService.ApplyPassthrough(stockItem, request);

    public async Task<Result<StockMutationResult>> ApplyAsync(
        StockMutationRequest request,
        CancellationToken cancellationToken = default)
    {
        var item = await _items.GetByProductAndWarehouseAsync(request.ProductId, request.WarehouseId, cancellationToken);
        if (item is null)
        {
            if (request.Kind is StockMutationKind.Exit or StockMutationKind.ReleaseAndExit)
            {
                return Result.Failure<StockMutationResult>(Error.Validation(
                    "Quantity",
                    $"Stock insuffisant. Disponible: 0, Demandé: {request.Quantity}"));
            }

            var created = StockItem.Create(request.ProductId, request.WarehouseId);
            if (created.IsFailure)
                return Result.Failure<StockMutationResult>(created.Error);

            item = created.Value;
            await _items.AddAsync(item, cancellationToken);
        }

        var applied = StockMutationService.ApplyPassthrough(item, request);
        if (applied.IsFailure)
            return Result.Failure<StockMutationResult>(applied.Error);

        await _items.UpdateAsync(item, cancellationToken);
        return Result.Success(new StockMutationResult(item.Id, item.QuantityOnHand, item.AverageCost));
    }

    public Task<Result> CreateOpeningValuationLayersAsync(
        Guid productId,
        CostingMethod costingMethod,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(Result.Success());
}

internal sealed class AlwaysUntrackedDocumentStockService : ITrackedDocumentStockService
{
    public bool IsLiveTracked(Product product) => false;

    public Task<Result> ApplyEntriesAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false) =>
        Task.FromResult(Result.Success());

    public Task<Result> ApplyExitsAsync(
        Guid warehouseId,
        string reference,
        MovementReason reason,
        IReadOnlyList<TrackedDocumentLine> lines,
        CancellationToken cancellationToken = default,
        bool includeUntracked = false) =>
        Task.FromResult(Result.Success());
}

internal sealed class EmptyStockTraceabilityQuery : IStockTraceabilityQuery
{
    public Task<IReadOnlyList<StockLotBalanceDto>> ListLotsAsync(Guid stockItemId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<StockLotBalanceDto>>(Array.Empty<StockLotBalanceDto>());

    public Task<IReadOnlyList<StockValuationLayerDto>> ListValuationLayersAsync(Guid stockItemId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<StockValuationLayerDto>>(Array.Empty<StockValuationLayerDto>());

    public Task<IReadOnlyList<ExpiryAlertDto>> ListExpiryAlertsAsync(Guid? warehouseId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ExpiryAlertDto>>(Array.Empty<ExpiryAlertDto>());

    public Task<IReadOnlyList<ProductSerialDto>> ListInStockSerialsAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ProductSerialDto>>(Array.Empty<ProductSerialDto>());

    public Task<IReadOnlyList<ProductTraceabilityContextDto>> ListTraceabilityContextAsync(
        IReadOnlyList<Guid> productIds,
        Guid warehouseId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ProductTraceabilityContextDto>>(Array.Empty<ProductTraceabilityContextDto>());

    public Task<IReadOnlyDictionary<Guid, string>> GetLotLabelsAsync(
        StockDocumentKind kind,
        IReadOnlyCollection<Guid> documentLineIds,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, string>>(new Dictionary<Guid, string>());
}

/// <summary>
/// Lecteur de valorisation vide : aucune couche, aucune lecture. Les appelants retombent alors sur
/// le CMUP qu'ils passent en repli — c'est-à-dire exactement le comportement d'avant la lecture
/// par couches. C'est ce qu'il faut pour les tests de caractérisation, qui doivent rester verts.
/// </summary>
internal sealed class EmptyStockValuationReader : IStockValuationReader
{
    public Task<IReadOnlyDictionary<Guid, StockCostReading>> GetByStockItemIdsAsync(
        IReadOnlyCollection<Guid> stockItemIds,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, StockCostReading>>(new Dictionary<Guid, StockCostReading>());

    public Task<StockCostReading?> GetByProductAndWarehouseAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<StockCostReading?>(null);

    public Task<decimal> GetTotalStockValueAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(0m);

    public Task<IReadOnlyList<StockValuationDriftRow>> ListValuationDriftAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<StockValuationDriftRow>>(Array.Empty<StockValuationDriftRow>());
}

internal static class StockTestDoubles
{
    /// <summary>Aucune valorisation lisible : repli sur le CMUP, comme avant le chantier couches.</summary>
    public static IStockValuationReader NoValuation() => new EmptyStockValuationReader();

    public static IStockMutationService Passthrough(IStockItemRepository items) =>
        new FakePassthroughStockMutationService(items);

    public static IStockMutationService Real(ITenantDbContextFactory factory) =>
        new StockMutationService(factory, Options.Create(new StockTraceabilityOptions()));

    public static ITrackedDocumentStockService Untracked() => new AlwaysUntrackedDocumentStockService();

    public static IStockTraceabilityQuery EmptyLots() => new EmptyStockTraceabilityQuery();

    /// <summary>
    /// Le VRAI lecteur de valorisation, branché sur la base en mémoire. Volontairement pas un
    /// bouchon : les tests qui valorisent une entrée doivent exercer la même lecture de couches
    /// que la production, sinon ils valideraient un chemin qui n'existe pas.
    /// </summary>
    public static IStockValuationReader ValuationReader(
        ITenantDbContextFactory factory,
        StockTraceabilityOptions? options = null) =>
        new EfStockValuationReader(factory, Options.Create(options ?? new StockTraceabilityOptions()));
}
