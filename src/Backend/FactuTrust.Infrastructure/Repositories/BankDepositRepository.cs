using System.Data;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository for <see cref="BankDeposit"/> aggregates.
/// </summary>
public sealed class BankDepositRepository : IBankDepositRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public BankDepositRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<BankDeposit?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankDeposits.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<BankDeposit>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankDeposits
            .OrderByDescending(b => b.DepositDate)
            .ThenByDescending(b => b.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<(IReadOnlyList<BankDeposit> Items, int TotalCount)> GetNonCancelledByDateRangeAsync(
        DateTime fromDate,
        DateTime toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();

        var from = fromDate.Date;
        var to = toDate.Date;

        var query = context.BankDeposits
            .Where(e => e.Status != BankDepositStatus.Annulee && e.DepositDate >= from && e.DepositDate <= to)
            .OrderByDescending(e => e.DepositDate)
            .ThenByDescending(e => e.CreatedAt)
            .ThenByDescending(e => e.Id);

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .Skip(PagingBounds.SafeSkip(page, pageSize))
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return (items, totalCount);
    }

    public async Task<BankDeposit> AddAsync(BankDeposit entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankDeposits.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task AddWithCashOperationAsync(
        BankDeposit deposit,
        CashOperation cashOperation,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateIsolatedContext();
        var strategy = context.Database.CreateExecutionStrategy();

        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            try
            {
                context.CashOperations.Add(cashOperation);
                context.BankDeposits.Add(deposit);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                await transaction.RollbackAsync(cancellationToken);
                throw;
            }
        });
    }

    public async Task UpdateBankDepositAndCashOperationAsync(
        BankDeposit deposit,
        CashOperation cashOperation,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateIsolatedContext();
        var strategy = context.Database.CreateExecutionStrategy();

        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            try
            {
                context.BankDeposits.Update(deposit);
                context.CashOperations.Update(cashOperation);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                await transaction.RollbackAsync(cancellationToken);
                throw;
            }
        });
    }

    public async Task UpdateAsync(BankDeposit entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankDeposits.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(BankDeposit entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankDeposits.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankDeposits.AnyAsync(b => b.Id == id, cancellationToken);
    }
}
