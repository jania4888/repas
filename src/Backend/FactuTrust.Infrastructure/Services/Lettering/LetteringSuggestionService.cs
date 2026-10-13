using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Propositions de lettrage (plan v2, Phase 3, annexe C §2-3) : charge les candidats
/// (<see cref="LetteringCandidateLoader"/>), lance le moteur pur (<see cref="LetteringSuggestionEngine"/>)
/// sous un fusible de temps, puis projette le résultat en DTO. Lecture seule, rien n'est stocké.
/// </summary>
/// <remarks>
/// <para>
/// Le drapeau <c>LetteringSuggestionsEnabled</c> est vérifié ici aussi (défense en profondeur : le
/// handler HTTP le vérifie déjà). Drapeau éteint → <c>LETTERING_FEATURE_DISABLED</c>, sans lecture.
/// </para>
/// <para>
/// Fusible : une source liée au jeton du client, annulée après <c>TimeFuseMilliseconds</c>, est donnée
/// au moteur seulement (le chargement suit le jeton du client). S'il se déclenche, le résultat est
/// partiel et marqué <c>TimeFuse</c> ; c'est journalisé. Une annulation du client reste une
/// <see cref="OperationCanceledException"/>.
/// </para>
/// <para>
/// Priorité des raisons de troncature : <c>TimeFuse</c> (seul cas non déterministe), puis
/// <c>CandidateCap</c> (des lignes n'ont pas été lues), puis <c>SearchBudget</c>.
/// </para>
/// </remarks>
public sealed class LetteringSuggestionService : ILetteringSuggestionService
{
    internal const string ReasonCandidateCap = "CandidateCap";

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly AccountingSettings _settings;
    private readonly ILogger<LetteringSuggestionService> _logger;
    private readonly TimeProvider _timeProvider;

    public LetteringSuggestionService(
        ITenantDbContextFactory contextFactory,
        IOptions<AccountingSettings> settings,
        ILogger<LetteringSuggestionService> logger,
        TimeProvider timeProvider)
    {
        _contextFactory = contextFactory;
        _settings = settings.Value;
        _logger = logger;
        _timeProvider = timeProvider;
    }

    public async Task<Result<LetteringSuggestionsResultDto>> SuggestAsync(
        GetLetteringLinesQuery filter, int maxResults, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filter);

        if (!_settings.LetteringSuggestionsEnabled)
            return Result.Failure<LetteringSuggestionsResultDto>(
                LetteringErrors.FeatureDisabled("Les propositions de lettrage ne sont pas activées."));

        var settings = _settings.LetteringSuggestions.Clamped();
        var limit = Math.Clamp(maxResults, 1, settings.MaxSuggestions);
        var options = LetteringEngineOptions.From(settings) with { MaxSuggestions = limit };
        var started = _timeProvider.GetTimestamp();

        await using var ctx = _contextFactory.CreateContext();
        var loaded = await LetteringCandidateLoader.LoadAsync(ctx, filter, settings.MaxCandidateLines, cancellationToken);

        LetteringEngineOutput output;
        using (var fuse = new CancellationTokenSource(TimeSpan.FromMilliseconds(settings.TimeFuseMilliseconds), _timeProvider))
        using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, fuse.Token))
        {
            output = LetteringSuggestionEngine.Run(loaded.Candidates, loaded.Links, options, linked.Token);
        }
        cancellationToken.ThrowIfCancellationRequested();

        var reason = TruncationReason(output, loaded.Truncated);
        if (reason == LetteringEngineOutput.ReasonTimeFuse)
        {
            _logger.LogWarning(
                "Propositions de lettrage : fusible de {FuseMs} ms déclenché (compte {Account}, {Candidates} candidats, {Found} propositions). Résultat partiel.",
                settings.TimeFuseMilliseconds, filter.Account, loaded.Candidates.Count, output.TotalFound);
        }

        var names = await LetteringThirdPartyNames.ResolveAsync(
            ctx, output.Suggestions.Select(s => (s.ThirdPartyId, s.ThirdPartyKind)), cancellationToken);

        var suggestions = output.Suggestions
            .Select(s => ToDto(s, names, settings.BulkMaxLinesPerGroup))
            .ToList();

        _logger.LogInformation(
            "Propositions de lettrage : compte {Account}, {Candidates} candidats, {Found} trouvées, {Returned} renvoyées, troncature {Reason}, {ElapsedMs} ms.",
            filter.Account, loaded.Candidates.Count, output.TotalFound, suggestions.Count, reason ?? "aucune",
            (long)_timeProvider.GetElapsedTime(started).TotalMilliseconds);

        return Result.Success(new LetteringSuggestionsResultDto(
            suggestions,
            output.TotalFound,
            suggestions.Count,
            loaded.Candidates.Count,
            reason is not null,
            reason,
            _timeProvider.GetUtcNow().UtcDateTime));
    }

    internal static string? TruncationReason(LetteringEngineOutput output, bool candidateCapReached)
    {
        if (output.TruncationReason == LetteringEngineOutput.ReasonTimeFuse)
            return LetteringEngineOutput.ReasonTimeFuse;
        if (candidateCapReached)
            return ReasonCandidateCap;
        return output.TruncationReason;
    }

    internal static LetteringSuggestionDto ToDto(
        EngineSuggestion s,
        IReadOnlyDictionary<(Domain.Enums.ThirdPartyKind, Guid), string> names,
        int bulkMaxLinesPerGroup)
    {
        string? name = null;
        if (s.ThirdPartyId is { } id)
            names.TryGetValue((s.ThirdPartyKind, id), out name);

        var debits = new List<LetteringSuggestionLineDto>();
        var credits = new List<LetteringSuggestionLineDto>();
        foreach (var line in s.Lines)
            (line.SignedForBalance > 0 ? debits : credits).Add(ToLineDto(line));

        return new LetteringSuggestionDto(
            s.Key,
            s.Kind.ToString(),
            s.Category.ToString(),
            s.Score,
            s.Confidence.ToString(),
            s.AccountNumber,
            s.CurrencyCode,
            s.ThirdPartyId,
            (int)s.ThirdPartyKind,
            name,
            debits,
            credits,
            FromMillimes(s.TotalMillimesOp),
            FromMillimes(s.LocalGapMillimes),
            s.HasExchangeDifference,
            !s.HasExchangeDifference && s.Lines.Count <= bulkMaxLinesPerGroup,
            s.Reasons.Select(r => new LetteringSuggestionReasonDto(r.Code, r.Args)).ToList());
    }

    private static LetteringSuggestionLineDto ToLineDto(LetteringCandidate c)
    {
        var foreign = c.CurrencyCode != Money.DefaultCurrency;
        return new LetteringSuggestionLineDto(
            c.LineId, c.EntryId, c.EntryDate, c.JournalCode, c.EntryNumber, c.PieceRef, c.Label,
            FromMillimes(Math.Max(c.SignedMillimesLocal, 0)),
            FromMillimes(Math.Max(-c.SignedMillimesLocal, 0)),
            foreign ? FromMillimes(Math.Max(c.SignedMillimesOp, 0)) : 0m,
            foreign ? FromMillimes(Math.Max(-c.SignedMillimesOp, 0)) : 0m);
    }

    internal static decimal FromMillimes(long millimes) => millimes / 1000m;
}
