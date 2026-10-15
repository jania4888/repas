using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Stock.Queries;

/// <summary>
/// Query to get stock items with filtering and pagination.
/// </summary>
public sealed record GetStockItemsQuery(
    Guid? WarehouseId,
    bool? LowStockOnly,
    bool? OutOfStockOnly,
    int Page = 1,
    int PageSize = 20) : IRequest<StockItemsResult>;

/// <summary>
/// Result for stock items query.
/// </summary>
public sealed record StockItemsResult(
    IReadOnlyList<StockItemDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    /// <summary>
    /// Valeur de TOUT le stock filtré, pas seulement de la page. Le KPI de l'écran la sommait
    /// côté navigateur sur les 20 lignes affichées, et présentait ce sous-total comme un total.
    /// </summary>
    decimal TotalStockValue = 0m);

/// <summary>
/// DTO for stock item.
/// </summary>
public sealed record StockItemDto(
    Guid Id,
    Guid ProductId,
    string ProductCode,
    string ProductName,
    Guid WarehouseId,
    string WarehouseCode,
    string WarehouseName,
    decimal QuantityOnHand,
    decimal QuantityAvailable,
    decimal QuantityReserved,
    decimal MinimumStock,
    decimal? MaximumStock,
    /// <summary>Le cache CMUP de l'article, tel quel. Conservé pour ne pas faire mentir son nom.</summary>
    decimal AverageCost,
    /// <summary>Valeur réelle : somme des couches en FIFO/LIFO, quantité × CMUP sinon.</summary>
    decimal StockValue,
    bool IsLowStock,
    bool IsOutOfStock,
    CostingMethod CostingMethod,
    /// <summary>
    /// Le coût à AFFICHER : coût de la prochaine sortie en FIFO/LIFO, CMUP sinon.
    /// C'est ce champ que l'écran montre, pas <paramref name="AverageCost"/>.
    /// </summary>
    decimal UnitCost = 0m,
    /// <summary>Vrai ⇒ <paramref name="UnitCost"/> × quantité ≠ <paramref name="StockValue"/>, et c'est normal.</summary>
    bool UnitCostIsNextExit = false,
    bool HasValuationLayers = false);

/// <summary>
/// Handler for GetStockItemsQuery.
/// </summary>
public sealed class GetStockItemsQueryHandler : IRequestHandler<GetStockItemsQuery, StockItemsResult>
{
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IProductRepository _productRepository;
    private readonly IStockValuationReader _valuationReader;
    private readonly ITenantContext _tenantContext;

    public GetStockItemsQueryHandler(
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        IProductRepository productRepository,
        IStockValuationReader valuationReader,
        ITenantContext tenantContext)
    {
        _stockItemRepository = stockItemRepository;
        _warehouseRepository = warehouseRepository;
        _productRepository = productRepository;
        _valuationReader = valuationReader;
        _tenantContext = tenantContext;
    }

    public async Task<StockItemsResult> Handle(GetStockItemsQuery request, CancellationToken cancellationToken)
    {
        var (items, totalCount) = await _stockItemRepository.SearchAsync(
            searchTerm: null,
            warehouseId: request.WarehouseId,
            lowStockOnly: request.LowStockOnly,
            outOfStockOnly: request.OutOfStockOnly,
            page: request.Page,
            pageSize: request.PageSize,
            cancellationToken: cancellationToken);

        // Get warehouses and products for the items to fill in names
        var warehouseIds = items.Select(i => i.WarehouseId).Distinct().ToList();
        var productIds = items.Select(i => i.ProductId).Distinct().ToList();

        var warehouses = await _warehouseRepository.GetActiveWarehousesAsync(cancellationToken);
        var warehouseDict = warehouses.ToDictionary(w => w.Id);

        // Chargements EN LOT : un aller-retour chacun, quelle que soit la taille de la page.
        var productDict = await _productRepository.GetByIdsAsync(productIds, cancellationToken);
        var valuations = await _valuationReader.GetByStockItemIdsAsync(
            items.Select(i => i.Id).ToList(), cancellationToken);

        var dtos = items.Select(item =>
        {
            warehouseDict.TryGetValue(item.WarehouseId, out var warehouse);
            productDict.TryGetValue(item.ProductId, out var product);
            valuations.TryGetValue(item.Id, out var valuation);
            var cost = valuation?.Cost;

            return new StockItemDto(
                item.Id,
                item.ProductId,
                product?.Code ?? "N/A",
                product?.Name ?? "N/A",
                item.WarehouseId,
                warehouse?.Code ?? "N/A",
                warehouse?.Name ?? "N/A",
                item.QuantityOnHand,
                item.QuantityAvailable,
                item.QuantityReserved,
                item.MinimumStock,
                item.MaximumStock,
                item.AverageCost,
                // Valeur et coût affiché viennent de la valorisation, pas du cache. Sans lecture
                // (article absent du jeu), on retombe exactement sur le comportement d'avant.
                cost?.StockValue ?? item.StockValue,
                item.IsLowStock,
                item.QuantityOnHand == 0,
                product?.CostingMethod ?? CostingMethod.Average,
                cost?.UnitCost ?? item.AverageCost,
                cost?.UnitCostIsNextExit ?? false,
                cost?.HasLayers ?? false);
        }).ToList();

        var totalStockValue = await _valuationReader.GetTotalStockValueAsync(
            request.WarehouseId, cancellationToken);

        return new StockItemsResult(dtos, totalCount, request.Page, request.PageSize, totalStockValue);
    }
}
