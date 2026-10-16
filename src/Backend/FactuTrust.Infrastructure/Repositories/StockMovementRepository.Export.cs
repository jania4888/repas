using FactuTrust.Application.Features.DataExports;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed partial class StockMovementRepository
{
    public async Task<CountedRows<StockMovementExportRow>> ListForExportAsync(
        Guid? warehouseId,
        DateTime? fromDate,
        DateTime? toDate,
        int maxRows,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query =
            from movement in context.StockMovements.AsNoTracking()
            join stock in context.StockItems.AsNoTracking() on movement.StockItemId equals stock.Id
            join product in context.Products.AsNoTracking() on stock.ProductId equals product.Id
            join warehouse in context.Warehouses.AsNoTracking() on stock.WarehouseId equals warehouse.Id
            select new { movement, stock, product, warehouse };

        if (warehouseId.HasValue)
            query = query.Where(row => row.stock.WarehouseId == warehouseId.Value);
        if (fromDate.HasValue)
            query = query.Where(row => row.movement.OccurredAt >= fromDate.Value);
        if (toDate.HasValue)
            query = query.Where(row => row.movement.OccurredAt <= toDate.Value);

        var count = await query.CountAsync(cancellationToken);
        if (count > maxRows)
            return CountedRows<StockMovementExportRow>.Over(count);

        var rows = await query
            .OrderByDescending(row => row.movement.OccurredAt)
            .Select(row => new StockMovementExportRow(
                row.movement.Id,
                row.movement.OccurredAt,
                row.product.Code,
                row.product.Name,
                row.warehouse.Name,
                row.movement.Type,
                row.movement.Reason,
                row.movement.Quantity,
                row.movement.UnitCost,
                row.movement.BalanceAfter,
                row.movement.Reference))
            .ToListAsync(cancellationToken);

        return CountedRows<StockMovementExportRow>.Ready(rows);
    }
}
