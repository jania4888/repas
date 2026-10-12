using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Propositions de lettrage (plan v2, Phase 3, annexe C §2). Lecture seule : aucune écriture, aucun
/// stockage. La validation d'une proposition passe par le lettrage standard (<c>POST letter</c>).
/// </summary>
public interface ILetteringSuggestionService
{
    /// <summary>
    /// Calcule les propositions pour le filtre de l'écran. Les filtres d'état et de sens sont ignorés.
    /// </summary>
    /// <param name="filter">Filtre de l'écran (compte et période obligatoires, validés en amont).</param>
    /// <param name="maxResults">Nombre maximal de propositions renvoyées, borné à <c>MaxSuggestions</c>.</param>
    /// <param name="cancellationToken">Annulation du client : elle est propagée normalement.</param>
    /// <returns>
    /// <c>LETTERING_FEATURE_DISABLED</c> si la fonction n'est pas activée ; sinon le résultat, marqué
    /// tronqué si le plafond de candidats, le budget de recherche ou le fusible de temps l'a limité.
    /// </returns>
    Task<Result<LetteringSuggestionsResultDto>> SuggestAsync(
        GetLetteringLinesQuery filter, int maxResults, CancellationToken cancellationToken = default);
}
