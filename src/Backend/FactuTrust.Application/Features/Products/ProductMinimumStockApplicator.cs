using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Features.Products;

/// <summary>
/// Applies an optional minimum-stock threshold on the default warehouse <see cref="StockItem"/>.
/// </summary>
internal static class ProductMinimumStockApplicator
{
    public static async Task<Result> ApplyAsync(
        IStockItemRepository stockItemRepository,
        IWarehouseRepository warehouseRepository,
        Guid productId,
        bool isStockManaged,
        decimal? minimumStock,
        CancellationToken cancellationToken)
    {
        if (!isStockManaged || minimumStock is null)
            return Result.Success();

        if (minimumStock < 0)
            return Result.Failure(Error.Validation("MinimumStock", "Le stock minimum ne peut pas être négatif"));

        var warehouse = await warehouseRepository.GetDefaultAsync(cancellationToken);
        if (warehouse is null)
            return Result.Success();

        var stockItem = await stockItemRepository.GetByProductAndWarehouseAsync(
            productId, warehouse.Id, cancellationToken);

        if (stockItem is null)
        {
            var created = StockItem.Create(productId, warehouse.Id, minimumStock.Value);
            if (created.IsFailure)
                return Result.Failure(created.Error);

            await stockItemRepository.AddAsync(created.Value, cancellationToken);
            return Result.Success();
        }

        var update = stockItem.UpdateThresholds(minimumStock.Value, stockItem.MaximumStock);
        return update.IsFailure ? Result.Failure(update.Error) : Result.Success();
    }
}
