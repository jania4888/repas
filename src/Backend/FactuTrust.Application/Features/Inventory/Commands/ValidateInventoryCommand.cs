using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FluentValidation;
using MediatR;

using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Options;
using FactuTrust.Application.Features.Stock.Services;

namespace FactuTrust.Application.Features.Inventory.Commands;

/// <summary>
/// Comptage non encore persisté, appliqué juste avant la validation.
/// </summary>
public sealed record InventoryPendingCount(
    Guid ProductId,
    decimal CountedQuantity,
    Guid? ProductLotId = null,
    string? LotNumber = null);

/// <summary>
/// Valide l'inventaire et applique les ajustements de stock.
/// Les lignes non saisies sont confirmées à la quantité système.
/// </summary>
public sealed record ValidateInventoryCommand(
    Guid InventoryId,
    IReadOnlyList<InventoryPendingCount>? PendingCounts = null) : IRequest<Result<ValidateInventoryResult>>;

/// <summary>
/// Résultat de la validation avec résumé pédagogique.
/// </summary>
public sealed record ValidateInventoryResult
{
    public Guid InventoryId { get; init; }
    public int TotalProducts { get; init; }
    public int ProductsWithChanges { get; init; }
    public int ProductsOk { get; init; }
    public string HumanMessage { get; init; } = string.Empty;
    public IReadOnlyList<AdjustmentSummaryItem> Adjustments { get; init; } = Array.Empty<AdjustmentSummaryItem>();
}

/// <summary>
/// Résumé d'un ajustement de stock.
/// </summary>
public sealed record AdjustmentSummaryItem
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = string.Empty;
    public decimal PreviousQuantity { get; init; }
    public decimal NewQuantity { get; init; }
    public decimal Difference { get; init; }
    public string HumanMessage { get; init; } = string.Empty;
}

public sealed class ValidateInventoryCommandValidator : AbstractValidator<ValidateInventoryCommand>
{
    public ValidateInventoryCommandValidator()
    {
        RuleFor(x => x.InventoryId)
            .NotEmpty()
            .WithMessage("L'identifiant de l'inventaire est obligatoire.");

        When(x => x.PendingCounts != null, () =>
        {
            RuleForEach(x => x.PendingCounts).ChildRules(count =>
            {
                count.RuleFor(c => c.ProductId)
                    .NotEmpty()
                    .WithMessage("L'identifiant du produit est obligatoire.");

                count.RuleFor(c => c.CountedQuantity)
                    .GreaterThanOrEqualTo(0)
                    .WithMessage("La quantité comptée ne peut pas être négative.");
            });
        });
    }
}

public sealed class ValidateInventoryCommandHandler : IRequestHandler<ValidateInventoryCommand, Result<ValidateInventoryResult>>
{
    private readonly IPhysicalInventoryRepository _inventoryRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockMutationService _mutation;
    private readonly IStockValuationReader _valuationReader;
    private readonly StockTraceabilityOptions _stockOptions;
    private readonly ITenantContext _tenantContext;

    public ValidateInventoryCommandHandler(
        IPhysicalInventoryRepository inventoryRepository,
        IStockItemRepository stockItemRepository,
        IProductRepository productRepository,
        IStockMutationService mutation,
        IStockValuationReader valuationReader,
        IOptions<StockTraceabilityOptions> stockOptions,
        ITenantContext tenantContext)
    {
        _inventoryRepository = inventoryRepository;
        _stockItemRepository = stockItemRepository;
        _productRepository = productRepository;
        _mutation = mutation;
        _valuationReader = valuationReader;
        _stockOptions = stockOptions.Value;
        _tenantContext = tenantContext;
    }

    public async Task<Result<ValidateInventoryResult>> Handle(ValidateInventoryCommand request, CancellationToken cancellationToken)
    {
        if (_tenantContext.TenantId is null)
            return Result.Failure<ValidateInventoryResult>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        // Get inventory with lines
        var inventory = await _inventoryRepository.GetWithLinesAsync(request.InventoryId, cancellationToken);
        if (inventory == null)
            return Result.Failure<ValidateInventoryResult>(Error.NotFound("Inventaire", request.InventoryId));

        if (request.PendingCounts is { Count: > 0 })
        {
            foreach (var pending in request.PendingCounts)
            {
                var recordResult = inventory.RecordCount(
                    pending.ProductId,
                    pending.CountedQuantity,
                    pending.ProductLotId,
                    pending.LotNumber);
                if (recordResult.IsFailure)
                    return Result.Failure<ValidateInventoryResult>(recordResult.Error);
            }
        }

        var validateResult = inventory.Validate();
        if (validateResult.IsFailure)
            return Result.Failure<ValidateInventoryResult>(validateResult.Error);

        // Apply stock adjustments for each product with difference
        var adjustments = new List<AdjustmentSummaryItem>();
        var linesWithDifference = inventory.CountLines.Where(l => l.Difference != 0).ToList();
        var productIds = linesWithDifference.Select(l => l.ProductId).Distinct().ToList();
        var trackingByProduct = await _productRepository.GetTrackingInfoByIdsAsync(productIds, cancellationToken);
        var productsById = await _productRepository.GetByIdsAsync(productIds, cancellationToken);

        // Valorisations chargées EN LOT, avant la boucle : jamais une lecture par ligne.
        var stockItemsByProduct = new Dictionary<Guid, Domain.Entities.StockItem>();
        foreach (var productId in productIds)
        {
            var item = await _stockItemRepository.GetByProductAndWarehouseAsync(
                productId, inventory.WarehouseId, cancellationToken);
            if (item is not null)
                stockItemsByProduct[productId] = item;
        }

        var valuations = await _valuationReader.GetByStockItemIdsAsync(
            stockItemsByProduct.Values.Select(i => i.Id).ToList(), cancellationToken);

        foreach (var line in linesWithDifference)
        {
            if (!line.CountedQuantity.HasValue)
                continue;

            stockItemsByProduct.TryGetValue(line.ProductId, out var stockItem);

            var tracking = trackingByProduct.GetValueOrDefault(line.ProductId);
            var trackingMode = tracking?.TrackingMode ?? TrackingMode.None;

            StockCostReading? reading = null;
            if (stockItem is not null)
                valuations.TryGetValue(stockItem.Id, out reading);

            var mutationResult = await ApplyLineMutationAsync(
                inventory,
                line,
                stockItem,
                trackingMode,
                reading,
                productsById.GetValueOrDefault(line.ProductId),
                cancellationToken);

            if (mutationResult.IsFailure)
                return Result.Failure<ValidateInventoryResult>(mutationResult.Error);

            adjustments.Add(new AdjustmentSummaryItem
            {
                ProductId = line.ProductId,
                ProductName = line.ProductName,
                PreviousQuantity = line.TheoreticalQuantity,
                NewQuantity = line.CountedQuantity.Value,
                Difference = line.Difference,
                HumanMessage = line.GetHumanMessage()
            });
        }

        await _inventoryRepository.UpdateAsync(inventory, cancellationToken);

        // Generate summary message
        var productsOk = inventory.CountLines.Count(l => l.Difference == 0);
        var humanMessage = GenerateSummaryMessage(inventory.TotalProducts, linesWithDifference.Count, productsOk);

        return Result.Success(new ValidateInventoryResult
        {
            InventoryId = inventory.Id,
            TotalProducts = inventory.TotalProducts,
            ProductsWithChanges = linesWithDifference.Count,
            ProductsOk = productsOk,
            HumanMessage = humanMessage,
            Adjustments = adjustments
        });
    }

    private async Task<Result> ApplyLineMutationAsync(
        PhysicalInventory inventory,
        InventoryCountLine line,
        StockItem? stockItem,
        TrackingMode trackingMode,
        StockCostReading? reading,
        Product? product,
        CancellationToken cancellationToken)
    {
        if (trackingMode == TrackingMode.Serial)
        {
            return Result.Failure(Error.Validation(
                "TrackingMode",
                $"L'article « {line.ProductName} » est suivi par numéro de série. Comptez par n° de série (inventaire)."));
        }

        if (trackingMode == TrackingMode.Lot)
        {
            if (!HasLotIdentity(line))
            {
                return Result.Failure(Error.Validation(
                    "LotNumber",
                    $"Le numéro de lot est obligatoire pour « {line.ProductName} » (article suivi par lot)."));
            }

            return ResultFrom(await ApplyLotAllocatedMutationAsync(
                inventory, line, stockItem, reading, product, cancellationToken));
        }

        return ResultFrom(await _mutation.ApplyAsync(new StockMutationRequest
        {
            ProductId = line.ProductId,
            WarehouseId = inventory.WarehouseId,
            Kind = StockMutationKind.Adjust,
            Quantity = line.CountedQuantity!.Value,
            // Coût d'un écart POSITIF. Sans le drapeau d'auto-valorisation, la cascade d'achat
            // est désactivée et l'on retombe sur le cache, donc sur le comportement d'avant.
            UnitCost = ResolveAdjustmentCost(reading, product, stockItem),
            Notes = $"Ajustement inventaire #{inventory.Id:N}",
            Reason = MovementReason.InventoryAdjustment
        }, cancellationToken));
    }

    /// <summary>
    /// Coût d'un écart d'inventaire positif : les couches pour un article FIFO/LIFO, le CMUP
    /// sinon, et — seulement si le drapeau est actif — la cascade des prix d'achat plutôt que
    /// zéro. Sans le drapeau, un article jamais valorisé reste à zéro, comme aujourd'hui.
    /// </summary>
    private decimal ResolveAdjustmentCost(StockCostReading? reading, Product? product, StockItem? stockItem) =>
        StockEntryCostResolver.Resolve(
            reading,
            product,
            explicitUnitCost: null,
            allowPurchasePriceCascade: _stockOptions.InventoryAutoValuationEnabled,
            cachedAverageCost: stockItem?.AverageCost).UnitCost;

    private static bool HasLotIdentity(InventoryCountLine line) =>
        line.ProductLotId.HasValue || !string.IsNullOrWhiteSpace(line.LotNumber);

    private async Task<Result<StockMutationResult>> ApplyLotAllocatedMutationAsync(
        PhysicalInventory inventory,
        InventoryCountLine line,
        StockItem? stockItem,
        StockCostReading? reading,
        Product? product,
        CancellationToken cancellationToken)
    {
        var difference = line.Difference;
        var qty = Math.Abs(difference);
        var lotLabel = line.LotNumber ?? line.ProductLotId?.ToString("N");
        var allocation = new StockAllocationInput(qty, line.ProductLotId, LotNumber: line.LotNumber);

        if (difference > 0)
        {
            return await _mutation.ApplyAsync(new StockMutationRequest
            {
                ProductId = line.ProductId,
                WarehouseId = inventory.WarehouseId,
                Kind = StockMutationKind.Entry,
                Quantity = qty,
                UnitCost = ResolveAdjustmentCost(reading, product, stockItem),
                Reason = MovementReason.InventoryAdjustment,
                Notes = $"Ajustement inventaire lot {lotLabel}",
                DocumentLineId = line.Id,
                DocumentKind = StockDocumentKind.Inventory,
                Allocations = new[] { allocation }
            }, cancellationToken);
        }

        return await _mutation.ApplyAsync(new StockMutationRequest
        {
            ProductId = line.ProductId,
            WarehouseId = inventory.WarehouseId,
            Kind = StockMutationKind.Exit,
            Quantity = qty,
            Reason = MovementReason.InventoryAdjustment,
            Notes = $"Ajustement inventaire lot {lotLabel}",
            DocumentLineId = line.Id,
            DocumentKind = StockDocumentKind.Inventory,
            Allocations = new[] { allocation }
        }, cancellationToken);
    }

    private static string GenerateSummaryMessage(int total, int withChanges, int ok)
    {
        if (withChanges == 0)
            return $"🎉 Parfait ! Tous vos {total} produits correspondent exactement au système. Aucun ajustement nécessaire.";

        if (ok == 0)
            return $"✅ Inventaire terminé ! Le stock de {withChanges} produit{(withChanges > 1 ? "s" : "")} a été ajusté.";

        return $"✅ Inventaire terminé ! {ok} produit{(ok > 1 ? "s" : "")} OK, {withChanges} ajusté{(withChanges > 1 ? "s" : "")}.";
    }

    private static Result ResultFrom<T>(Result<T> result) =>
        result.IsFailure ? Result.Failure(result.Error) : Result.Success();
}
