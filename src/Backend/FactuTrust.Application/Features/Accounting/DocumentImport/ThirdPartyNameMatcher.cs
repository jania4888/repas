using FactuTrust.Application.Features.AI;

namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>Issue du rapprochement par nom (D5 : l'unicité est exigée, il n'y a plus de « meilleur score ».)</summary>
public enum NameMatchOutcome
{
    /// <summary>Aucun candidat au-dessus du seuil.</summary>
    None,
    /// <summary>Des candidats dépassaient le seuil mais ont tous été écartés par un matricule fiscal différent.</summary>
    RejectedByFiscalId,
    /// <summary>Exactement un candidat retenu.</summary>
    Unique,
    /// <summary>Plusieurs candidats retenus : aucun n'est choisi, l'ambiguïté est signalée à l'utilisateur.</summary>
    Ambiguous
}

public readonly record struct NameMatchResult<T>(NameMatchOutcome Outcome, T? Match, IReadOnlyList<T> Candidates)
{
    public static NameMatchResult<T> None() => new(NameMatchOutcome.None, default, Array.Empty<T>());

    public static NameMatchResult<T> RejectedByFiscalId(IReadOnlyList<T> candidates) =>
        new(NameMatchOutcome.RejectedByFiscalId, default, candidates);

    public static NameMatchResult<T> Unique(T match) => new(NameMatchOutcome.Unique, match, new[] { match });

    public static NameMatchResult<T> Ambiguous(IReadOnlyList<T> candidates) =>
        new(NameMatchOutcome.Ambiguous, default, candidates);
}

/// <summary>
/// Rapprochement par similarité de nom, appliqué aussi bien aux comptes auxiliaires qu'aux fiches
/// Client/Fournisseur (plan « Matricule fiscal sur les comptes auxiliaires et rattachement à
/// l'import de facture », §5.7, décision D5) : plus de « meilleur score gagne » — un nom doit
/// désigner un candidat unique au-dessus du seuil, sinon l'ambiguïté est explicitement signalée
/// plutôt que résolue en silence.
/// </summary>
public static class ThirdPartyNameMatcher
{
    /// <summary>Seuil de similarité (distance de Levenshtein normalisée) retenu pour un rapprochement par nom.</summary>
    public const double NameMatchThreshold = 0.9;

    public static NameMatchResult<T> Match<T>(
        string invoiceName,
        string? invoiceFiscalIdNormalized,
        IEnumerable<T> candidates,
        Func<T, string> name,
        Func<T, string?> fiscalIdNormalized)
    {
        var aboveThreshold = candidates
            .Where(c => InvoiceImportParsing.Similarity(invoiceName, name(c)) >= NameMatchThreshold)
            .ToList();

        if (aboveThreshold.Count == 0)
            return NameMatchResult<T>.None();

        // Un matricule fiscal connu sur la pièce départage les homonymes : un candidat qui porte un
        // MF différent n'est manifestement pas le même tiers, même si le nom ressemble.
        var filtered = aboveThreshold;
        if (!string.IsNullOrEmpty(invoiceFiscalIdNormalized))
        {
            filtered = aboveThreshold
                .Where(c =>
                {
                    var candidateFiscalId = fiscalIdNormalized(c);
                    return string.IsNullOrEmpty(candidateFiscalId) || candidateFiscalId == invoiceFiscalIdNormalized;
                })
                .ToList();

            if (filtered.Count == 0)
                return NameMatchResult<T>.RejectedByFiscalId(aboveThreshold);
        }

        return filtered.Count switch
        {
            1 => NameMatchResult<T>.Unique(filtered[0]),
            _ => NameMatchResult<T>.Ambiguous(filtered)
        };
    }
}
