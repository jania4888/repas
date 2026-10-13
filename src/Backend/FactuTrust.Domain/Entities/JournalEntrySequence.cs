using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Per-tenant sequential journal entry numbers (JV, JA, etc.).
/// </summary>
public sealed class JournalEntrySequence : Entity
{
    public string JournalCode { get; private set; } = null!;
    public int FiscalYear { get; private set; }
    public int LastSequence { get; private set; }

    private JournalEntrySequence() { }

    public static JournalEntrySequence Create(string journalCode, int fiscalYear)
    {
        return new JournalEntrySequence
        {
            JournalCode = journalCode.Trim().ToUpperInvariant(),
            FiscalYear = fiscalYear,
            LastSequence = 0
        };
    }

    public int Next()
    {
        LastSequence++;
        return LastSequence;
    }

    /// <summary>
    /// Réserve un bloc de <paramref name="count"/> numéros contigus (génération atomique d'un
    /// relevé) : avance la séquence d'un coup et rend le PREMIER numéro du bloc. Un rollback de la
    /// transaction ambiante qui porte cette avance restaure la séquence (aucun commit séparé ici,
    /// à la différence de <see cref="Next"/> appelé via un contexte isolé).
    /// </summary>
    public int Advance(int count)
    {
        if (count <= 0)
            throw new ArgumentOutOfRangeException(nameof(count), "Le bloc réservé doit contenir au moins un numéro.");

        var first = LastSequence + 1;
        LastSequence += count;
        return first;
    }
}
