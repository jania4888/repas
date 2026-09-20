using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for PurchaseOrder aggregate.
/// </summary>
public sealed class PurchaseOrderRepository : IPurchaseOrderRepository
{
    private readonly TenantDbContextFactory _contextFactory;

    public PurchaseOrderRepository(TenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<PurchaseOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders
            .Include(po => po.Supplier)
            .FirstOrDefaultAsync(po => po.Id == id, cancellationToken);
    }

    public async Task<PurchaseOrder?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders
            .Include(po => po.Supplier)
            .Include(po => po.Warehouse)
            .Include(po => po.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(po => po.Id == id, cancellationToken);
    }

    public async Task<string?> GetLatestNumberAsync(int year, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders
            .Where(po => EF.Property<int>(po.Number, "Year") == year)
            .OrderByDescending(po => EF.Property<int>(po.Number, "Sequence"))
            .Select(po => EF.Property<string>(po.Number, "Value"))
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PurchaseOrder>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders
            .Include(po => po.Supplier)
            .OrderByDescending(po => po.OrderDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<PurchaseOrder> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyPurchaseOrderFilters(
            context.PurchaseOrders
                .Include(po => po.Supplier)
                .Include(po => po.Warehouse)
                .Include(po => po.Lines)
                .AsQueryable(),
            searchTerm, status, supplierId, fromDate, toDate);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(po => po.OrderDate)
            .ThenByDescending(po => po.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the purchase order list filters. Single source of truth shared by
    /// <see cref="SearchAsync"/> and <see cref="GetSummaryAsync"/> (no drift between list and totals).
    /// </summary>
    private static IQueryable<PurchaseOrder> ApplyPurchaseOrderFilters(
        IQueryable<PurchaseOrder> query,
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(po =>
                EF.Property<string>(po.Number, "Value").Contains(term) ||
                po.Supplier.Name.Contains(term) ||
                (po.Reference != null && po.Reference.Contains(term)));
        }

        if (status.HasValue)
            query = query.Where(po => po.Status == status.Value);

        if (supplierId.HasValue)
            query = query.Where(po => po.SupplierId == supplierId.Value);

        if (fromDate.HasValue)
            query = query.Where(po => po.OrderDate >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(po => po.OrderDate <= toDate.Value);

        return query;
    }

    public async Task<PurchaseOrderListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        PurchaseOrderStatus? status,
        Guid? supplierId,
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplyPurchaseOrderFilters(
            context.PurchaseOrders.AsNoTracking(),
            searchTerm, status, supplierId, fromDate, toDate);

        var rows = await filtered
            .Select(po => new
            {
                Ttc = po.TotalAmount.Amount,
                Ht = po.SubTotal.Amount,
                Vat = po.TotalVat.Amount,
                po.Status,
                Currency = po.TotalAmount.Currency
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return new PurchaseOrderListSummaryDto { Currency = "TND" };

        decimal totalTtc = 0m, totalHt = 0m, totalVat = 0m;
        var receivedCount = 0;
        var pendingCount = 0;

        foreach (var r in rows)
        {
            totalTtc += r.Ttc;
            totalHt += r.Ht;
            totalVat += r.Vat;
            if (r.Status == PurchaseOrderStatus.Received)
                receivedCount++;
            else if (r.Status == PurchaseOrderStatus.Confirmed || r.Status == PurchaseOrderStatus.PartiallyReceived)
                pendingCount++;
        }

        return new PurchaseOrderListSummaryDto
        {
            Count = rows.Count,
            TotalTtc = Math.Round(totalTtc, 3),
            TotalHt = Math.Round(totalHt, 3),
            TotalVat = Math.Round(totalVat, 3),
            ReceivedCount = receivedCount,
            PendingCount = pendingCount,
            Currency = rows[0].Currency
        };
    }

    public async Task<IReadOnlyList<PurchaseOrder>> GetPendingOrdersAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders
            .Include(po => po.Supplier)
            .Where(po => po.Status == PurchaseOrderStatus.Confirmed ||
                         po.Status == PurchaseOrderStatus.PartiallyReceived)
            .OrderBy(po => po.ExpectedDeliveryDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> TryConfirmDraftAsync(Guid id, DateTime confirmedAt, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var affectedRows = await context.PurchaseOrders
            .Where(po => po.Id == id && po.Status == PurchaseOrderStatus.Draft)
            .Where(po => po.Lines.Any())
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(po => po.Status, PurchaseOrderStatus.Confirmed)
                .SetProperty(po => po.ConfirmedAt, confirmedAt)
                .SetProperty(po => po.UpdatedAt, DateTime.UtcNow), cancellationToken);

        return affectedRows == 1;
    }

    public async Task<PurchaseOrder> AddAsync(PurchaseOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        
        // CRITICAL: Ensure referenced Supplier entity is properly tracked in this context BEFORE adding the purchase order.
        // The Supplier is loaded from a different context (via SupplierRepository) and needs to be properly handled
        // to avoid EF Core trying to insert it as a new entity or causing tracking conflicts with owned entities.
        if (entity.Supplier != null)
        {
            // Check if a Supplier with this ID is already tracked in the ChangeTracker
            var trackedSupplier = context.ChangeTracker.Entries<Supplier>()
                .FirstOrDefault(e => e.Entity.Id == entity.Supplier.Id)?.Entity;
            
            if (trackedSupplier != null)
            {
                // An instance with this ID is already tracked, replace the reference to use the tracked instance
                // This avoids tracking conflicts when adding the purchase order
                var supplierProperty = typeof(PurchaseOrder).GetProperty("Supplier",
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
                if (supplierProperty != null && supplierProperty.CanWrite)
                {
                    supplierProperty.SetValue(entity, trackedSupplier);
                }
            }
            else
            {
                // Supplier is not tracked in this context, attach it as Unchanged
                // This tells EF Core that the entity already exists in the database
                // and prevents it from trying to insert it or causing tracking conflicts
                context.Suppliers.Attach(entity.Supplier);
                context.Entry(entity.Supplier).State = EntityState.Unchanged;
            }
        }
        
        // CRITICAL: Ensure referenced Product entities (and their ProductCategory) are properly tracked
        // in this context BEFORE adding the purchase order. Products loaded from a different context
        // (via ProductRepository) may each have their own Category instance for the same Id; attaching
        // them without unifying Category would cause "another instance with the same key value for {'Id'}
        // is already being tracked" (ProductCategory).
        foreach (var line in entity.Lines)
        {
            if (line.Product != null)
            {
                EnsureProductCategoryTrackedOnce(context, line.Product);

                var trackedProduct = context.ChangeTracker.Entries<Product>()
                    .FirstOrDefault(e => e.Entity.Id == line.Product.Id)?.Entity;

                if (trackedProduct != null)
                {
                    var productProperty = typeof(PurchaseOrderLine).GetProperty("Product",
                        BindingFlags.Public | BindingFlags.Instance);
                    if (productProperty != null && productProperty.CanWrite)
                    {
                        productProperty.SetValue(line, trackedProduct);
                    }
                }
                else
                {
                    context.Products.Attach(line.Product);
                    context.Entry(line.Product).State = EntityState.Unchanged;
                }
            }
        }
        
        // Add the purchase order entity to the context.
        // EF Core will automatically track all related entities including:
        // - All PurchaseOrderLine entities in the Lines collection (via HasMany/WithOne relationship)
        // - All owned Money entities within each PurchaseOrderLine (UnitPrice, SubTotal, VatAmount, Total)
        // - All owned Money entities within the PurchaseOrder (SubTotal, TotalVat, TotalAmount)
        //
        // The owned entities are configured via OwnsOne() in TenantDbContext.ConfigurePurchaseOrderLine()
        // and will be automatically persisted when the owner (PurchaseOrderLine) is saved.
        context.PurchaseOrders.Add(entity);
        
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(PurchaseOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.PurchaseOrders.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(PurchaseOrder entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.PurchaseOrders.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders.AnyAsync(po => po.Id == id, cancellationToken);
    }

    /// <summary>
    /// Ensures only one instance of a given ProductCategory is tracked when attaching products.
    /// Products loaded from different contexts may each have their own Category instance for the same Id;
    /// attaching them without this would cause InvalidOperationException (duplicate key tracking).
    /// </summary>
    private static void EnsureProductCategoryTrackedOnce(DbContext context, Product product)
    {
        if (product.Category == null) return;

        var trackedCategory = context.ChangeTracker.Entries<ProductCategory>()
            .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

        if (trackedCategory != null)
        {
            var categoryProp = typeof(Product).GetProperty(
                nameof(Product.Category),
                BindingFlags.Public | BindingFlags.Instance);
            categoryProp?.SetValue(product, trackedCategory);
        }
    }
}
