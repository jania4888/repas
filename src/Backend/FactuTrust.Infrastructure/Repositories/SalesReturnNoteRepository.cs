using System.Reflection;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

public sealed class SalesReturnNoteRepository : ISalesReturnNoteRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public SalesReturnNoteRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<SalesReturnNote?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .Include(n => n.Client)
            .Include(n => n.DeliveryNote)
            .Include(n => n.Warehouse)
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
    }

    public async Task<SalesReturnNote?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .Include(n => n.Client)
            .Include(n => n.DeliveryNote)
            .Include(n => n.Warehouse)
            .Include(n => n.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
    }

    public async Task<SalesReturnNote?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .Include(n => n.Client)
            .Include(n => n.Warehouse)
            .Include(n => n.DeliveryNote)
                .ThenInclude(d => d.Lines)
            .Include(n => n.Lines)
                .ThenInclude(l => l.Product)
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<SalesReturnNote>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .Include(n => n.Client)
            .OrderByDescending(n => n.ReturnDate)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<SalesReturnNote> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SalesReturnNoteStatus? status,
        Guid? clientId,
        Guid? deliveryNoteId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyFilters(
            context.SalesReturnNotes
                .Include(n => n.Client)
                .Include(n => n.Warehouse)
                .Include(n => n.DeliveryNote)
                .Include(n => n.Lines)
                .AsQueryable(),
            searchTerm, status, clientId, deliveryNoteId, fromDate, toDate);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(n => n.ReturnDate)
            .ThenByDescending(n => n.CreatedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<SalesReturnNoteListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SalesReturnNoteStatus? status,
        Guid? clientId,
        Guid? deliveryNoteId,
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var items = await ApplyFilters(
                context.SalesReturnNotes
                    .Include(n => n.Lines)
                    .AsQueryable(),
                searchTerm, status, clientId, deliveryNoteId, fromDate, toDate)
            .ToListAsync(cancellationToken);

        return new SalesReturnNoteListSummaryDto
        {
            Count = items.Count,
            TotalHt = items.Sum(n => n.TotalHT),
            TotalVat = items.Sum(n => n.TotalVAT),
            TotalTtc = items.Sum(n => n.TotalTTC),
            ConfirmedCount = items.Count(n => n.Status == SalesReturnNoteStatus.Confirmed),
            DraftCount = items.Count(n => n.Status == SalesReturnNoteStatus.Draft),
            Currency = "TND"
        };
    }

    public async Task<IReadOnlyList<SalesReturnNote>> GetByDeliveryNoteIdAsync(
        Guid deliveryNoteId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .Include(n => n.Lines)
            .Where(n => n.DeliveryNoteId == deliveryNoteId)
            .OrderByDescending(n => n.ReturnDate)
            .ThenByDescending(n => n.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ExistsNumberAsync(string number, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes
            .AnyAsync(n => n.Number.Value == number, cancellationToken);
    }

    public async Task<SalesReturnNote> AddAsync(SalesReturnNote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        entity.ClearParentNavigationsForPersistence();
        AttachLineProductsUnchanged(context, entity);

        context.SalesReturnNotes.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(SalesReturnNote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        entity.ClearParentNavigationsForPersistence();
        AttachLineProductsUnchanged(context, entity);

        context.Attach(entity);
        context.Entry(entity).State = EntityState.Modified;

        foreach (var line in entity.Lines)
        {
            context.Entry(line).State = EntityState.Modified;
            if (line.Product != null)
                context.Entry(line.Product).State = EntityState.Unchanged;
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<Result> ConfirmPersistedAsync(
        Guid id,
        string updatedBy,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var note = await context.SalesReturnNotes
            .Include(n => n.Lines)
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
        if (note is null)
            return Result.Failure(Error.NotFound("SalesReturnNote", id));

        var confirmResult = note.Confirm();
        if (confirmResult.IsFailure)
            return confirmResult;

        if (!string.IsNullOrWhiteSpace(updatedBy))
            note.SetAuditInfo(updatedBy, isUpdate: true);

        await context.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task DeleteAsync(SalesReturnNote entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.SalesReturnNotes.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.SalesReturnNotes.AnyAsync(n => n.Id == id, cancellationToken);
    }

    private static IQueryable<SalesReturnNote> ApplyFilters(
        IQueryable<SalesReturnNote> query,
        string? searchTerm,
        SalesReturnNoteStatus? status,
        Guid? clientId,
        Guid? deliveryNoteId,
        DateTime? fromDate,
        DateTime? toDate)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(n =>
                n.Number.Value.Contains(term) ||
                n.Client.Name.Contains(term) ||
                n.DeliveryNote.Number.Value.Contains(term) ||
                n.Reason.Contains(term));
        }

        if (status.HasValue)
            query = query.Where(n => n.Status == status.Value);

        if (clientId.HasValue)
            query = query.Where(n => n.ClientId == clientId.Value);

        if (deliveryNoteId.HasValue)
            query = query.Where(n => n.DeliveryNoteId == deliveryNoteId.Value);

        if (fromDate.HasValue)
            query = query.Where(n => n.ReturnDate >= fromDate.Value.Date);

        if (toDate.HasValue)
            query = query.Where(n => n.ReturnDate <= toDate.Value.Date);

        return query;
    }

    private static void AttachLineProductsUnchanged(DbContext context, SalesReturnNote entity)
    {
        var distinctProducts = entity.Lines
            .Where(l => l.Product != null)
            .Select(l => l.Product!)
            .GroupBy(p => p.Id)
            .Select(g => g.First())
            .ToList();

        foreach (var product in distinctProducts)
            EnsureProductCategoryTrackedOnce(context, product);

        foreach (var product in distinctProducts)
        {
            var tracked = context.ChangeTracker.Entries<Product>()
                .FirstOrDefault(e => e.Entity.Id == product.Id)?.Entity;
            if (tracked == null)
            {
                context.Set<Product>().Attach(product);
                context.Entry(product).State = EntityState.Unchanged;
            }
            else if (!ReferenceEquals(tracked, product))
            {
                foreach (var line in entity.Lines.Where(l => l.Product != null && l.Product.Id == product.Id))
                    line.ReplaceProductForPersistence(tracked);
            }
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
        else
        {
            context.Entry(product.Category).State = EntityState.Unchanged;
        }
    }
}
