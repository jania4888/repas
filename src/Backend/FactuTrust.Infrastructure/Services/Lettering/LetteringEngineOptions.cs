using FactuTrust.Application.Configuration;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Bornes du moteur de propositions, toujours issues de <see cref="LetteringSuggestionSettings.Clamped"/> :
/// une configuration hors bornes ne peut jamais rendre le moteur coûteux.
/// </summary>
internal sealed record LetteringEngineOptions(
    int MaxSuggestions,
    int SubsetMaxSize,
    int SubsetMaxCandidates,
    int SubsetNodeBudgetPerTarget,
    int SubsetGlobalNodeBudget,
    int MaxLinesPerReference,
    int MaxDocumentPayments)
{
    internal static LetteringEngineOptions Default { get; } = From(new LetteringSuggestionSettings());

    internal static LetteringEngineOptions From(LetteringSuggestionSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var s = settings.Clamped();
        return new LetteringEngineOptions(
            s.MaxSuggestions,
            s.SubsetMaxSize,
            s.SubsetMaxCandidates,
            s.SubsetNodeBudgetPerTarget,
            s.SubsetGlobalNodeBudget,
            s.MaxLinesPerReference,
            s.MaxDocumentPayments);
    }
}
