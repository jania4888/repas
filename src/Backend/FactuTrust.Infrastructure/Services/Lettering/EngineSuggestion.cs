using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>Règle qui a produit une proposition (plan v2, annexe C §2.4 ; contrat API §3).</summary>
internal enum SuggestionKind
{
    DocumentLink,
    SameReference,
    SameThirdPartyAmount,
    SubsetSum,
    AmountOnly,
}

/// <summary>Badge de la maquette : « Match exact », « Match multiple », « Montant identique ».</summary>
internal enum SuggestionCategory
{
    Exact,
    Multiple,
    SameAmount,
}

internal enum SuggestionConfidence
{
    High,
    Medium,
    Low,
}

/// <summary>Codes d'explication, non localisés côté serveur : le front les traduit (annexe C §2.5).</summary>
internal static class EngineReasonCodes
{
    internal const string DocumentLink = "DocumentLink";
    internal const string SameReference = "SameReference";
    internal const string SameThirdParty = "SameThirdParty";
    internal const string ExactAmount = "ExactAmount";
    internal const string SubsetSum = "SubsetSum";
    internal const string AmountOnly = "AmountOnly";
    internal const string AmbiguousAmount = "AmbiguousAmount";
    internal const string DateGap = "DateGap";
    internal const string ExchangeDifference = "ExchangeDifference";
}

/// <summary>Explication structurée : un code et ses arguments (valeurs invariantes).</summary>
internal sealed record EngineReason(string Code, IReadOnlyDictionary<string, string> Args)
{
    private static readonly IReadOnlyDictionary<string, string> NoArgs = new Dictionary<string, string>();

    internal static EngineReason Of(string code) => new(code, NoArgs);

    internal static EngineReason Of(string code, params (string Name, string Value)[] args)
        => new(code, args.ToDictionary(a => a.Name, a => a.Value, StringComparer.Ordinal));
}

/// <summary>Proposition produite par le moteur, avant le mapping vers le DTO.</summary>
/// <param name="RuleRank">Rang de la règle (1 = R1 … 5 = R5), utilisé pour l'ordre final.</param>
/// <param name="Lines">Lignes du groupe, triées par <see cref="LetteringCandidate.OrderRank"/>.</param>
/// <param name="TotalMillimesOp">Total du côté débit, en devise de l'opération (millimes).</param>
/// <param name="LocalGapMillimes">Somme signée en TND (millimes) : non nulle s'il y a un écart de change.</param>
internal sealed record EngineSuggestion(
    string Key,
    SuggestionKind Kind,
    SuggestionCategory Category,
    int RuleRank,
    int Score,
    SuggestionConfidence Confidence,
    string AccountNumber,
    string CurrencyCode,
    Guid? ThirdPartyId,
    ThirdPartyKind ThirdPartyKind,
    IReadOnlyList<LetteringCandidate> Lines,
    long TotalMillimesOp,
    long LocalGapMillimes,
    IReadOnlyList<EngineReason> Reasons)
{
    internal bool HasExchangeDifference => LocalGapMillimes != 0;

    internal int MinOrderRank => Lines[0].OrderRank;
}
