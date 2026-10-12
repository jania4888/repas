namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>
/// Origine d'une opération de lettrage/délettrage, tracée à l'audit. L'origine ne contourne
/// jamais le verrou de période (D9) : seules <see cref="Automatic"/> (paiements, paie) gardent le
/// comportement actuel sur les lignes d'une période clôturée.
/// </summary>
public enum LetteringOrigin
{
    Manual = 0,
    Automatic = 1,
    DraftUpdate = 2,
    PayrollCancellation = 3,
    ExchangeDifference = 4,

    /// <summary>Réservé Phase 3 (proposition validée).</summary>
    Suggestion = 5,

    /// <summary>Réservé Phase 3 (lettrage en masse).</summary>
    Bulk = 6
}

/// <summary>Mode de correspondance du compte sur <c>GET lettering/lines</c> (plan §4.1).</summary>
public enum LetteringAccountMatch
{
    Exact = 0,
    Prefix = 1
}

/// <summary>État de lettrage filtré sur <c>GET lettering/lines</c> (plan §4.1).</summary>
public enum LetteringStateFilter
{
    All = 0,
    Unlettered = 1,
    Partial = 2,
    Lettered = 3
}

/// <summary>Sens filtré sur <c>GET lettering/lines</c> (plan §4.1).</summary>
public enum LetteringSideFilter
{
    All = 0,
    Debit = 1,
    Credit = 2
}
