using FactuTrust.Application.Features.Stock.Services;
using Microsoft.Extensions.Options;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.Stock.Commands;

/// <summary>
/// Command pour le "Compter mon stock" ultra-simplifié.
/// L'utilisateur indique simplement combien il a réellement, le système s'occupe du reste.
/// </summary>
public sealed record QuickStockCountCommand(
    Guid ProductId,
    decimal ActualQuantity,
    Guid? WarehouseId = null,
    string? Notes = null) : IRequest<Result<QuickStockCountResult>>;

/// <summary>
/// Résultat pédagogique du comptage rapide.
/// Contient un message humain expliquant ce qui a été fait.
/// </summary>
public sealed record QuickStockCountResult
{
    public Guid ProductId { get; init; }
    public string ProductName { get; init; } = string.Empty;
    public decimal PreviousQuantity { get; init; }
    public decimal NewQuantity { get; init; }
    public decimal Difference { get; init; }
    
    /// <summary>
    /// Message pédagogique expliquant l'ajustement.
    /// Ex: "Nous avons retiré 3 unités pour correspondre à votre compte."
    /// </summary>
    public string HumanMessage { get; init; } = string.Empty;
    
    /// <summary>
    /// Indique si le stock est maintenant bas.
    /// </summary>
    public bool IsNowLowStock { get; init; }
    
    /// <summary>
    /// Message d'alerte optionnel si le stock est bas.
    /// </summary>
    public string? AlertMessage { get; init; }
}

/// <summary>
/// Validator pour QuickStockCountCommand.
/// </summary>
public sealed class QuickStockCountCommandValidator : AbstractValidator<QuickStockCountCommand>
{
    public QuickStockCountCommandValidator()
    {
        RuleFor(x => x.ProductId)
            .NotEmpty()
            .WithMessage("Veuillez sélectionner un produit.");
        
        RuleFor(x => x.ActualQuantity)
            .GreaterThanOrEqualTo(0)
            .WithMessage("La quantité ne peut pas être négative.");
    }
}

/// <summary>
/// Handler pour QuickStockCountCommand.
/// Implémente la règle "Je décris ma réalité, le système s'occupe du reste".
/// </summary>
public sealed class QuickStockCountCommandHandler : IRequestHandler<QuickStockCountCommand, Result<QuickStockCountResult>>
{
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly ITenantContext _tenantContext;
    private readonly IStockMutationService _mutation;
    private readonly IStockValuationReader _valuationReader;
    private readonly StockTraceabilityOptions _stockOptions;

    public QuickStockCountCommandHandler(
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        ITenantContext tenantContext,
        IStockMutationService mutation,
        IStockValuationReader valuationReader,
        IOptions<StockTraceabilityOptions> stockOptions)
    {
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _tenantContext = tenantContext;
        _mutation = mutation;
        _valuationReader = valuationReader;
        _stockOptions = stockOptions.Value;
    }

    public async Task<Result<QuickStockCountResult>> Handle(QuickStockCountCommand request, CancellationToken cancellationToken)
    {
        if (_tenantContext.TenantId is null)
            return Result.Failure<QuickStockCountResult>(Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        // Récupérer le produit
        var product = await _productRepository.GetByIdAsync(request.ProductId, cancellationToken);
        if (product == null)
            return Result.Failure<QuickStockCountResult>(Error.NotFound("Produit", request.ProductId));

        if (!product.IsStockManaged)
            return Result.Failure<QuickStockCountResult>(
                Error.Validation("Product", "Ce produit n'a pas la gestion de stock activée."));

        if (product.TrackingMode != TrackingMode.None)
            return Result.Failure<QuickStockCountResult>(
                Error.Validation("TrackingMode",
                    "Le comptage rapide est interdit sur un article suivi. Utilisez l'inventaire par lot."));

        // Déterminer l'entrepôt
        Guid warehouseId;
        if (request.WarehouseId.HasValue)
        {
            warehouseId = request.WarehouseId.Value;
        }
        else
        {
            var defaultWarehouse = await _warehouseRepository.GetDefaultAsync(cancellationToken);
            if (defaultWarehouse == null)
                return Result.Failure<QuickStockCountResult>(
                    Error.Validation("Warehouse", "Aucun entrepôt par défaut n'est configuré."));
            warehouseId = defaultWarehouse.Id;
        }

        // Récupérer ou créer le stock item
        var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
            request.ProductId, warehouseId, cancellationToken);

        decimal previousQuantity = 0;

        if (stockItem == null)
        {
            // Créer un nouvel item de stock
            var createResult = Domain.Entities.StockItem.Create(request.ProductId, warehouseId);
            if (createResult.IsFailure)
                return Result.Failure<QuickStockCountResult>(createResult.Error);

            stockItem = createResult.Value;
            await _stockItemRepository.AddAsync(stockItem, cancellationToken);
        }
        else
        {
            previousQuantity = stockItem.QuantityOnHand;
        }

        // Calculer la différence
        var difference = request.ActualQuantity - previousQuantity;

        // Ajuster le stock si nécessaire
        if (difference != 0)
        {
            var notes = string.IsNullOrWhiteSpace(request.Notes) 
                ? "Mise à jour via comptage rapide" 
                : request.Notes;
            
            // Coût d'un écart POSITIF. Drapeau éteint ⇒ la cascade d'achat est désactivée et l'on
            // retombe sur le CMUP, donc sur le comportement d'avant.
            var reading = await _valuationReader.GetByProductAndWarehouseAsync(
                request.ProductId, warehouseId, cancellationToken);
            var unitCost = StockEntryCostResolver.Resolve(
                reading,
                product,
                explicitUnitCost: null,
                allowPurchasePriceCascade: _stockOptions.InventoryAutoValuationEnabled,
                cachedAverageCost: stockItem.AverageCost).UnitCost;

            var adjustResult = await _mutation.ApplyAsync(new StockMutationRequest
            {
                ProductId = request.ProductId,
                WarehouseId = warehouseId,
                Kind = StockMutationKind.Adjust,
                Quantity = request.ActualQuantity,
                UnitCost = unitCost,
                Notes = notes,
                Reason = MovementReason.InventoryAdjustment
            }, cancellationToken);
            if (adjustResult.IsFailure)
                return Result.Failure<QuickStockCountResult>(adjustResult.Error);

            stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                request.ProductId, warehouseId, cancellationToken) ?? stockItem;
        }

        // Générer le message pédagogique
        var humanMessage = GenerateHumanMessage(previousQuantity, request.ActualQuantity, difference);
        
        // Vérifier si le stock est bas
        string? alertMessage = null;
        if (stockItem.IsLowStock)
        {
            alertMessage = $"⚠️ Attention : le stock de ce produit est maintenant bas ({request.ActualQuantity} unités restantes).";
        }
        else if (stockItem.IsOutOfStock)
        {
            alertMessage = "⛔ Ce produit est maintenant en rupture de stock.";
        }

        return Result.Success(new QuickStockCountResult
        {
            ProductId = product.Id,
            ProductName = product.Name,
            PreviousQuantity = previousQuantity,
            NewQuantity = request.ActualQuantity,
            Difference = difference,
            HumanMessage = humanMessage,
            IsNowLowStock = stockItem.IsLowStock || stockItem.IsOutOfStock,
            AlertMessage = alertMessage
        });
    }

    /// <summary>
    /// Génère un message pédagogique humain expliquant l'ajustement.
    /// </summary>
    private static string GenerateHumanMessage(decimal previous, decimal actual, decimal difference)
    {
        if (difference == 0)
        {
            return "✅ Parfait ! Votre comptage correspond exactement au système.";
        }
        
        var absDiff = Math.Abs(difference);
        var unitText = absDiff == 1 ? "unité" : "unités";

        if (difference > 0)
        {
            return $"✅ Stock mis à jour ! Nous avons ajouté {absDiff} {unitText} pour correspondre à votre comptage.";
        }
        else
        {
            return $"✅ Stock mis à jour ! Nous avons retiré {absDiff} {unitText} pour correspondre à votre comptage.";
        }
    }
}
