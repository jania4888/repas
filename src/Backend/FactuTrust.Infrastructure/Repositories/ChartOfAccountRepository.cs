using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Référentiel plan comptable avec cache mémoire par tenant : CountAsync et
/// GetByAccountNumberAsync sont appelés pour CHAQUE génération d'écriture
/// (AccountingService, y compris dans la transaction stricte de validation).
/// Toutes les écritures passent par AddAsync/UpdateAsync, qui invalident le cache.
/// Lecture du cache : toujours (le référentiel n'est jamais modifié dans les flux
/// transactionnels actuels). Alimentation du cache : uniquement HORS transaction
/// ambiante, pour ne jamais mettre en cache un état susceptible d'être annulé.
/// </summary>
public sealed class ChartOfAccountRepository : IChartOfAccountRepository
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(10);

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITenantContext _tenantContext;
    private readonly TenantAmbientTransaction _ambient;
    private readonly IMemoryCache _cache;

    public ChartOfAccountRepository(
        ITenantDbContextFactory contextFactory,
        ITenantContext tenantContext,
        TenantAmbientTransaction ambient,
        IMemoryCache cache)
    {
        _contextFactory = contextFactory;
        _tenantContext = tenantContext;
        _ambient = ambient;
        _cache = cache;
    }

    private bool CanReadCache => _tenantContext.TenantId is not null;

    private bool CanPopulateCache => !_ambient.IsActive && _tenantContext.TenantId is not null;

    private string CountCacheKey => $"coa:{_tenantContext.TenantId}:count";

    private string AccountCacheKey(string accountNumber) => $"coa:{_tenantContext.TenantId}:num:{accountNumber}";

    public async Task<int> CountAsync(CancellationToken cancellationToken = default)
    {
        if (CanReadCache && _cache.TryGetValue(CountCacheKey, out int cached))
            return cached;

        await using var context = _contextFactory.CreateContext();
        var count = await context.ChartOfAccounts.CountAsync(cancellationToken);

        if (CanPopulateCache)
            _cache.Set(CountCacheKey, count, CacheDuration);

        return count;
    }

    public async Task<ChartOfAccount?> GetByAccountNumberAsync(string accountNumber, CancellationToken cancellationToken = default)
    {
        var n = accountNumber.Trim();

        if (CanReadCache && _cache.TryGetValue(AccountCacheKey(n), out ChartOfAccount? cached))
            return cached;

        await using var context = _contextFactory.CreateContext();
        var account = await context.ChartOfAccounts.AsNoTracking()
            .FirstOrDefaultAsync(c => c.AccountNumber == n, cancellationToken);

        // Les absences ne sont pas mises en cache (un compte créé doit être vu immédiatement).
        if (CanPopulateCache && account is not null)
            _cache.Set(AccountCacheKey(n), account, CacheDuration);

        return account;
    }

    public async Task<IReadOnlyList<ChartOfAccount>> GetAllActiveAsync(CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.ChartOfAccounts.AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.AccountNumber)
            .ToListAsync(cancellationToken);
    }

    public async Task<ChartOfAccount?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.ChartOfAccounts.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
    }

    // Jamais mis en cache : la détection de doublon de matricule fiscal doit voir l'état transactionnel
    // courant (y compris des comptes créés/édités dans la même requête), contrairement aux autres
    // lectures de ce référentiel qui tolèrent une fraîcheur de quelques minutes.
    public async Task<ChartOfAccount?> FindAuxiliaryByFiscalIdAsync(
        AccountType accountType, string fiscalIdNormalized, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.ChartOfAccounts.AsNoTracking()
            .FirstOrDefaultAsync(c =>
                c.IsAuxiliary
                && c.AccountType == accountType
                && c.FiscalIdNormalized == fiscalIdNormalized,
                cancellationToken);
    }

    public async Task<IReadOnlyList<AuxiliaryAccountCandidate>> ListActiveAuxiliaryAccountsAsync(
        AccountType accountType, string accountPrefix, int maxRows, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        return await context.ChartOfAccounts.AsNoTracking()
            .Where(c => c.IsActive && c.IsAuxiliary && c.AccountType == accountType && c.AccountNumber.StartsWith(accountPrefix))
            .OrderBy(c => c.AccountNumber)
            .Take(maxRows)
            .Select(c => new AuxiliaryAccountCandidate(
                c.Id, c.AccountNumber, c.Label, c.FiscalIdNormalized, c.AffectationAccountNumber, c.ParentAccountNumber))
            .ToListAsync(cancellationToken);
    }

    public async Task<ChartOfAccount> AddAsync(ChartOfAccount entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.ChartOfAccounts.Add(entity);
        await context.SaveChangesAsync(cancellationToken);
        InvalidateCache(entity.AccountNumber);
        return entity;
    }

    public async Task UpdateAsync(ChartOfAccount entity, CancellationToken cancellationToken = default)
    {
        await using var context = _contextFactory.CreateContext();
        context.ChartOfAccounts.Update(entity);
        await context.SaveChangesAsync(cancellationToken);
        InvalidateCache(entity.AccountNumber);
    }

    private void InvalidateCache(string accountNumber)
    {
        if (_tenantContext.TenantId is null)
            return;
        _cache.Remove(CountCacheKey);
        _cache.Remove(AccountCacheKey(accountNumber.Trim()));
    }
}
