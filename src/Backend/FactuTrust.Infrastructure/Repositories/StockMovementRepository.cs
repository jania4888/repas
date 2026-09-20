using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for StockMovement entity.
/// </summary>
public sealed class StockMovementRepository : IStockMovementRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public StockMovementRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<StockMovement?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockMovements
            .FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
    }

    public async Task<(IReadOnlyList<StockMovement> Items, int TotalCount)> GetByStockItemAsync(
        Guid stockItemId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.StockMovements
            .Where(m => m.StockItemId == stockItemId);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(m => m.OccurredAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyList<StockMovement>> GetByProductAsync(
        Guid productId,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Get all stock items for this product
        var stockItemIds = await context.StockItems
            .Where(s => s.ProductId == productId)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken);

        var query = context.StockMovements
            .Where(m => stockItemIds.Contains(m.StockItemId));

        if (fromDate.HasValue)
            query = query.Where(m => m.OccurredAt >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(m => m.OccurredAt <= toDate.Value);

        return await query
            .OrderByDescending(m => m.OccurredAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<StockMovement> Items, int TotalCount)> SearchAsync(
        Guid? stockItemId,
        MovementType? type,
        MovementReason? reason,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.StockMovements.AsQueryable();

        if (stockItemId.HasValue)
            query = query.Where(m => m.StockItemId == stockItemId.Value);

        if (type.HasValue)
            query = query.Where(m => m.Type == type.Value);

        if (reason.HasValue)
            query = query.Where(m => m.Reason == reason.Value);

        if (fromDate.HasValue)
            query = query.Where(m => m.OccurredAt >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(m => m.OccurredAt <= toDate.Value);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(m => m.OccurredAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyList<StockMovement>> GetByReferenceAsync(
        string reference,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockMovements
            .Where(m => m.Reference == reference)
            .OrderByDescending(m => m.OccurredAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<StockExitMovementCostRowDto>> GetExitMovementsCostByReferencesAsync(
        IReadOnlyList<string> references,
        MovementReason reason,
        CancellationToken cancellationToken = default)
    {
        if (references is null || references.Count == 0)
            return Array.Empty<StockExitMovementCostRowDto>();

        await using var context = _contextFactory.CreateContext();

        // We only need exit quantities/costs mapped to product identifiers for report computations.
        var rows = await context.StockMovements
            .Where(m => references.Contains(m.Reference) && m.Reason == reason && m.Type == MovementType.Exit)
            .Join(
                context.StockItems,
                m => m.StockItemId,
                si => si.Id,
                (m, si) => new { m, si })
            .Select(x => new StockExitMovementCostRowDto
            {
                Reference = x.m.Reference!,
                ProductId = x.si.ProductId,
                ExitQuantity = -x.m.Quantity, // exits are recorded with negative quantity
                UnitCost = x.m.UnitCost
            })
            .ToListAsync(cancellationToken);

        return rows;
    }

    public async Task<IReadOnlyList<StockMovement>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockMovements
            .OrderByDescending(m => m.OccurredAt)
            .Take(1000) // Limit to prevent large result sets
            .ToListAsync(cancellationToken);
    }

    public async Task<StockMovement> AddAsync(StockMovement entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.StockMovements.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(StockMovement entity, CancellationToken cancellationToken = default)
    {
        // StockMovements are immutable, but we implement this for interface compliance
        await using var context = _contextFactory.CreateContext();
        context.StockMovements.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(StockMovement entity, CancellationToken cancellationToken = default)
    {
        // StockMovements should not be deleted in normal operations (audit trail)
        await using var context = _contextFactory.CreateContext();
        context.StockMovements.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.StockMovements.AnyAsync(m => m.Id == id, cancellationToken);
    }

    public async Task<(IReadOnlyList<StockMovementReportRowDto> Items, int TotalCount)> GetReportPageAsync(
        Guid? warehouseId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = from m in context.StockMovements
                    join si in context.StockItems on m.StockItemId equals si.Id
                    join p in context.Products on si.ProductId equals p.Id
                    join w in context.Warehouses on si.WarehouseId equals w.Id
                    select new { m, si, ProductName = p.Name, ProductCode = p.Code, WarehouseName = w.Name };

        if (warehouseId.HasValue)
            query = query.Where(x => x.si.WarehouseId == warehouseId.Value);
        if (fromDate.HasValue)
            query = query.Where(x => x.m.OccurredAt >= fromDate.Value);
        if (toDate.HasValue)
            query = query.Where(x => x.m.OccurredAt <= toDate.Value);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(x => x.m.OccurredAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var dtos = items.Select(x => new StockMovementReportRowDto
        {
            Id = x.m.Id,
            ProductName = x.ProductName,
            ProductCode = x.ProductCode,
            WarehouseName = x.WarehouseName,
            TypeDisplay = x.m.Type == MovementType.Entry ? "Entrée" : x.m.Type == MovementType.Exit ? "Sortie" : "Ajustement",
            ReasonDisplay = GetReasonLabel(x.m.Reason),
            Quantity = x.m.Quantity,
            UnitCost = x.m.UnitCost,
            Reference = x.m.Reference,
            OccurredAt = x.m.OccurredAt
        }).ToList();

        return (dtos, totalCount);
    }

    public async Task<IReadOnlyList<StockSnapshotRowDto>> GetStockSnapshotAtDateAsync(
        DateTime asOfEndOfDayUtc,
        Guid? warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // EF Core cannot translate GroupBy(...).Select(g => g.OrderBy(...).First()).
        // Use Max(OccurredAt) per stock item, then Max(Id) to break ties on the same timestamp.
        var latestOccurredQuery =
            from m in context.StockMovements
            where m.OccurredAt <= asOfEndOfDayUtc
            group m by m.StockItemId into g
            select new { StockItemId = g.Key, MaxOccurredAt = g.Max(x => x.OccurredAt) };

        var latestMovementIdQuery =
            from k in latestOccurredQuery
            join m in context.StockMovements on k.StockItemId equals m.StockItemId
            where m.OccurredAt == k.MaxOccurredAt
            group m by m.StockItemId into g
            select new { StockItemId = g.Key, MovementId = g.Max(x => x.Id) };

        var finalQuery =
            from li in latestMovementIdQuery
            join m in context.StockMovements on li.MovementId equals m.Id
            join si in context.StockItems on m.StockItemId equals si.Id
            join p in context.Products on si.ProductId equals p.Id
            join w in context.Warehouses on si.WarehouseId equals w.Id
            where !warehouseId.HasValue || si.WarehouseId == warehouseId.Value
            where m.BalanceAfter > 0
            orderby w.Name, p.Name
            select new StockSnapshotRowDto
            {
                ProductName = p.Name,
                ProductCode = p.Code,
                WarehouseName = w.Name,
                Quantity = m.BalanceAfter,
                UnitCost = m.UnitCost,
                TotalValue = m.BalanceAfter * m.UnitCost
            };

        return await finalQuery.ToListAsync(cancellationToken);
    }

    private static string GetReasonLabel(MovementReason reason)
    {
        return reason switch
        {
            MovementReason.Purchase => "Achat",
            MovementReason.Sale => "Vente",
            MovementReason.CustomerReturn => "Retour Client",
            MovementReason.SupplierReturn => "Retour Fournisseur",
            MovementReason.InventoryAdjustment => "Ajustement",
            MovementReason.Transfer => "Transfert",
            MovementReason.Damage => "Dommage/Perte",
            MovementReason.InitialStock => "Stock Initial",
            MovementReason.Delivery => "Livraison",
            MovementReason.InternalUse => "Consommation interne",
            MovementReason.GiftOrSample => "Don / échantillon",
            MovementReason.FoundOrOther => "Trouvé / autre",
            _ => reason.ToString()
        };
    }
}
