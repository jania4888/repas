using System.Data;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for PhysicalInventory aggregate.
/// </summary>
public sealed class PhysicalInventoryRepository : IPhysicalInventoryRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public PhysicalInventoryRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<PhysicalInventory?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public async Task<PhysicalInventory?> GetActiveAsync(Guid warehouseId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .Include(i => i.CountLines)
            .Where(i => i.WarehouseId == warehouseId && i.Status == InventoryStatus.InProgress)
            .OrderByDescending(i => i.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<PhysicalInventory?> GetWithLinesAsync(Guid inventoryId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .Include(i => i.CountLines)
            .FirstOrDefaultAsync(i => i.Id == inventoryId, cancellationToken);
    }

    public async Task<IReadOnlyList<PhysicalInventory>> GetRecentAsync(
        Guid warehouseId, 
        int limit = 10, 
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .Where(i => i.WarehouseId == warehouseId && i.Status != InventoryStatus.InProgress)
            .OrderByDescending(i => i.CompletedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> HasActiveInventoryAsync(Guid warehouseId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .AnyAsync(i => i.WarehouseId == warehouseId && i.Status == InventoryStatus.InProgress, cancellationToken);
    }

    public async Task<IReadOnlyList<PhysicalInventory>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .OrderByDescending(i => i.StartedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<PhysicalInventory> AddAsync(PhysicalInventory entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.PhysicalInventories.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(PhysicalInventory entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var existingInventory = await context.PhysicalInventories
            .Include(i => i.CountLines)
            .FirstOrDefaultAsync(i => i.Id == entity.Id, cancellationToken);

        if (existingInventory == null)
        {
            throw new InvalidOperationException($"PhysicalInventory with Id {entity.Id} not found for update.");
        }

        // Update scalar properties
        context.Entry(existingInventory).CurrentValues.SetValues(entity);

        // Update count lines
        foreach (var line in entity.CountLines)
        {
            var existingLine = existingInventory.CountLines.FirstOrDefault(l => l.Id == line.Id);
            if (existingLine != null)
            {
                context.Entry(existingLine).CurrentValues.SetValues(line);
            }
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(PhysicalInventory entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.PhysicalInventories.Attach(entity);
        context.PhysicalInventories.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories.AnyAsync(i => i.Id == id, cancellationToken);
    }

    public async Task<(IReadOnlyList<PhysicalInventory> Items, int TotalCount)> SearchAsync(
        string? search,
        InventoryStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? warehouseId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyInventoryFilters(
            context.PhysicalInventories
                .Include(i => i.Warehouse)
                .Include(i => i.CountLines)
                .AsQueryable(),
            search, status, fromDate, toDate, warehouseId)
            .OrderByDescending(i => i.StartedAt);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the inventory list filters. Single source of truth shared by <see cref="SearchAsync"/>
    /// and <see cref="GetSummaryAsync"/> so the list and its totals zone can never diverge.
    /// </summary>
    private static IQueryable<PhysicalInventory> ApplyInventoryFilters(
        IQueryable<PhysicalInventory> query,
        string? search,
        InventoryStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? warehouseId)
    {
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(i => i.Reference.Contains(search));

        if (status.HasValue)
            query = query.Where(i => i.Status == status.Value);

        if (fromDate.HasValue)
            query = query.Where(i => i.StartedAt >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(i => i.StartedAt <= toDate.Value);

        if (warehouseId.HasValue)
            query = query.Where(i => i.WarehouseId == warehouseId.Value);

        return query;
    }

    public async Task<InventoryListSummaryDto> GetSummaryAsync(
        string? search,
        InventoryStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        Guid? warehouseId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // TotalProducts is computed from CountLines; project the line count per inventory in SQL.
        var rows = await ApplyInventoryFilters(
                context.PhysicalInventories.AsNoTracking(),
                search, status, fromDate, toDate, warehouseId)
            .Select(i => new { i.Status, ProductCount = i.CountLines.Count })
            .ToListAsync(cancellationToken);

        return new InventoryListSummaryDto
        {
            Count = rows.Count,
            InProgressCount = rows.Count(r => r.Status == InventoryStatus.InProgress),
            ValidatedCount = rows.Count(r => r.Status == InventoryStatus.Validated),
            CancelledCount = rows.Count(r => r.Status == InventoryStatus.Cancelled),
            TotalProducts = rows.Sum(r => r.ProductCount)
        };
    }

    /// <summary>
    /// Gets the next unique inventory reference (e.g. INVE-000001) atomically.
    /// Uses a single SQL MERGE statement so the increment is atomic and no duplicate references can occur under concurrency.
    /// Wrapped in the execution strategy for retries on transient failures.
    /// </summary>
    public async Task<string> GetNextReferenceAsync(CancellationToken cancellationToken = default)
    {
        await using var strategyContext = _contextFactory.CreateContext();
        var strategy = strategyContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync(async () =>
        {
            await using var context = _contextFactory.CreateContext();
            var year = DateTime.UtcNow.Year;
            var nextSeq = await GetNextSequenceValueAsync(context, year, cancellationToken);
            return $"INVE-{nextSeq:D6}";
        });
    }

    /// <summary>
    /// Atomically increments and returns the next sequence for the given year using a single MERGE statement.
    /// Prevents duplicate references under concurrent requests without relying on transaction isolation.
    /// </summary>
    private static async Task<int> GetNextSequenceValueAsync(DbContext context, int year, CancellationToken cancellationToken)
    {
        var connection = context.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync(cancellationToken);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            MERGE InventoryNumberSequences AS target
            USING (SELECT @year AS Year) AS src ON target.Year = src.Year
            WHEN NOT MATCHED BY TARGET THEN INSERT (Year, LastSequence) VALUES (@year, 1)
            WHEN MATCHED THEN UPDATE SET LastSequence = LastSequence + 1
            OUTPUT INSERTED.LastSequence;
            """;
        var yearParam = cmd.CreateParameter();
        yearParam.ParameterName = "@year";
        yearParam.Value = year;
        cmd.Parameters.Add(yearParam);

        var result = await cmd.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt32(result, System.Globalization.CultureInfo.InvariantCulture);
    }

    public async Task<PhysicalInventory?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PhysicalInventories
            .Include(i => i.Warehouse)
            .Include(i => i.CountLines)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }
}
