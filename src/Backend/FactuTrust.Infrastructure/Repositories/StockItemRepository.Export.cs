using FactuTrust.Application.Features.DataExports;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class StockItemRepository
{
    public async Task<CountedRows<StockPositionExportRow>> ListForExportAsync(
        string? searchTerm,
        Guid? warehouseId,
        bool lowStockOnly,
        bool outOfStockOnly,
        bool inStockOnly,
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query =
            from stock in context.StockItems.AsNoTracking()
            join product in context.Products.AsNoTracking() on stock.ProductId equals product.Id
            join warehouse in context.Warehouses.AsNoTracking() on stock.WarehouseId equals warehouse.Id
            where stock.IsActive
            select new { stock, product, warehouse };

        if (warehouseId.HasValue)
            query = query.Where(row => row.stock.WarehouseId == warehouseId.Value);

        if (lowStockOnly)
            query = query.Where(row => row.stock.QuantityOnHand <= row.stock.MinimumStock && row.stock.QuantityOnHand > 0);

        if (outOfStockOnly)
            query = query.Where(row => row.stock.QuantityOnHand == 0);

        if (inStockOnly)
            query = query.Where(row => row.stock.QuantityOnHand > row.stock.MinimumStock);

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(row => row.product.Name.Contains(term) || row.product.Code.Contains(term));
        }

        var count = await query.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<StockPositionExportRow>.Over(count);

        var rows = await query
            .OrderBy(row => row.product.Code)
            .ThenBy(row => row.warehouse.Name)
            .Select(row => new StockPositionExportRow(
                row.stock.Id,
                row.product.Code,
                row.product.Name,
                row.warehouse.Name,
                row.stock.QuantityOnHand,
                row.stock.QuantityReserved,
                row.stock.MinimumStock,
                row.stock.MaximumStock,
                row.stock.AverageCost))
            .ToListAsync(cancellationToken);

        return CountedRows<StockPositionExportRow>.Ready(rows);
    }
}
