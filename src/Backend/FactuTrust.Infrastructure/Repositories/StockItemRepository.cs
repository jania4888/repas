using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using StockStatusReportConstants = FactuTrust.Application.Features.Reports.StockStatusReportConstants;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for StockItem aggregate.
/// </summary>
public sealed class StockItemRepository : IStockItemRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public StockItemRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<StockItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
    }

    public async Task<StockItem?> GetByProductAndWarehouseAsync(
        Guid productId,
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .FirstOrDefaultAsync(s => s.ProductId == productId && s.WarehouseId == warehouseId, cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByProductAsync(
        Guid productId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.ProductId == productId)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByWarehouseAsync(
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.WarehouseId == warehouseId && s.IsActive)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetByWarehouseForInventoryAsync(
        Guid warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.WarehouseId == warehouseId)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetLowStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.StockItems
            .Where(s => s.IsActive && s.QuantityOnHand <= s.MinimumStock && s.QuantityOnHand > 0);

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockItem>> GetOutOfStockItemsAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.StockItems
            .Where(s => s.IsActive && s.QuantityOnHand == 0);

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<StockItem?> GetWithMovementsAsync(
        Guid stockItemId,
        int movementLimit = 50,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Get stock item with recent movements
        var stockItem = await context.StockItems
            .Include(s => s.Movements.OrderByDescending(m => m.OccurredAt).Take(movementLimit))
            .FirstOrDefaultAsync(s => s.Id == stockItemId, cancellationToken);

        return stockItem;
    }

    public async Task<(IReadOnlyList<StockItem> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        Guid? warehouseId,
        bool? lowStockOnly,
        bool? outOfStockOnly,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.StockItems
            .Where(s => s.IsActive)
            .AsQueryable();

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        if (lowStockOnly == true)
            query = query.Where(s => s.QuantityOnHand <= s.MinimumStock && s.QuantityOnHand > 0);

        if (outOfStockOnly == true)
            query = query.Where(s => s.QuantityOnHand == 0);

        // Note: searchTerm would need to join with Products table for product name search
        // This is a simplified implementation

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(s => s.ProductId)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<decimal> GetTotalStockValueAsync(
        Guid? warehouseId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.StockItems.Where(s => s.IsActive);

        if (warehouseId.HasValue)
            query = query.Where(s => s.WarehouseId == warehouseId.Value);

        return await query.SumAsync(s => s.QuantityOnHand * s.AverageCost, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, decimal>> GetAvailableQuantityByProductIdsAsync(
        Guid warehouseId,
        IReadOnlyList<Guid> productIds,
        CancellationToken cancellationToken = default)
    {
        if (productIds.Count == 0)
            return new Dictionary<Guid, decimal>();

        await using var context = _contextFactory.CreateContext();

        var rows = await context.StockItems
            .AsNoTracking()
            .Where(s => s.WarehouseId == warehouseId && s.IsActive && productIds.Contains(s.ProductId))
            .Select(s => new { s.ProductId, Available = s.QuantityOnHand - s.QuantityReserved })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(r => r.ProductId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Available));
    }

    public async Task<IReadOnlyList<StockItem>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems
            .Where(s => s.IsActive)
            .ToListAsync(cancellationToken);
    }

    public async Task<StockItem> AddAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StockItems.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Fetch existing stock item from DB to get tracked entity
        var existingItem = await context.StockItems
            .Include(s => s.Movements)
            .FirstOrDefaultAsync(s => s.Id == entity.Id, cancellationToken);
        
        if (existingItem == null)
        {
            throw new InvalidOperationException($"StockItem with Id {entity.Id} not found for update.");
        }
        
        // Update scalar properties from the passed entity
        context.Entry(existingItem).CurrentValues.SetValues(entity);
        
        // Handle new movements (those not in existing movements)
        var existingMovementIds = existingItem.Movements.Select(m => m.Id).ToHashSet();
        foreach (var movement in entity.Movements)
        {
            if (!existingMovementIds.Contains(movement.Id))
            {
                // New movement - add directly to the context
                context.StockMovements.Add(movement);
            }
        }
        
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(StockItem entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // Attach the entity before removing - entity may be from a different context
        context.StockItems.Attach(entity);
        context.StockItems.Remove(entity);
        
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockItems.AnyAsync(s => s.Id == id, cancellationToken);
    }

    public async Task<int> CountStockStatusReportRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        CancellationToken cancellationToken = default)
    {
        var rows = await BuildStockStatusRowsAsync(
            warehouseId, categoryId, search, includeZeroStock, cancellationToken);
        return rows.Count;
    }

    public async Task<(IReadOnlyList<StockStatusReportRowDto> Items, int TotalCount)> GetStockStatusReportRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        StockStatusGroupingMode groupingMode,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var rows = await BuildStockStatusRowsAsync(
            warehouseId, categoryId, search, includeZeroStock, cancellationToken);
        rows = SortStockStatusRows(rows, groupingMode);

        var totalCount = rows.Count;
        var paged = rows
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToList();

        return (paged, totalCount);
    }

    private async Task<List<StockStatusReportRowDto>> BuildStockStatusRowsAsync(
        Guid? warehouseId,
        Guid? categoryId,
        string? search,
        bool includeZeroStock,
        CancellationToken cancellationToken)
    {
        await using var context = _contextFactory.CreateContext();

        var query =
            from s in context.StockItems.AsNoTracking()
            join p in context.Products.AsNoTracking() on s.ProductId equals p.Id
            join w in context.Warehouses.AsNoTracking() on s.WarehouseId equals w.Id
            join c in context.ProductCategories.AsNoTracking() on p.CategoryId equals c.Id into categoryJoin
            from c in categoryJoin.DefaultIfEmpty()
            where s.IsActive && p.IsActive && p.IsStockManaged && w.IsActive
            select new { s, p, w, c };

        if (warehouseId.HasValue)
            query = query.Where(x => x.s.WarehouseId == warehouseId.Value);

        if (categoryId.HasValue)
            query = query.Where(x => x.p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(x =>
                EF.Functions.Like(x.p.Name, $"%{term}%") ||
                EF.Functions.Like(x.p.Code, $"%{term}%"));
        }

        if (!includeZeroStock)
            query = query.Where(x => x.s.QuantityOnHand > 0);

        var fromStockItems = await query
            .Select(x => new StockStatusReportRowDto
            {
                ProductId = x.p.Id,
                ProductCode = x.p.Code,
                ProductName = x.p.Name,
                CategoryId = x.p.CategoryId,
                CategoryName = x.c != null ? x.c.Name : StockStatusReportConstants.UncategorizedLabel,
                WarehouseId = x.w.Id,
                WarehouseCode = x.w.Code,
                WarehouseName = x.w.Name,
                QuantityOnHand = x.s.QuantityOnHand,
                UnitCost = x.s.AverageCost,
                StockValue = x.s.QuantityOnHand * x.s.AverageCost
            })
            .ToListAsync(cancellationToken);

        if (!includeZeroStock || !warehouseId.HasValue)
            return fromStockItems;

        var warehouse = await context.Warehouses.AsNoTracking()
            .FirstOrDefaultAsync(w => w.Id == warehouseId.Value && w.IsActive, cancellationToken);
        if (warehouse is null)
            return fromStockItems;

        var existingProductIds = fromStockItems.Select(r => r.ProductId).ToHashSet();

        var missingProductsQuery =
            from p in context.Products.AsNoTracking()
            join c in context.ProductCategories.AsNoTracking() on p.CategoryId equals c.Id into categoryJoin
            from c in categoryJoin.DefaultIfEmpty()
            where p.IsActive && p.IsStockManaged
                  && !existingProductIds.Contains(p.Id)
                  && !context.StockItems.Any(s =>
                      s.IsActive && s.ProductId == p.Id && s.WarehouseId == warehouse.Id)
            select new { p, c };

        if (categoryId.HasValue)
            missingProductsQuery = missingProductsQuery.Where(x => x.p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            missingProductsQuery = missingProductsQuery.Where(x =>
                EF.Functions.Like(x.p.Name, $"%{term}%") ||
                EF.Functions.Like(x.p.Code, $"%{term}%"));
        }

        var missingRows = await missingProductsQuery
            .Select(x => new StockStatusReportRowDto
            {
                ProductId = x.p.Id,
                ProductCode = x.p.Code,
                ProductName = x.p.Name,
                CategoryId = x.p.CategoryId,
                CategoryName = x.c != null ? x.c.Name : StockStatusReportConstants.UncategorizedLabel,
                WarehouseId = warehouse.Id,
                WarehouseCode = warehouse.Code,
                WarehouseName = warehouse.Name,
                QuantityOnHand = 0,
                UnitCost = 0,
                StockValue = 0
            })
            .ToListAsync(cancellationToken);
        fromStockItems.AddRange(missingRows);
        return fromStockItems;
    }

    private static List<StockStatusReportRowDto> SortStockStatusRows(
        List<StockStatusReportRowDto> rows,
        StockStatusGroupingMode groupingMode)
    {
        return groupingMode == StockStatusGroupingMode.CategoryThenWarehouse
            ? rows.OrderBy(r => r.CategoryName)
                .ThenBy(r => r.WarehouseName)
                .ThenBy(r => r.ProductCode)
                .ToList()
            : rows.OrderBy(r => r.WarehouseName)
                .ThenBy(r => r.CategoryName)
                .ThenBy(r => r.ProductCode)
                .ToList();
    }
}
