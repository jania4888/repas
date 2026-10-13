namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>Sortie du moteur de propositions.</summary>
/// <param name="Suggestions">Propositions dans l'ordre final, au plus <c>MaxSuggestions</c>.</param>
/// <param name="TotalFound">Nombre de propositions trouvées avant le plafond <c>MaxSuggestions</c>.</param>
/// <param name="Truncated">Vrai si la recherche s'est arrêtée avant la fin (budget ou fusible).</param>
/// <param name="TruncationReason"><c>"SearchBudget"</c> ou <c>"TimeFuse"</c> ; <c>null</c> sinon.</param>
internal sealed record LetteringEngineOutput(
    IReadOnlyList<EngineSuggestion> Suggestions,
    int TotalFound,
    bool Truncated,
    string? TruncationReason)
{
    internal const string ReasonSearchBudget = "SearchBudget";
    internal const string ReasonTimeFuse = "TimeFuse";
}
