using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Supplier aggregate.
/// </summary>
public sealed class SupplierRepository : ISupplierRepository
{
    private readonly TenantDbContextFactory _contextFactory;

    public SupplierRepository(TenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Supplier?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
    }

    public async Task<Supplier?> GetByNifAsync(string nif, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(nif)) return null;
        var normalized = nif.Trim().ToUpperInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers
            .FirstOrDefaultAsync(s => s.NIF != null && EF.Property<string>(s.NIF, "Value") == normalized, cancellationToken);
    }

    public async Task<Supplier?> GetByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalized = email.Trim().ToLowerInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers
            .FirstOrDefaultAsync(s => EF.Property<string>(s.Email, "Value") == normalized, cancellationToken);
    }

    public async Task<IReadOnlyList<Supplier>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers
            .OrderBy(s => s.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Supplier>> GetActiveSuppliersAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers
            .Where(s => s.IsActive)
            .OrderBy(s => s.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<Supplier> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplySupplierFilters(context.Suppliers.AsQueryable(), searchTerm, type, isActive);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(s => s.Name)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the supplier list filters. Single source of truth shared by <see cref="SearchAsync"/>
    /// and <see cref="GetSummaryAsync"/> so the list and its totals zone can never diverge.
    /// </summary>
    private static IQueryable<Supplier> ApplySupplierFilters(
        IQueryable<Supplier> query,
        string? searchTerm,
        SupplierType? type,
        bool? isActive)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            var termLower = term.ToLowerInvariant();
            var termUpper = term.ToUpperInvariant();
            query = query.Where(s =>
                s.Name.Contains(term) ||
                EF.Property<string>(s.Email, "Value").Contains(termLower) ||
                (s.NIF != null && EF.Property<string>(s.NIF, "Value").Contains(termUpper)));
        }

        if (type.HasValue)
            query = query.Where(s => s.Type == type.Value);

        if (isActive.HasValue)
            query = query.Where(s => s.IsActive == isActive.Value);

        return query;
    }

    public async Task<SupplierListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        SupplierType? type,
        bool? isActive,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplySupplierFilters(context.Suppliers.AsNoTracking(), searchTerm, type, isActive);

        var count = await filtered.CountAsync(cancellationToken);
        if (count == 0)
            return new SupplierListSummaryDto();

        var activeCount = await filtered.CountAsync(s => s.IsActive, cancellationToken);

        return new SupplierListSummaryDto
        {
            Count = count,
            ActiveCount = activeCount,
            InactiveCount = count - activeCount
        };
    }

    public async Task<bool> HasPurchaseOrdersAsync(Guid supplierId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.PurchaseOrders.AnyAsync(po => po.SupplierId == supplierId, cancellationToken);
    }

    public async Task<Supplier> AddAsync(Supplier entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Suppliers.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(Supplier entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Suppliers.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Supplier entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Suppliers.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Suppliers.AnyAsync(s => s.Id == id, cancellationToken);
    }
}
