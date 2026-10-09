using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Repository for <see cref="BankAccount"/> aggregates.
/// </summary>
public sealed class BankAccountRepository : IBankAccountRepository
{
    private readonly ITenantDbContextFactory _contextFactory;

    public BankAccountRepository(ITenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    public async Task<BankAccount?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<BankAccount>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts
            .OrderBy(b => b.BankName)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<BankAccount>> GetActiveByCompanyAsync(Guid companyId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts
            .Where(b => b.CompanyId == companyId && b.IsActive)
            .OrderByDescending(b => b.IsDefault)
            .ThenBy(b => b.BankName)
            .ThenBy(b => b.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<BankAccount?> GetByIdAndCompanyAsync(Guid id, Guid companyId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId && b.IsActive, cancellationToken);
    }

    public async Task<BankAccount?> GetDefaultAsync(Guid companyId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts
            .FirstOrDefaultAsync(b => b.CompanyId == companyId && b.IsActive && b.IsDefault, cancellationToken);
    }

    public async Task<int> CountActiveByCompanyAsync(Guid companyId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts.CountAsync(b => b.CompanyId == companyId && b.IsActive, cancellationToken);
    }

    public async Task<bool> ExistsIbanForCompanyAsync(
        Guid companyId,
        string normalizedIban,
        Guid? excludeAccountId,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var query = context.BankAccounts.Where(b =>
            b.CompanyId == companyId &&
            b.IsActive &&
            b.Iban == normalizedIban);

        if (excludeAccountId.HasValue)
            query = query.Where(b => b.Id != excludeAccountId.Value);

        return await query.AnyAsync(cancellationToken);
    }

    public async Task<BankAccount?> GetByCompanyAndChartNumberAsync(
        Guid companyId,
        string chartOfAccountNumber,
        CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var number = chartOfAccountNumber.Trim();
        return await context.BankAccounts
            .FirstOrDefaultAsync(b => b.CompanyId == companyId && b.ChartOfAccountNumber == number, cancellationToken);
    }

    public async Task ClearDefaultFlagsForCompanyAsync(Guid companyId, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        var list = await context.BankAccounts
            .Where(b => b.CompanyId == companyId && b.IsActive && b.IsDefault)
            .ToListAsync(cancellationToken);

        foreach (var b in list)
            b.RemoveDefault();

        if (list.Count > 0)
            await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<BankAccount> AddAsync(BankAccount entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankAccounts.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(BankAccount entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankAccounts.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(BankAccount entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.BankAccounts.Remove(entity);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.BankAccounts.AnyAsync(b => b.Id == id, cancellationToken);
    }
}
