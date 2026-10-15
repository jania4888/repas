using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Products;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Products.Queries;

/// <summary>
/// Query to get product details by ID.
/// </summary>
public sealed record GetProductByIdQuery(Guid Id) : IRequest<Result<ProductDetailDto>>;

/// <summary>
/// Handler for GetProductByIdQuery.
/// </summary>
public sealed class GetProductByIdQueryHandler : IRequestHandler<GetProductByIdQuery, Result<ProductDetailDto>>
{
    private readonly IProductRepository _productRepository;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IStockItemRepository _stockItemRepository;
    private readonly IStockValuationReader _valuationReader;

    public GetProductByIdQueryHandler(
        IProductRepository productRepository,
        IWarehouseRepository warehouseRepository,
        IStockItemRepository stockItemRepository,
        IStockValuationReader valuationReader)
    {
        _productRepository = productRepository;
        _warehouseRepository = warehouseRepository;
        _stockItemRepository = stockItemRepository;
        _valuationReader = valuationReader;
    }

    public async Task<Result<ProductDetailDto>> Handle(GetProductByIdQuery request, CancellationToken cancellationToken)
    {
        var product = await _productRepository.GetByIdAsync(request.Id, cancellationToken);
        if (product is null)
            return Result.Failure<ProductDetailDto>(Error.NotFound("Product", request.Id));

        decimal? weightedAverageCost = null;
        decimal? minimumStock = null;
        var displayedUnitCostIsNextExit = false;
        if (product.IsStockManaged)
        {
            // Entrepôt par défaut uniquement — comportement existant, assumé : les couches vivent
            // par article de stock, donc par entrepôt. Le libellé de l'écran le dit déjà.
            var defaultWarehouse = await _warehouseRepository.GetDefaultAsync(cancellationToken);
            if (defaultWarehouse is not null)
            {
                var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                    product.Id,
                    defaultWarehouse.Id,
                    cancellationToken);
                minimumStock = stockItem?.MinimumStock;

                var valuation = await _valuationReader.GetByProductAndWarehouseAsync(
                    product.Id,
                    defaultWarehouse.Id,
                    cancellationToken);
                // Le coût affiché suit la méthode de l'article ; sans valorisation lisible, on
                // retombe sur le cache, c'est-à-dire sur le comportement d'avant.
                weightedAverageCost = valuation?.Cost.UnitCost ?? stockItem?.AverageCost;
                displayedUnitCostIsNextExit = valuation?.Cost.UnitCostIsNextExit ?? false;
            }
        }

        return Result.Success(ProductDetailMapper.ToDetailDto(
            product, weightedAverageCost, minimumStock, displayedUnitCostIsNextExit));
    }
}
