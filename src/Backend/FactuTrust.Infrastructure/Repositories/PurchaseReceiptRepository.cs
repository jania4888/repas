using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed class PurchaseReceiptRepository : IPurchaseReceiptRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public PurchaseReceiptRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<PurchaseReceipt?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .Include(r => r.Supplier)
            .Include(r => r.Warehouse)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
    }

    public async Task<PurchaseReceipt?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .Include(r => r.Supplier)
            .Include(r => r.Warehouse)
            .Include(r => r.PurchaseOrder)
            .Include(r => r.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
    }

    public async Task<PurchaseReceipt?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .Include(r => r.Supplier)
            .Include(r => r.Warehouse)
            .Include(r => r.PurchaseOrder)
            .Include(r => r.Lines)
                .ThenInclude(l => l.Product)
            .Include(r => r.Attachments)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<PurchaseReceipt>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .Include(r => r.Supplier)
            .OrderByDescending(r => r.ReceiptDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<PurchaseReceipt> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyFilters(
            context.PurchaseReceipts
                .Include(r => r.Supplier)
                .Include(r => r.Warehouse)
                .Include(r => r.PurchaseOrder)
                .Include(r => r.Lines)
                .AsQueryable(),
            searchTerm, status, supplierId, purchaseOrderId, fromDate, toDate);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(r => r.ReceiptDate)
            .ThenByDescending(r => r.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<PurchaseReceiptListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyFilters(
            context.PurchaseReceipts.AsQueryable(),
            searchTerm, status, supplierId, purchaseOrderId, fromDate, toDate);

        var count = await query.CountAsync(cancellationToken);
        var totalHt = await query.SumAsync(r => r.SubTotal.Amount, cancellationToken);
        var totalVat = await query.SumAsync(r => r.TotalVat.Amount, cancellationToken);
        var totalTtc = await query.SumAsync(r => r.TotalAmount.Amount, cancellationToken);
        var validatedCount = await query.CountAsync(r => r.Status == PurchaseReceiptStatus.Validated, cancellationToken);
        var draftCount = await query.CountAsync(r => r.Status == PurchaseReceiptStatus.Draft, cancellationToken);

        return new PurchaseReceiptListSummaryDto
        {
            Count = count,
            TotalHt = totalHt,
            TotalVat = totalVat,
            TotalTtc = totalTtc,
            ValidatedCount = validatedCount,
            DraftCount = draftCount,
            Currency = "TND"
        };
    }

    public async Task<IReadOnlyList<PurchaseReceipt>> GetByPurchaseOrderIdAsync(
        Guid purchaseOrderId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .Include(r => r.Lines)
            .Where(r => r.PurchaseOrderId == purchaseOrderId)
            .OrderByDescending(r => r.ReceiptDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ExistsNumberAsync(string number, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts
            .AnyAsync(r => r.Number.Value == number, cancellationToken);
    }

    public async Task<PurchaseReceipt> AddAsync(PurchaseReceipt entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        if (entity.Supplier != null)
            AttachUnchanged(context, entity.Supplier);

        if (entity.Warehouse != null)
            AttachUnchanged(context, entity.Warehouse);

        foreach (var line in entity.Lines)
        {
            if (line.Product != null)
            {
                EnsureProductCategoryTrackedOnce(context, line.Product);
                var tracked = context.ChangeTracker.Entries<Product>()
                    .FirstOrDefault(e => e.Entity.Id == line.Product.Id)?.Entity;
                if (tracked != null)
                {
                    typeof(PurchaseReceiptLine).GetProperty("Product", BindingFlags.Public | BindingFlags.Instance)
                        ?.SetValue(line, tracked);
                }
                else
                {
                    context.Products.Attach(line.Product);
                    context.Entry(line.Product).State = EntityState.Unchanged;
                }
            }
        }

        context.PurchaseReceipts.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(PurchaseReceipt entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var distinctProducts = entity.Lines
            .Where(l => l.Product != null)
            .Select(l => l.Product!)
            .GroupBy(p => p.Id)
            .Select(g => g.First())
            .ToList();

        // Step 1: pre-track distinct categories as Unchanged BEFORE products.
        // Must happen first: products that share a category would otherwise cause
        // EF Core to attempt tracking two C# instances for the same category Id
        // ("duplicate key" InvalidOperationException).
        foreach (var product in distinctProducts)
        {
            if (product.Category == null) continue;

            var alreadyTracked = context.ChangeTracker.Entries<ProductCategory>()
                .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

            if (alreadyTracked == null)
            {
                context.Entry(product.Category).State = EntityState.Unchanged;
            }
            else if (!ReferenceEquals(alreadyTracked, product.Category))
            {
                typeof(Product).GetProperty(nameof(Product.Category), BindingFlags.Public | BindingFlags.Instance)!
                    .SetValue(product, alreadyTracked);
            }
        }

        // Step 2: pre-track distinct products as Unchanged.
        foreach (var product in distinctProducts)
            context.Entry(product).State = EntityState.Unchanged;

        foreach (var line in entity.Lines)
        {
            if (line.Product == null) continue;

            var trackedProduct = context.ChangeTracker.Entries<Product>()
                .FirstOrDefault(e => e.Entity.Id == line.Product.Id)?.Entity;
            if (trackedProduct != null && !ReferenceEquals(trackedProduct, line.Product))
            {
                typeof(PurchaseReceiptLine).GetProperty(nameof(PurchaseReceiptLine.Product), BindingFlags.Public | BindingFlags.Instance)
                    ?.SetValue(line, trackedProduct);
            }
        }

        // Step 3: pre-track reference navigations as Unchanged.
        if (entity.Supplier != null)
            context.Entry(entity.Supplier).State = EntityState.Unchanged;
        if (entity.Warehouse != null)
            context.Entry(entity.Warehouse).State = EntityState.Unchanged;
        if (entity.PurchaseOrder != null)
            context.Entry(entity.PurchaseOrder).State = EntityState.Unchanged;

        var currentLineIds = entity.Lines.Select(l => l.Id).ToHashSet();
        var existingLineIds = await context.PurchaseReceiptLines
            .AsNoTracking()
            .Where(l => l.PurchaseReceiptId == entity.Id)
            .Select(l => l.Id)
            .ToListAsync(cancellationToken);

        var orphanIds = existingLineIds.Where(id => !currentLineIds.Contains(id)).ToList();
        if (orphanIds.Count > 0)
        {
            var orphans = await context.PurchaseReceiptLines
                .Where(l => orphanIds.Contains(l.Id))
                .ToListAsync(cancellationToken);
            context.PurchaseReceiptLines.RemoveRange(orphans);
        }

        // Snapshot before Attach: deleted orphans can be fixed back onto Lines by FK identity.
        var linesSnapshot = entity.Lines.ToList();

        // Step 4: attach the aggregate root, then mark only its own scalars as Modified.
        // Using context.Attach() instead of context.Update() avoids the recursive Modified
        // flood that context.Update() applies to the entire navigation graph.
        context.Attach(entity);
        context.Entry(entity).State = EntityState.Modified;
        SetOwnedNavigationsState(context, entity, EntityState.Modified);
        // Update path does not load attachments; do not treat the empty collection as a delete.
        context.Entry(entity).Collection(r => r.Attachments).IsLoaded = false;

        // Step 5: new lines (ClearLines + AddLine) are Added; kept lines stay Modified.
        // Attach() leaves OwnsOne Money (UnitPrice, SubTotal, …) Unchanged, so SQL INSERT
        // would omit those columns (NULL into UnitPrice). Mark owned navigations explicitly.
        foreach (var line in linesSnapshot)
        {
            var lineState = existingLineIds.Contains(line.Id)
                ? EntityState.Modified
                : EntityState.Added;
            context.Entry(line).State = lineState;
            SetOwnedNavigationsState(context, line, lineState);
            if (line.Product != null)
                context.Entry(line.Product).State = EntityState.Unchanged;
        }

        // Step 6: defensive reset — ensure all reference entities are still Unchanged.
        if (entity.Supplier != null)
            context.Entry(entity.Supplier).State = EntityState.Unchanged;
        if (entity.Warehouse != null)
            context.Entry(entity.Warehouse).State = EntityState.Unchanged;
        if (entity.PurchaseOrder != null)
            context.Entry(entity.PurchaseOrder).State = EntityState.Unchanged;
        foreach (var product in distinctProducts)
        {
            context.Entry(product).State = EntityState.Unchanged;
            if (product.Category != null)
                context.Entry(product.Category).State = EntityState.Unchanged;
        }

        // Attach() sets OriginalValue = CurrentValue, which breaks the Version concurrency token
        // after IncrementVersion() on a detached aggregate. Restore the store token.
        var dbVersion = await context.PurchaseReceipts
            .AsNoTracking()
            .Where(r => r.Id == entity.Id)
            .Select(r => (int?)r.Version)
            .SingleOrDefaultAsync(cancellationToken);

        if (dbVersion is not null)
            context.Entry(entity).Property(r => r.Version).OriginalValue = dbVersion.Value;

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(PurchaseReceipt entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.PurchaseReceipts.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseReceipts.AnyAsync(r => r.Id == id, cancellationToken);
    }

    private static IQueryable<PurchaseReceipt> ApplyFilters(
        IQueryable<PurchaseReceipt> query,
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(r =>
                r.Number.Value.Contains(term) ||
                r.Supplier.Name.Contains(term) ||
                (r.SupplierReference != null && r.SupplierReference.Contains(term)) ||
                (r.DeliveryNoteNumber != null && r.DeliveryNoteNumber.Contains(term)));
        }

        if (status.HasValue)
            query = query.Where(r => r.Status == status.Value);

        if (supplierId.HasValue)
            query = query.Where(r => r.SupplierId == supplierId.Value);

        if (purchaseOrderId.HasValue)
            query = query.Where(r => r.PurchaseOrderId == purchaseOrderId.Value);

        if (fromDate.HasValue)
            query = query.Where(r => r.ReceiptDate >= fromDate.Value.Date);

        if (toDate.HasValue)
            query = query.Where(r => r.ReceiptDate <= toDate.Value.Date);

        return query;
    }

    private static void AttachUnchanged<TEntity>(DbContext context, TEntity entity) where TEntity : class
    {
        var entry = context.Entry(entity);
        if (entry.State == EntityState.Detached)
        {
            context.Set<TEntity>().Attach(entity);
            context.Entry(entity).State = EntityState.Unchanged;
        }
    }

    /// <summary>
    /// Attach() + Entry.State does not cascade to OwnsOne value objects.
    /// New receipt lines would INSERT with NULL UnitPrice unless owned navigations are Added.
    /// </summary>
    private static void SetOwnedNavigationsState(DbContext context, object entity, EntityState state)
    {
        foreach (var reference in context.Entry(entity).References)
        {
            if (reference.TargetEntry is null)
                continue;
            if (!reference.Metadata.TargetEntityType.IsOwned())
                continue;
            reference.TargetEntry.State = state;
        }
    }

    private static void EnsureProductCategoryTrackedOnce(DbContext context, Product product)
    {
        if (product.Category == null) return;

        var trackedCategory = context.ChangeTracker.Entries<ProductCategory>()
            .FirstOrDefault(e => e.Entity.Id == product.Category.Id)?.Entity;

        if (trackedCategory != null)
        {
            typeof(Product).GetProperty(nameof(Product.Category), BindingFlags.Public | BindingFlags.Instance)
                ?.SetValue(product, trackedCategory);
        }
    }
}
