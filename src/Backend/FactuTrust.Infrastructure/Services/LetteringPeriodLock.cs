using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Prédicat unique de « période verrouillée » pour le lettrage (plan de refonte, D8, §5.3).
/// Règle stricte : <see cref="AccountingPeriod.IsClosed"/>, ou écriture au statut
/// <see cref="JournalEntryStatus.Cloturee"/>, ou exercice fiscal présent dans
/// <c>AccountingYearLocks</c>. Composant unique utilisé par <c>LetteringService</c> et
/// <c>LetteringQueryService</c> pour que le flag <c>PeriodLocked</c> lu par l'écran et le refus
/// serveur appliquent exactement la même règle.
/// </summary>
public static class LetteringPeriodLock
{
    /// <summary>Charge, en une requête, les exercices fiscaux verrouillés (D8, troisième cause).</summary>
    public static async Task<HashSet<int>> LockedYearsAsync(TenantDbContext ctx, CancellationToken cancellationToken)
    {
        var years = await ctx.AccountingYearLocks
            .AsNoTracking()
            .Select(y => y.FiscalYear)
            .ToListAsync(cancellationToken);
        return new HashSet<int>(years);
    }

    /// <summary>
    /// Vrai si l'écriture appartenant à <paramref name="entry"/> est verrouillée (D8). Nécessite
    /// que <see cref="JournalEntry.AccountingPeriod"/> soit chargé (<c>Include</c>) ; à défaut,
    /// seules les deux premières causes (statut, année) peuvent être évaluées.
    /// </summary>
    public static bool IsLocked(JournalEntry entry, HashSet<int> lockedYears)
    {
        if (entry.Status == JournalEntryStatus.Cloturee)
            return true;

        if (entry.AccountingPeriod?.IsClosed == true)
            return true;

        var fiscalYear = entry.AccountingPeriod?.FiscalYear ?? entry.EntryDate.Year;
        return lockedYears.Contains(fiscalYear);
    }
}
