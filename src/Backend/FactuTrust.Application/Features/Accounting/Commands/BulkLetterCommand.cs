using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
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
/// renvoyer au service. Le rapport garde l'empreinte du contenu : le même <c>RequestId</c> avec une
/// autre sélection est refusé (<c>LETTERING_VALIDATION</c>). Un lot interrompu (annulation ou
/// erreur inattendue, groupes <c>NotProcessed</c>) n'est PAS gardé : un rejeu reprend le lot, et
/// les groupes déjà lettrés sortent en <c>AlreadyLettered</c>.
/// </para>
/// <para>
/// <b>Exclusion :</b> un même lot ne s'exécute qu'une fois à la fois (<c>TryAdd</c> atomique
/// dans un dictionnaire du processus, retiré dans un <c>finally</c>) ; un appel concurrent reçoit
/// <c>LETTERING_BULK_IN_PROGRESS</c>. Le cache et le verrou sont locaux au processus : la
/// correction reste garantie par les données (contrôle « déjà lettrée » en Serializable, index
/// unique), le verrou évite seulement un double travail.
/// </para>
/// <para>
/// <b>Erreur inattendue</b> (hors validation) sur un groupe : le groupe sort en
/// <c>Rejected / LETTERING_UNEXPECTED</c>, les suivants en <c>NotProcessed</c>, et l'audit de lot
/// est écrit quand même (<c>Aborted = true</c>) : les groupes déjà lettrés restent tracés.
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
        var fingerprint = Fingerprint(request.Groups);
        if (TryGetReport(key, fingerprint, out var replay))
            return replay;

        if (!RunningRequests.TryAdd(key, 0))
            return Result.Failure<BulkLetteringResultDto>(
                LetteringErrors.BulkInProgress("Ce lot de lettrage est déjà en cours de traitement."));

        try
        {
            // Second contrôle : le lot a pu se terminer entre la lecture du cache et le verrou.
            if (TryGetReport(key, fingerprint, out replay))
                return replay;

            var results = new List<BulkLetteringGroupResultDto>(request.Groups.Count);
            var aborted = false;
            foreach (var group in request.Groups)
            {
                if (aborted || cancellationToken.IsCancellationRequested)
                {
                    results.Add(new BulkLetteringGroupResultDto(
                        group.ClientKey, BulkLetteringStatuses.NotProcessed, null, null, null));
                    continue;
                }

                // CancellationToken.None : un groupe commencé va au bout (jamais à moitié fait).
                var (outcome, unexpected) = await LetterGroupAsync(request.RequestId, group);
                results.Add(outcome);
                aborted = unexpected;
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
                    request.RequestId,
                    report.Total,
                    report.Lettered,
                    report.AlreadyLettered,
                    report.Rejected,
                    report.NotProcessed,
                    Aborted = aborted,
                    Groups = results.Select(r => new { r.ClientKey, r.Status, r.Code, r.ErrorCode }).ToList()
                },
                cancellationToken: CancellationToken.None);

            _logger.LogInformation(
                "Lettrage en masse {RequestId} : {Total} groupes, {Lettered} lettrés, {AlreadyLettered} déjà lettrés, {Rejected} refusés, {NotProcessed} non traités, interrompu : {Aborted}.",
                request.RequestId, report.Total, report.Lettered, report.AlreadyLettered, report.Rejected, report.NotProcessed, aborted);

            // Un lot interrompu (annulation ou erreur inattendue) n'est pas gardé : le rejeu le reprend.
            if (!aborted && report.NotProcessed == 0)
                _cache.Set(key, new CachedReport(fingerprint, report),
                    new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = ReportRetention });

            return Result.Success(report);
        }
        finally
        {
            RunningRequests.TryRemove(key, out _);
        }
    }

    /// <summary>Rapport gardé et empreinte du contenu qui l'a produit.</summary>
    private sealed record CachedReport(string Fingerprint, BulkLetteringResultDto Report);

    /// <summary>
    /// Rapport gardé pour ce lot. Même <c>RequestId</c> avec un contenu différent → refus explicite
    /// (jamais l'ancien rapport : le client croirait la nouvelle sélection traitée).
    /// </summary>
    private bool TryGetReport(string key, string fingerprint, out Result<BulkLetteringResultDto> result)
    {
        result = default!;
        if (!_cache.TryGetValue(key, out CachedReport? cached) || cached is null)
            return false;

        result = cached.Fingerprint == fingerprint
            ? Result.Success(cached.Report)
            : Result.Failure<BulkLetteringResultDto>(LetteringErrors.Validation(
                "Cet identifiant de lot a déjà servi pour une autre sélection : relancez la confirmation."));
        return true;
    }

    /// <summary>Empreinte SHA-256 du contenu ordonné du lot (clés et identifiants de lignes).</summary>
    public static string Fingerprint(IReadOnlyList<BulkLetterGroup> groups)
    {
        var builder = new StringBuilder();
        foreach (var group in groups)
        {
            builder.Append(group.ClientKey).Append(':');
            foreach (var id in group.JournalEntryLineIds)
                builder.Append(id.ToString("N")).Append(',');
            builder.Append(';');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }

    /// <summary>
    /// Lettre un groupe. <c>Unexpected = true</c> quand le groupe a levé une erreur hors validation
    /// (base indisponible, audit en échec après validation…) : le lot s'arrête là.
    /// </summary>
    private async Task<(BulkLetteringGroupResultDto Outcome, bool Unexpected)> LetterGroupAsync(Guid requestId, BulkLetterGroup group)
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
            return (new BulkLetteringGroupResultDto(
                group.ClientKey, BulkLetteringStatuses.Rejected, null, LetteringErrorCodes.Validation, message), false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lettrage en masse {RequestId} : erreur inattendue sur le groupe {ClientKey}, lot interrompu.",
                requestId, group.ClientKey);
            return (await UnexpectedOutcomeAsync(group), true);
        }

        if (result.IsSuccess)
            return (new BulkLetteringGroupResultDto(
                group.ClientKey, BulkLetteringStatuses.Lettered, result.Value.Code, null, null), false);

        if (result.Error.Code == LetteringErrorCodes.AlreadyLettered
            && await ExistingGroupCodeAsync(group) is { } existing)
            return (new BulkLetteringGroupResultDto(
                group.ClientKey, BulkLetteringStatuses.AlreadyLettered, existing, null, null), false);

        return (new BulkLetteringGroupResultDto(
            group.ClientKey, BulkLetteringStatuses.Rejected, null, result.Error.Code, result.Error.Description), false);
    }

    /// <summary>
    /// Code du groupe de lettrage <b>définitif</b> dont les membres sont exactement les lignes
    /// demandées, sinon null. Un groupe plus large ou partiel n'est pas la proposition : la
    /// déclarer « déjà lettrée » ferait croire qu'elle a été appliquée telle quelle.
    /// </summary>
    private async Task<string?> ExistingGroupCodeAsync(BulkLetterGroup group)
    {
        var codes = await _queries.GetLineCodesAsync(group.JournalEntryLineIds, CancellationToken.None);
        var code = SharedCode(group, codes);
        if (code is null || code.StartsWith('P'))
            return null;

        var existing = await _queries.GetGroupAsync(code, CancellationToken.None);
        if (existing.IsFailure)
            return null;

        var members = existing.Value.Lines.Select(l => l.LineId).ToHashSet();
        return members.SetEquals(group.JournalEntryLineIds) ? code : null;
    }

    /// <summary>Code commun à toutes les lignes du groupe (null si une ligne est libre, inconnue ou d'un autre groupe).</summary>
    private static string? SharedCode(BulkLetterGroup group, IReadOnlyDictionary<Guid, string?> codes)
    {
        var distinct = group.JournalEntryLineIds
            .Select(id => codes.TryGetValue(id, out var c) ? c : null)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return distinct.Count == 1 && !string.IsNullOrEmpty(distinct[0]) ? distinct[0] : null;
    }

    /// <summary>
    /// Résultat d'un groupe en erreur inattendue : refusé avec <c>LETTERING_UNEXPECTED</c>. Si toutes
    /// ses lignes portent désormais un même code (erreur après l'écriture), ce code est renvoyé pour
    /// que l'utilisateur vérifie le groupe avant de le relancer.
    /// </summary>
    private async Task<BulkLetteringGroupResultDto> UnexpectedOutcomeAsync(BulkLetterGroup group)
    {
        string? code = null;
        try
        {
            code = SharedCode(group, await _queries.GetLineCodesAsync(group.JournalEntryLineIds, CancellationToken.None));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Lettrage en masse : état du groupe {ClientKey} illisible après l'erreur.", group.ClientKey);
        }

        return new BulkLetteringGroupResultDto(
            group.ClientKey, BulkLetteringStatuses.Rejected, code, LetteringErrorCodes.Unexpected,
            "Erreur inattendue : vérifiez l'état de ce groupe avant de le relancer.");
    }
}
