using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Lettering;

/// <summary>
/// Requête de <c>GET api/accounting/lettering/suggestions</c> (plan v2, Phase 3, annexe C §3).
/// <see cref="Filter"/> reprend les filtres de <c>lettering/lines</c> ; l'état, le sens et la pagination
/// sont ignorés par le moteur.
/// </summary>
public sealed record GetLetteringSuggestionsQuery(GetLetteringLinesQuery Filter, int MaxResults = 50)
    : IRequest<Result<LetteringSuggestionsResultDto>>;

/// <summary>
/// Vérifie le drapeau <c>LetteringSuggestionsEnabled</c> avant tout calcul, puis délègue au service.
/// Drapeau éteint → <c>LETTERING_FEATURE_DISABLED</c> (400).
/// </summary>
public sealed class GetLetteringSuggestionsQueryHandler
    : IRequestHandler<GetLetteringSuggestionsQuery, Result<LetteringSuggestionsResultDto>>
{
    private readonly ILetteringSuggestionService _suggestions;
    private readonly AccountingSettings _settings;

    public GetLetteringSuggestionsQueryHandler(ILetteringSuggestionService suggestions, IOptions<AccountingSettings> settings)
    {
        _suggestions = suggestions;
        _settings = settings.Value;
    }

    public Task<Result<LetteringSuggestionsResultDto>> Handle(
        GetLetteringSuggestionsQuery request, CancellationToken cancellationToken)
    {
        if (!_settings.LetteringSuggestionsEnabled)
            return Task.FromResult(Result.Failure<LetteringSuggestionsResultDto>(
                LetteringErrors.FeatureDisabled("Les propositions de lettrage ne sont pas activées.")));

        return _suggestions.SuggestAsync(request.Filter, request.MaxResults, cancellationToken);
    }
}
