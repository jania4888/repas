using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.CashDesk;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for CashOperation aggregate (formerly CashExpense).
/// </summary>
public sealed class CashOperationRepository : ICashOperationRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public CashOperationRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<CashOperation?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CashOperations.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    }

    public async Task<bool> ExistsBySourceAsync(
        string sourceType,
        Guid sourceId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceType) || sourceId == Guid.Empty)
            return false;

        await using var context = _contextFactory.CreateContext();
        var normalizedType = sourceType.Trim();
        return await context.CashOperations.AnyAsync(
            e => e.SourceType == normalizedType && e.SourceId == sourceId,
            cancellationToken);
    }

    public async Task<CashOperation?> GetBySourceAsync(
        string sourceType,
        Guid sourceId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceType) || sourceId == Guid.Empty)
            return null;

        await using var context = _contextFactory.CreateContext();
        var normalizedType = sourceType.Trim();
        return await context.CashOperations.FirstOrDefaultAsync(
            e => e.SourceType == normalizedType && e.SourceId == sourceId,
            cancellationToken);
    }

    public async Task<IReadOnlyList<CashOperation>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CashOperations
            .OrderByDescending(e => e.OperationDate)
            .ThenByDescending(e => e.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<CashOperation> Items, int TotalCount)> GetNonCancelledByDateRangeAsync(
        DateTime fromDate,
        DateTime toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var from = fromDate.Date;
        var to = toDate.Date;

        var query = context.CashOperations
            .Where(e => e.Status != CashOperationStatus.Annulee && e.OperationDate >= from && e.OperationDate <= to)
            .OrderByDescending(e => e.OperationDate)
            .ThenByDescending(e => e.CreatedAt)
            .ThenByDescending(e => e.Id);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<IReadOnlyDictionary<PaymentMethod, decimal>> GetNonCancelledTotalsByMethodAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var from = fromDate.Date;
        var to = toDate.Date;

        var totals = await context.CashOperations
            .Where(e => e.Status != CashOperationStatus.Annulee && e.OperationDate >= from && e.OperationDate <= to)
            .GroupBy(e => e.Method)
            .Select(g => new
            {
                Method = g.Key,
                Total = g.Sum(x => x.Amount.Amount)
            })
            .ToListAsync(cancellationToken);

        return totals.ToDictionary(x => x.Method, x => x.Total);
    }

    public async Task<IReadOnlyDictionary<(PaymentMethod Method, CashOperationType Type), decimal>> GetNonCancelledTotalsByMethodAndTypeAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var from = fromDate.Date;
        var to = toDate.Date;

        var totals = await context.CashOperations
            .Where(e => e.Status != CashOperationStatus.Annulee && e.OperationDate >= from && e.OperationDate <= to)
            .GroupBy(e => new { e.Method, e.OperationType })
            .Select(g => new
            {
                g.Key.Method,
                g.Key.OperationType,
                Total = g.Sum(x => x.Amount.Amount)
            })
            .ToListAsync(cancellationToken);

        return totals.ToDictionary(
            x => (x.Method, x.OperationType),
            x => x.Total);
    }

    public async Task<decimal> GetNetBalanceForMethodUpToDateAsync(
        PaymentMethod method,
        DateTime upToDateInclusive,
        CancellationToken cancellationToken = default)
    {
        var from = new DateTime(2000, 1, 1);
        var to = upToDateInclusive.Date;
        var totals = await GetNonCancelledTotalsByMethodAndTypeAsync(from, to, cancellationToken);
        totals.TryGetValue((method, CashOperationType.Credit), out var credits);
        totals.TryGetValue((method, CashOperationType.Debit), out var debits);
        return credits - debits;
    }

    public async Task<CashOperation> AddAsync(CashOperation entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CashOperations.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(CashOperation entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CashOperations.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(CashOperation entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.CashOperations.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CashOperations.AnyAsync(e => e.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<CashJournalCategoryTotal>> GetNonCancelledJournalCategoryTotalsAsync(
        DateTime fromDate,
        DateTime toDate,
        PaymentMethod? method,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var rows = await JournalFilter(context, fromDate, toDate, method)
            .GroupBy(e => new { e.OperationType, e.Category, e.RevenueCategory })
            .Select(g => new
            {
                g.Key.OperationType,
                g.Key.Category,
                g.Key.RevenueCategory,
                Count = g.Count(),
                Total = g.Sum(x => x.Amount.Amount)
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new CashJournalCategoryTotal(
                r.OperationType,
                r.OperationType == CashOperationType.Credit ? (int?)r.RevenueCategory : (int?)r.Category,
                r.Count,
                r.Total))
            .GroupBy(r => (r.OperationType, r.CategoryCode))
            .Select(g => new CashJournalCategoryTotal(
                g.Key.OperationType,
                g.Key.CategoryCode,
                g.Sum(x => x.Count),
                g.Sum(x => x.Total)))
            .ToList();
    }

    public async Task<(IReadOnlyList<CashOperation> Items, int TotalCount)> GetNonCancelledJournalLinesAsync(
        DateTime fromDate,
        DateTime toDate,
        PaymentMethod? method,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        // Tri en mémoire : le fournisseur InMemory d'EF Core ne traduit pas ThenBy sur le numéro
        // possédé, et la fenêtre est déjà bornée à 366 jours par le handler. On ne charge pas la table.
        var period = await JournalFilter(context, fromDate, toDate, method).ToListAsync(cancellationToken);
        var ordered = period
            .OrderBy(e => e.OperationDate)
            .ThenBy(e => e.Number.Value, StringComparer.Ordinal)
            .ThenBy(e => e.Id)
            .ToList();

        var take = Math.Clamp(pageSize, 1, TreasuryJournalConstants.MaxLinesForPdf);
        var skip = PagingBounds.SafeSkip(page, take);
        if (skip >= ordered.Count)
            return (Array.Empty<CashOperation>(), ordered.Count);

        var items = ordered.Skip(skip).Take(take).ToList();
        return (items, ordered.Count);
    }

    private static IQueryable<CashOperation> JournalFilter(
        TenantDbContext context,
        DateTime fromDate,
        DateTime toDate,
        PaymentMethod? method)
    {
        var from = fromDate.Date;
        var to = toDate.Date;
        var query = context.CashOperations.Where(e =>
            e.Status != CashOperationStatus.Annulee &&
            e.OperationDate >= from &&
            e.OperationDate <= to);

        if (method.HasValue)
            query = query.Where(e => e.Method == method.Value);

        return query;
    }

    public async Task<IReadOnlyList<CashOperation>> GetByCashRegisterSessionIdAsync(
        Guid cashRegisterSessionId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.CashOperations
            .Where(e => e.CashRegisterSessionId == cashRegisterSessionId)
            .OrderBy(e => e.OperationDate)
            .ThenBy(e => e.CreatedAt)
            .ToListAsync(cancellationToken);
    }
}
