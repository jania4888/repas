using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Records;

/// <summary>
/// Historique paginé d'un enregistrement (Studio 4.7 « v1.1 » — D5), le plus récent d'abord.
/// Entité introuvable/inactive ⇒ erreur de validation (400) ; enregistrement inconnu ⇒ 404.
/// Garde <c>custom_records:read</c> côté handler (défense en profondeur : données d'audit).
/// </summary>
public sealed record ListCustomRecordHistoryQuery(string EntityKey, Guid RecordId, int Page = 1, int PageSize = 20)
    : IRequest<Result<PagedResult<RecordHistoryEntryDto>>>;

public sealed class ListCustomRecordHistoryQueryHandler
    : IRequestHandler<ListCustomRecordHistoryQuery, Result<PagedResult<RecordHistoryEntryDto>>>
{
    /// <summary>Valeurs de changement tronquées à cette longueur (une cellule de tableau reste lisible).</summary>
    internal const int MaxValueLength = 200;

    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordRepository _records;
    private readonly IAuditLogQueryService _auditQuery;
    private readonly IStudioUserNameResolver _userNames;
    private readonly ICurrentUser _currentUser;

    public ListCustomRecordHistoryQueryHandler(
        ICustomEntityRepository entities,
        ICustomRecordRepository records,
        IAuditLogQueryService auditQuery,
        IStudioUserNameResolver userNames,
        ICurrentUser currentUser)
    {
        _entities = entities;
        _records = records;
        _auditQuery = auditQuery;
        _userNames = userNames;
        _currentUser = currentUser;
    }

    public async Task<Result<PagedResult<RecordHistoryEntryDto>>> Handle(
        ListCustomRecordHistoryQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<PagedResult<RecordHistoryEntryDto>>(err);
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<PagedResult<RecordHistoryEntryDto>>(
                Error.Unauthorized("Lecture des enregistrements requise."));

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, request.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<PagedResult<RecordHistoryEntryDto>>(resolveError);

        var record = await _records.GetAsync(tenantId, entity.Id, request.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<PagedResult<RecordHistoryEntryDto>>(Error.NotFound("CustomRecord", request.RecordId));

        var rows = await _auditQuery.GetEntityHistoryAsync(
            StudioRecordAudit.EntityType, request.RecordId, request.Page, request.PageSize, cancellationToken);
        if (rows.IsFailure)
            return Result.Failure<PagedResult<RecordHistoryEntryDto>>(rows.Error);

        var userIds = rows.Value.Items.Select(r => r.UserId).OfType<Guid>().Distinct().ToArray();
        var names = userIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await _userNames.GetDisplayNamesAsync(tenantId, userIds, cancellationToken);

        var entries = rows.Value.Items.Select(row => new RecordHistoryEntryDto(
            row.Id,
            row.Action,
            row.CreatedAt,
            row.UserId is Guid uid && names.TryGetValue(uid, out var name) ? name : null,
            BuildChanges(row.OldValues, row.NewValues))).ToList();

        return Result.Success(PagedResult<RecordHistoryEntryDto>.Create(
            entries, rows.Value.Page, rows.Value.PageSize, rows.Value.TotalCount));
    }

    /// <summary>
    /// Union triée (ordinal) des clés de premier niveau des deux documents ; chaque valeur en texte
    /// (chaîne telle quelle, autre kind en JSON brut), tronquée à <see cref="MaxValueLength"/>.
    /// JSON illisible ou non-objet ⇒ document vide (l'entrée reste listée, sans changements).
    /// </summary>
    internal static IReadOnlyList<RecordHistoryChangeDto> BuildChanges(string? oldJson, string? newJson)
    {
        var oldMap = ParseFlat(oldJson);
        var newMap = ParseFlat(newJson);
        var keys = new SortedSet<string>(StringComparer.Ordinal);
        keys.UnionWith(oldMap.Keys);
        keys.UnionWith(newMap.Keys);

        var changes = new List<RecordHistoryChangeDto>(keys.Count);
        foreach (var key in keys)
        {
            oldMap.TryGetValue(key, out var oldValue);
            newMap.TryGetValue(key, out var newValue);
            changes.Add(new RecordHistoryChangeDto(key, Truncate(oldValue), Truncate(newValue)));
        }
        return changes;
    }

    private static Dictionary<string, string?> ParseFlat(string? json)
    {
        var map = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json))
            return map;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return map;
            foreach (var property in doc.RootElement.EnumerateObject())
            {
                map[property.Name] = property.Value.ValueKind switch
                {
                    JsonValueKind.String => property.Value.GetString(),
                    JsonValueKind.Null or JsonValueKind.Undefined => null,
                    _ => property.Value.GetRawText()
                };
            }
            return map;
        }
        catch (JsonException)
        {
            return new Dictionary<string, string?>(StringComparer.Ordinal);
        }
    }

    private static string? Truncate(string? value) =>
        value is { Length: > MaxValueLength } ? value[..MaxValueLength] : value;
}
