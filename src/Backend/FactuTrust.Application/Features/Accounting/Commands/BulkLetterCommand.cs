using System.Collections.Concurrent;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Application.Features.Accounting.Commands;

/// <summary>
/// Lettrage en masse de propositions confirmées (plan v2, Phase 3, annexe C §4). Une transaction
/// par groupe, succès partiel rapporté groupe par groupe (voir <see cref="BulkLetterCommandHandler"/>).
/// </summary>
/// <param name="RequestId">Guid généré par le client à l'ouverture de la confirmation (idempotence).</param>
/// <param name="Groups">Groupes à lettrer, traités séquentiellement dans l'ordre reçu.</param>
/// <remarks>
/// Aucun champ d'origine, de partiel ni d'écart de change : le handler force
/// <c>Origin = Bulk</c>, <c>AllowPartial = false</c> et <c>RequireNoExchangeDifference = true</c>.
/// </remarks>
public sealed record BulkLetterCommand(
    Guid RequestId,
    IReadOnlyList<BulkLetterGroup> Groups) : IRequest<Result<BulkLetteringResultDto>>;

/// <summary>Un groupe d'un lot : la clé de la proposition et ses lignes.</summary>
public sealed record BulkLetterGroup(string ClientKey, IReadOnlyList<Guid> JournalEntryLineIds);

/// <summary>
/// Lettre les groupes d'un lot <b>un par un</b>, chacun par la commande standard
/// <see cref="LetterAccountEntriesCommand"/> (validation, transaction Serializable, audit
/// « Lettered » par groupe), avec <c>Origin = Bulk</c>, <c>AllowPartial = false</c> et
/// <c>RequireNoExchangeDifference = true</c>. Un groupe refusé n'arrête pas le lot.
/// </summary>
/// <remarks>
/// <para>
/// <b>Idempotence :</b> le rapport d'un lot terminé est gardé 15 minutes sous la clé
/// <c>bulk-letter:{TenantId}:{UserId}:{RequestId}</c> ; un rejeu renvoie ce rapport sans rien
/// renvoyer au service. Un lot interrompu (groupes <c>NotProcessed</c>) n'est PAS gardé : un
/// rejeu reprend le lot, et les groupes déjà lettrés sortent en <c>AlreadyLettered</c>.
/// </para>
/// <para>
/// <b>Exclusion :</b> un même lot ne s'exécute qu'une fois à la fois (<c>TryAdd</c> atomique
/// dans un dictionnaire du processus, retiré dans un <c>finally</c>) ; un appel concurrent reçoit
/// <c>LETTERING_BULK_IN_PROGRESS</c>. Le cache et le verrou sont locaux au processus : la
/// correction reste garantie par les données (contrôle « déjà lettrée » en Serializable, index
/// unique), le verrou évite seulement un double travail.
/// </para>
/// </remarks>
public sealed class BulkLetterCommandHandler : IRequestHandler<BulkLetterCommand, Result<BulkLetteringResultDto>>
{
    /// <summary>Durée de conservation du rapport d'un lot terminé (rejeu idempotent).</summary>
    public static readonly TimeSpan ReportRetention = TimeSpan.FromMinutes(15);

    private static readonly ConcurrentDictionary<string, byte> RunningRequests = new(StringComparer.Ordinal);

    private readonly ISender _sender;
    private readonly ILetteringQueryService _queries;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IAmbientTransactionState _ambient;
    private readonly IMemoryCache _cache;
    private readonly AccountingSettings _settings;
    private readonly ILogger<BulkLetterCommandHandler> _logger;

    public BulkLetterCommandHandler(
        ISender sender,
        ILetteringQueryService queries,
        IAuditService audit,
        ICurrentUser currentUser,
        IAmbientTransactionState ambient,
        IMemoryCache cache,
        IOptions<AccountingSettings> settings,
        ILogger<BulkLetterCommandHandler> logger)
    {
        _sender = sender;
        _queries = queries;
        _audit = audit;
        _currentUser = currentUser;
        _ambient = ambient;
        _cache = cache;
        _settings = settings.Value;
        _logger = logger;
    }

    /// <summary>Clé de cache du rapport d'un lot (cloisonnée par société et par utilisateur).</summary>
    public static string ReportCacheKey(Guid tenantId, Guid userId, Guid requestId) =>
        $"bulk-letter:{tenantId:N}:{userId:N}:{requestId:N}";

    public async Task<Result<BulkLetteringResultDto>> Handle(BulkLetterCommand request, CancellationToken cancellationToken)
    {
        if (!_settings.LetteringSuggestionsEnabled)
            return Result.Failure<BulkLetteringResultDto>(
                LetteringErrors.FeatureDisabled("Les propositions de lettrage ne sont pas activées."));

        // Une transaction englobante absorberait chaque groupe : un échec tardif annulerait tout le
        // lot alors que le rapport annoncerait des groupes lettrés.
        if (_ambient.IsActive)
            return Result.Failure<BulkLetteringResultDto>(
                LetteringErrors.Validation("Lettrage en masse impossible dans une transaction en cours."));

        if (_currentUser.TenantId is not { } tenantId || _currentUser.UserId is not { } userId)
            return Result.Failure<BulkLetteringResultDto>(
                LetteringErrors.Validation("Utilisateur ou société non identifié."));

        var key = ReportCacheKey(tenantId, userId, request.RequestId);
        if (_cache.TryGetValue(key, out BulkLetteringResultDto? cached) && cached is not null)
            return Result.Success(cached);

        if (!RunningRequests.TryAdd(key, 0))
            return Result.Failure<BulkLetteringResultDto>(
                LetteringErrors.BulkInProgress("Ce lot de lettrage est déjà en cours de traitement."));

        try
        {
            // Second contrôle : le lot a pu se terminer entre la lecture du cache et le verrou.
            if (_cache.TryGetValue(key, out cached) && cached is not null)
                return Result.Success(cached);

            var results = new List<BulkLetteringGroupResultDto>(request.Groups.Count);
            foreach (var group in request.Groups)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    results.Add(new BulkLetteringGroupResultDto(
                        group.ClientKey, BulkLetteringStatuses.NotProcessed, null, null, null));
                    continue;
                }

                // CancellationToken.None : un groupe commencé va au bout (jamais à moitié fait).
                results.Add(await LetterGroupAsync(request.RequestId, group));
            }

            var report = new BulkLetteringResultDto(
                request.RequestId,
                Total: results.Count,
                Lettered: results.Count(r => r.Status == BulkLetteringStatuses.Lettered),
                AlreadyLettered: results.Count(r => r.Status == BulkLetteringStatuses.AlreadyLettered),
                Rejected: results.Count(r => r.Status == BulkLetteringStatuses.Rejected),
                NotProcessed: results.Count(r => r.Status == BulkLetteringStatuses.NotProcessed),
                Results: results);

            await _audit.LogAsync(
                AuditActions.Accounting.LetteredBulk,
                "LetteringBulk",
                entityId: request.RequestId,
                newValues: new
                {
                    report.Total,
                    report.Lettered,
                    report.AlreadyLettered,
                    report.Rejected,
                    report.NotProcessed,
                    Groups = results.Select(r => new { r.ClientKey, r.Status, r.Code, r.ErrorCode }).ToList()
                },
                cancellationToken: CancellationToken.None);

            _logger.LogInformation(
                "Lettrage en masse {RequestId} : {Total} groupes, {Lettered} lettrés, {AlreadyLettered} déjà lettrés, {Rejected} refusés, {NotProcessed} non traités.",
                request.RequestId, report.Total, report.Lettered, report.AlreadyLettered, report.Rejected, report.NotProcessed);

            if (report.NotProcessed == 0)
                _cache.Set(key, report, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = ReportRetention });

            return Result.Success(report);
        }
        finally
        {
            RunningRequests.TryRemove(key, out _);
        }
    }

    private async Task<BulkLetteringGroupResultDto> LetterGroupAsync(Guid requestId, BulkLetterGroup group)
    {
        Result<LetteringResultDto> result;
        try
        {
            result = await _sender.Send(
                new LetterAccountEntriesCommand(
                    group.JournalEntryLineIds,
                    AllowPartial: false,
                    Origin: LetteringOrigin.Bulk,
                    SuggestionKey: group.ClientKey,
                    RequireNoExchangeDifference: true,
                    BulkRequestId: requestId),
                CancellationToken.None);
        }
        catch (ValidationException ex)
        {
            var message = string.Join(" ", ex.Errors.Select(e => e.ErrorMessage).Distinct());
            return new BulkLetteringGroupResultDto(
                group.ClientKey, BulkLetteringStatuses.Rejected, null, LetteringErrorCodes.Validation, message);
        }

        if (result.IsSuccess)
            return new BulkLetteringGroupResultDto(
                group.ClientKey, BulkLetteringStatuses.Lettered, result.Value.Code, null, null);

        if (result.Error.Code == LetteringErrorCodes.AlreadyLettered)
        {
            var codes = await _queries.GetLineCodesAsync(group.JournalEntryLineIds, CancellationToken.None);
            var distinct = group.JournalEntryLineIds
                .Select(id => codes.TryGetValue(id, out var c) ? c : null)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (distinct.Count == 1 && !string.IsNullOrEmpty(distinct[0]))
                return new BulkLetteringGroupResultDto(
                    group.ClientKey, BulkLetteringStatuses.AlreadyLettered, distinct[0], null, null);
        }

        return new BulkLetteringGroupResultDto(
            group.ClientKey, BulkLetteringStatuses.Rejected, null, result.Error.Code, result.Error.Description);
    }
}
