using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Client aggregate.
/// </summary>
public sealed class ClientRepository : IClientRepository
{
    private readonly TenantDbContextFactory _contextFactory;

    public ClientRepository(TenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<Client?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Clients.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
    }

    public async Task<Client?> GetByNifAsync(string nif, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(nif)) return null;
        var normalized = nif.Trim().ToUpperInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .FirstOrDefaultAsync(c => c.NIF != null && EF.Property<string>(c.NIF, "Value") == normalized, cancellationToken);
    }

    public async Task<Client?> GetByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalized = email.Trim().ToLowerInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .FirstOrDefaultAsync(c => EF.Property<string>(c.Email, "Value") == normalized, cancellationToken);
    }

    public async Task<Client?> GetByEmailExcludingIdAsync(string email, Guid excludeId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalized = email.Trim().ToLowerInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .FirstOrDefaultAsync(c => c.Id != excludeId && EF.Property<string>(c.Email, "Value") == normalized, cancellationToken);
    }

    public async Task<Client?> GetByNifExcludingIdAsync(string nif, Guid excludeId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(nif)) return null;
        var normalized = nif.Trim().ToUpperInvariant();
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .FirstOrDefaultAsync(c => c.Id != excludeId && c.NIF != null && EF.Property<string>(c.NIF, "Value") == normalized, cancellationToken);
    }

    public async Task<IReadOnlyList<Client>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Client>> GetActiveClientsAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Clients
            .Where(c => c.IsActive)
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<Client> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var query = ApplyClientFilters(context.Clients.AsQueryable(), searchTerm, type, isActive, governorate);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderBy(c => c.Name)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    /// <summary>
    /// Applies the client list filters. Single source of truth shared by <see cref="SearchAsync"/>
    /// and <see cref="GetSummaryAsync"/> so the list and its totals zone can never diverge.
    /// </summary>
    private static IQueryable<Client> ApplyClientFilters(
        IQueryable<Client> query,
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate)
    {
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            var termLower = term.ToLowerInvariant();
            var termUpper = term.ToUpperInvariant();
            var codeHex = term.StartsWith("CLI-", StringComparison.OrdinalIgnoreCase)
                ? term[4..].Replace("-", "", StringComparison.Ordinal).ToUpperInvariant()
                : null;

            query = query.Where(c =>
                c.Name.Contains(term) ||
                EF.Property<string>(c.Email, "Value").Contains(termLower) ||
                (c.NIF != null && EF.Property<string>(c.NIF, "Value").Contains(termUpper)) ||
                (codeHex != null
                    && codeHex.Length >= 4
                    && c.Id.ToString().ToUpper().Replace("-", "").StartsWith(codeHex)));
        }

        if (type.HasValue)
            query = query.Where(c => c.Type == type.Value);

        if (isActive.HasValue)
            query = query.Where(c => c.IsActive == isActive.Value);

        if (!string.IsNullOrWhiteSpace(governorate))
            query = query.Where(c => c.Address.Governorate == governorate);

        return query;
    }

    public async Task<ClientListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        ClientType? type,
        bool? isActive,
        string? governorate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var filtered = ApplyClientFilters(
            context.Clients.AsNoTracking(), searchTerm, type, isActive, governorate);

        var count = await filtered.CountAsync(cancellationToken);
        if (count == 0)
            return new ClientListSummaryDto();

        var activeCount = await filtered.CountAsync(c => c.IsActive, cancellationToken);

        return new ClientListSummaryDto
        {
            Count = count,
            ActiveCount = activeCount,
            InactiveCount = count - activeCount
        };
    }

    public async Task<bool> HasInvoicesAsync(Guid clientId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Invoices.AnyAsync(i => i.ClientId == clientId, cancellationToken);
    }

    public async Task<bool> HasQuotesAsync(Guid clientId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Quotes.AnyAsync(q => q.ClientId == clientId, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesByIdsAsync(
        IReadOnlyCollection<Guid> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        var distinct = ids.Distinct().ToList();
        await using var context = _contextFactory.CreateContext();
        var rows = await context.Clients.AsNoTracking()
            .Where(c => distinct.Contains(c.Id))
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(cancellationToken);

        return rows.ToDictionary(r => r.Id, r => r.Name);
    }

    public async Task<Client> AddAsync(Client entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Clients.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(Client entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Clients.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Client entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.Clients.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.Clients.AnyAsync(c => c.Id == id, cancellationToken);
    }
}
