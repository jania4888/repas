using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for DeliveryNote aggregate.
/// </summary>
public sealed class DeliveryNoteRepository : IDeliveryNoteRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public DeliveryNoteRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<DeliveryNote?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes
            .Include(d => d.Client)
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
    }

    public async Task<DeliveryNote?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes
            .Include(d => d.Client)
            .Include(d => d.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
    }

    public async Task<DeliveryNote?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes
            .Include(d => d.Client)
            .Include(d => d.Warehouse)
            .Include(d => d.Invoice)
            .Include(d => d.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
    }

    public async Task<(IReadOnlyList<DeliveryNote> Items, int TotalCount)> GetPagedAsync(
        int page,
        int pageSize,
        Guid? clientId = null,
        DeliveryNoteStatus? status = null,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        string? search = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyDeliveryNoteFilters(
            context.DeliveryNotes
                .Include(d => d.Client)
                .Include(d => d.Warehouse)
                .Include(d => d.Invoice)
                .Include(d => d.Lines)
                .AsQueryable(),
            clientId, status, fromDate, toDate, search);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(d => d.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the delivery note list filters. Single source of truth shared by
    /// <see cref="GetPagedAsync"/> and <see cref="GetSummaryAsync"/> (no drift between list and totals).
    /// </summary>
    private static IQueryable<DeliveryNote> ApplyDeliveryNoteFilters(
        IQueryable<DeliveryNote> query,
        Guid? clientId,
        DeliveryNoteStatus? status,
        DateTime? fromDate,
        DateTime? toDate,
        string? search)
    {
        if (clientId.HasValue)
            query = query.Where(d => d.ClientId == clientId.Value);

        if (status.HasValue)
            query = query.Where(d => d.Status == status.Value);

        if (fromDate.HasValue)
            query = query.Where(d => d.IssueDate >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(d => d.IssueDate <= toDate.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(d =>
                EF.Property<string>(d.Number, "Value").Contains(search) ||
                d.Client.Name.Contains(search) ||
                (d.Reference != null && d.Reference.Contains(search)) ||
                d.DeliveryAddress.Contains(search));
        }

        return query;
    }

    public async Task<DeliveryNoteListSummaryDto> GetSummaryAsync(
        Guid? clientId = null,
        DeliveryNoteStatus? status = null,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        string? search = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Delivery-note totals are computed from lines (per-line rounding), so we materialize
        // the filtered set with its Lines and aggregate in memory to match the list exactly.
        var notes = await ApplyDeliveryNoteFilters(
                context.DeliveryNotes.AsNoTracking().Include(d => d.Lines),
                clientId, status, fromDate, toDate, search)
            .ToListAsync(cancellationToken);

        if (notes.Count == 0)
            return new DeliveryNoteListSummaryDto { Currency = "TND" };

        return new DeliveryNoteListSummaryDto
        {
            Count = notes.Count,
            TotalTtc = Math.Round(notes.Sum(d => d.TotalTTC), 3),
            TotalHt = Math.Round(notes.Sum(d => d.TotalHT), 3),
            TotalVat = Math.Round(notes.Sum(d => d.TotalVAT), 3),
            DeliveredCount = notes.Count(d => d.Status == DeliveryNoteStatus.Delivered),
            InvoicedCount = notes.Count(d => d.InvoiceId != null),
            Currency = "TND"
        };
    }

    public async Task<IReadOnlyList<DeliveryNote>> GetForReportAsync(
        DateTime? fromDate,
        DateTime? toDate,
        Guid? clientId = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = context.DeliveryNotes
            .Include(d => d.Client)
            .Include(d => d.Lines)
            .AsQueryable();

        if (fromDate.HasValue)
            query = query.Where(d => d.IssueDate >= fromDate.Value);

        if (toDate.HasValue)
            query = query.Where(d => d.IssueDate <= toDate.Value);

        if (clientId.HasValue)
            query = query.Where(d => d.ClientId == clientId.Value);

        return await query
            .OrderByDescending(d => d.IssueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DeliveryNote>> GetUninvoicedByClientAsync(
        Guid clientId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes
            .Include(d => d.Lines)
                .ThenInclude(l => l.Product)
            .Where(d => d.ClientId == clientId &&
                        d.InvoiceId == null &&
                        (d.Status == DeliveryNoteStatus.Delivered ||
                         d.Status == DeliveryNoteStatus.PartiallyDelivered) &&
                        d.Lines.Any(l => l.DeliveredQuantity - l.ReturnedQuantity > 0))
            .OrderBy(d => d.IssueDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DeliveryNote>> GetEligibleForReturnAsync(
        Guid? clientId = null,
        string? search = null,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.DeliveryNotes
            .Include(d => d.Client)
            .Include(d => d.Warehouse)
            .Include(d => d.Lines)
                .ThenInclude(l => l.Product)
            .Where(d => d.InvoiceId == null &&
                        (d.Status == DeliveryNoteStatus.Delivered ||
                         d.Status == DeliveryNoteStatus.PartiallyDelivered) &&
                        d.Lines.Any(l => l.DeliveredQuantity - l.ReturnedQuantity > 0));

        if (clientId.HasValue)
            query = query.Where(d => d.ClientId == clientId.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(d =>
                d.Number.Value.Contains(term) ||
                d.Client.Name.Contains(term));
        }

        return await query
            .OrderByDescending(d => d.IssueDate)
            .ToListAsync(cancellationToken);
    }

    [Obsolete("Use IDocumentNumberService instead.")]
    public async Task<DeliveryNoteNumber> GetNextNumberAsync(int year, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var lastSequence = await context.DeliveryNotes
            .Where(d => EF.Property<int>(d.Number, "Year") == year)
            .Select(d => EF.Property<int>(d.Number, "Sequence"))
            .OrderByDescending(s => s)
            .FirstOrDefaultAsync(cancellationToken);

        return DeliveryNoteNumber.Generate(year, lastSequence + 1).Value;
    }

    public async Task<IReadOnlyList<DeliveryNote>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes
            .Include(d => d.Client)
            .Include(d => d.Lines)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<DeliveryNote> AddAsync(DeliveryNote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Attach the Client as Unchanged so EF Core doesn't try to insert it.
        if (entity.Client != null)
        {
            var trackedClient = context.ChangeTracker.Entries<Client>()
                .FirstOrDefault(e => e.Entity.Id == entity.Client.Id)?.Entity;
            if (trackedClient == null)
            {
                context.Clients.Attach(entity.Client);
                context.Entry(entity.Client).State = EntityState.Unchanged;
            }
        }

        // Attach distinct Products as Unchanged (multiple lines may share the same Product).
        var distinctProducts = entity.Lines
            .Where(l => l.Product != null)
            .Select(l => l.Product!)
            .GroupBy(p => p.Id)
            .Select(g => g.First())
            .ToList();

        foreach (var product in distinctProducts)
        {
            // CRITICAL: Unify any tracked ProductCategory instance to avoid
            // "another instance with the same key value for {'Id'} is already being tracked"
            // when several lines reference products that share the same Category.
            EnsureProductCategoryTrackedOnce(context, product);

            var trackedProduct = context.ChangeTracker.Entries<Product>()
                .FirstOrDefault(e => e.Entity.Id == product.Id)?.Entity;
            if (trackedProduct == null)
            {
                context.Products.Attach(product);
                context.Entry(product).State = EntityState.Unchanged;
            }
        }

        context.DeliveryNotes.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(DeliveryNote deliveryNote, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Collect distinct products from lines before touching the change tracker.
        var distinctProducts = deliveryNote.Lines
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
                // Point the product at the already-tracked instance so Attach(product) below
                // does not encounter a second C# object for the same category Id.
                typeof(Product).GetProperty(nameof(Product.Category))!
                    .SetValue(product, alreadyTracked);
            }
        }

        // Step 2: pre-track distinct products as Unchanged.
        foreach (var product in distinctProducts)
            context.Entry(product).State = EntityState.Unchanged;

        // Step 3: pre-track reference navigations as Unchanged.
        if (deliveryNote.Client != null)
            context.Entry(deliveryNote.Client).State = EntityState.Unchanged;
        if (deliveryNote.Invoice != null)
            context.Entry(deliveryNote.Invoice).State = EntityState.Unchanged;
        if (deliveryNote.Warehouse != null)
            context.Entry(deliveryNote.Warehouse).State = EntityState.Unchanged;

        // Step 4: attach the aggregate root, then mark only its own scalars as Modified.
        // Using context.Attach() instead of context.Update() avoids the recursive Modified
        // flood that context.Update() applies to the entire navigation graph.
        context.Attach(deliveryNote);
        context.Entry(deliveryNote).State = EntityState.Modified;

        // Step 5: mark each line as Modified; reset product references to Unchanged.
        foreach (var line in deliveryNote.Lines)
        {
            context.Entry(line).State = EntityState.Modified;
            if (line.Product != null)
                context.Entry(line.Product).State = EntityState.Unchanged;
        }

        // Step 6: defensive reset — ensure all reference entities are still Unchanged.
        if (deliveryNote.Client != null)
            context.Entry(deliveryNote.Client).State = EntityState.Unchanged;
        if (deliveryNote.Invoice != null)
            context.Entry(deliveryNote.Invoice).State = EntityState.Unchanged;
        if (deliveryNote.Warehouse != null)
            context.Entry(deliveryNote.Warehouse).State = EntityState.Unchanged;
        foreach (var product in distinctProducts)
        {
            context.Entry(product).State = EntityState.Unchanged;
            if (product.Category != null)
                context.Entry(product.Category).State = EntityState.Unchanged;
        }

        // Detached aggregates may call IncrementVersion() (MarkAsInvoiced, etc.) before UpdateAsync.
        // Attach() sets OriginalValue = CurrentValue, breaking optimistic concurrency (0 rows updated).
        // ApplyReturnsAsync avoids this by mutating a tracked entity; restore the store token here.
        var dbVersion = await context.DeliveryNotes
            .AsNoTracking()
            .Where(d => d.Id == deliveryNote.Id)
            .Select(d => (int?)d.Version)
            .SingleOrDefaultAsync(cancellationToken);

        if (dbVersion is not null)
            context.Entry(deliveryNote).Property(d => d.Version).OriginalValue = dbVersion.Value;

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<Result> ApplyReturnsAsync(
        Guid deliveryNoteId,
        IReadOnlyList<(Guid LineId, decimal Quantity)> returns,
        string updatedBy,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var deliveryNote = await context.DeliveryNotes
            .Include(d => d.Lines)
            .FirstOrDefaultAsync(d => d.Id == deliveryNoteId, cancellationToken);
        if (deliveryNote is null)
            return Result.Failure(Error.NotFound("DeliveryNote", deliveryNoteId));

        if (deliveryNote.InvoiceId.HasValue)
            return Result.Failure(Error.Conflict(
                "Le bon de livraison a été facturé entre-temps. Rechargez la page."));

        foreach (var (lineId, quantity) in returns)
        {
            var recordResult = deliveryNote.RecordReturn(lineId, quantity);
            if (recordResult.IsFailure)
                return recordResult;
        }

        if (!string.IsNullOrWhiteSpace(updatedBy))
            deliveryNote.SetAuditInfo(updatedBy, isUpdate: true);

        await context.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task DeleteAsync(DeliveryNote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.DeliveryNotes.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.DeliveryNotes.AnyAsync(d => d.Id == id, cancellationToken);
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
