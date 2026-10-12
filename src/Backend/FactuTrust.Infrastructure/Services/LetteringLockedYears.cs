using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Charge, en une requête, les exercices fiscaux verrouillés (D8, troisième cause du prédicat
/// unique <see cref="FactuTrust.Application.Features.Accounting.Lettering.LetteringPeriodLock"/> —
/// la règle elle-même vit en couche Application pour être partagée avec les commandes).
/// </summary>
internal static class LetteringLockedYears
{
    public static async Task<HashSet<int>> LoadAsync(TenantDbContext ctx, CancellationToken cancellationToken)
    {
        var years = await ctx.AccountingYearLocks
            .AsNoTracking()
            .Select(y => y.FiscalYear)
            .ToListAsync(cancellationToken);
        return new HashSet<int>(years);
    }
}
