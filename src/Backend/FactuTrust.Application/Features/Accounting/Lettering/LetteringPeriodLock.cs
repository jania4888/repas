using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>
/// Prédicat unique de « période verrouillée » pour le lettrage (plan de refonte, D8, §5.3).
/// Règle stricte : <see cref="AccountingPeriod.IsClosed"/>, ou écriture au statut
/// <see cref="JournalEntryStatus.Cloturee"/>, ou exercice fiscal présent dans
/// <c>AccountingYearLocks</c>. Composant unique utilisé par <c>LetteringService</c>,
/// <c>LetteringQueryService</c> (flag <c>PeriodLocked</c> lu par l'écran) et
/// <c>SettleExchangeDifferenceCommand</c> pour que la lecture et le refus serveur appliquent
/// exactement la même règle — ne JAMAIS dupliquer cette logique ailleurs.
/// </summary>
/// <remarks>
/// Vit dans la couche Application (et non Infrastructure) car
/// <c>SettleExchangeDifferenceCommand</c> (Application) ne peut pas référencer Infrastructure.
/// Le chargement des exercices verrouillés, lui, reste côté Infrastructure
/// (<c>LetteringLockedYears.LoadAsync</c> / <c>IJournalEntryRepository.GetLockedFiscalYearsAsync</c>).
/// </remarks>
public static class LetteringPeriodLock
{
    /// <summary>
    /// Forme scalaire du prédicat (D8) — utilisée aussi bien par les entités chargées que par les
    /// projections SQL de la couche lecture, pour qu'il n'existe qu'UNE seule implémentation.
    /// </summary>
    public static bool IsLocked(JournalEntryStatus status, bool periodIsClosed, int fiscalYear, HashSet<int> lockedYears) =>
        status == JournalEntryStatus.Cloturee
        || periodIsClosed
        || lockedYears.Contains(fiscalYear);

    /// <summary>
    /// Vrai si l'écriture <paramref name="entry"/> est verrouillée (D8). Nécessite que
    /// <see cref="JournalEntry.AccountingPeriod"/> soit chargé (<c>Include</c>) ; à défaut,
    /// seules les causes « statut » et « exercice » (repli sur <c>EntryDate.Year</c>) peuvent
    /// être évaluées.
    /// </summary>
    public static bool IsLocked(JournalEntry? entry, HashSet<int> lockedYears) =>
        entry is not null
        && IsLocked(
            entry.Status,
            entry.AccountingPeriod?.IsClosed == true,
            entry.AccountingPeriod?.FiscalYear ?? entry.EntryDate.Year,
            lockedYears);

    /// <summary>Vrai si l'écriture porteuse de <paramref name="line"/> est verrouillée (D8).</summary>
    public static bool IsLocked(JournalEntryLine? line, HashSet<int> lockedYears) =>
        line is not null && IsLocked(line.JournalEntry, lockedYears);

    /// <summary>
    /// Libellé humain d'une ligne pour les messages de refus : référence de pièce si elle existe,
    /// sinon « journal-numéro », sinon l'identifiant technique.
    /// </summary>
    public static string DescribeLine(JournalEntryLine line) =>
        line.JournalEntry?.PieceRef is { Length: > 0 } pieceRef
            ? pieceRef
            : line.JournalEntry is not null
                ? $"{line.JournalEntry.JournalCode}-{line.JournalEntry.EntryNumber}"
                : line.Id.ToString();
}
