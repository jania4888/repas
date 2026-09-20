using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for invoice drafts.
/// </summary>
public sealed class InvoiceDraftRepository : IInvoiceDraftRepository
{
    private readonly IDbContextFactory<TenantDbContext> _contextFactory;

    public InvoiceDraftRepository(IDbContextFactory<TenantDbContext> contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<InvoiceDraft?> GetByIdAsync(
        Guid id, 
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        return await context.InvoiceDrafts
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
    }

    public async Task<InvoiceDraft> AddAsync(
        InvoiceDraft entity, 
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        context.InvoiceDrafts.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(
        InvoiceDraft entity, 
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        context.InvoiceDrafts.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(
        InvoiceDraft entity, 
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        context.InvoiceDrafts.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<InvoiceDraft> Items, int TotalCount)> GetUserDraftsAsync(
        Guid userId,
        int page,
        int pageSize,
        bool includeExpired,
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);

        var query = context.InvoiceDrafts
            .Where(d => d.CreatedBy == userId.ToString())
            .Where(d => !d.IsConverted)
            .AsQueryable();

        if (!includeExpired)
        {
            var now = DateTime.UtcNow;
            query = query.Where(d => d.ExpiresAt > now);
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(d => d.LastModifiedAt)
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyList<InvoiceDraft>> GetExpiredDraftsAsync(
        int batchSize = 100,
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        var now = DateTime.UtcNow;

        return await context.InvoiceDrafts
            .Where(d => d.ExpiresAt < now && !d.IsConverted)
            .OrderBy(d => d.ExpiresAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(
        Guid id, 
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        return await context.InvoiceDrafts.AnyAsync(d => d.Id == id, cancellationToken);
    }

    public async Task<InvoiceDraft?> GetByIdempotencyKeyAsync(
        string idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        await using var context = await _contextFactory.CreateDbContextAsync(cancellationToken);
        return await context.InvoiceDrafts
            .FirstOrDefaultAsync(d => d.IdempotencyKey == idempotencyKey, cancellationToken);
    }
}
