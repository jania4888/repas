using FactuTrust.Application.Common.Interfaces.Repositories;
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

    public GetProductByIdQueryHandler(
        IProductRepository productRepository,
        IWarehouseRepository warehouseRepository,
        IStockItemRepository stockItemRepository)
    {
        _productRepository = productRepository;
        _warehouseRepository = warehouseRepository;
        _stockItemRepository = stockItemRepository;
    }

    public async Task<Result<ProductDetailDto>> Handle(GetProductByIdQuery request, CancellationToken cancellationToken)
    {
        var product = await _productRepository.GetByIdAsync(request.Id, cancellationToken);
        if (product is null)
            return Result.Failure<ProductDetailDto>(Error.NotFound("Product", request.Id));

        decimal? weightedAverageCost = null;
        decimal? minimumStock = null;
        if (product.IsStockManaged)
        {
            var defaultWarehouse = await _warehouseRepository.GetDefaultAsync(cancellationToken);
            if (defaultWarehouse is not null)
            {
                var stockItem = await _stockItemRepository.GetByProductAndWarehouseAsync(
                    product.Id,
                    defaultWarehouse.Id,
                    cancellationToken);
                weightedAverageCost = stockItem?.AverageCost;
                minimumStock = stockItem?.MinimumStock;
            }
        }

        return Result.Success(ProductDetailMapper.ToDetailDto(product, weightedAverageCost, minimumStock));
    }
}
