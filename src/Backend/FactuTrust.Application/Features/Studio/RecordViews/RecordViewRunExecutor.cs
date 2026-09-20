using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.RecordViews;

/// <summary>
/// Exécution d'une définition de vue (dispatch par mode : liste paginée, kanban groupé en mémoire,
/// calendrier à fenêtre bornée). Extraite de <see cref="RunCustomRecordViewQueryHandler"/> en 4.7v1
/// (D-47-21) pour être partagée avec l'aperçu du concepteur (<see cref="PreviewCustomRecordViewQueryHandler"/>)
/// — extraction 1:1, sans changement de comportement (les faits du run passent inchangés).
/// Statique, sans inscription DI (motif <c>RecordQuerySql</c>, <c>StudioWorkflowInstanceDetailBuilder</c>).
/// </summary>
internal static class RecordViewRunExecutor
{
    /// <summary>
    /// Exécute la définition selon <paramref name="mode"/>. <paramref name="page"/>/<paramref name="pageSize"/>
    /// (liste) et <paramref name="rangeStart"/>/<paramref name="rangeEnd"/> (calendrier, obligatoires et
    /// bornés à 92 jours) sont supposés déjà validés par l'appelant — la borne pageSize 1..200 et la
    /// validation de la définition restent dans les handlers.
    /// </summary>
    public static Task<Result<RecordViewRunResultDto>> ExecuteAsync(
        ICustomRecordRepository records,
        OllamaSettings settings,
        Guid tenantId,
        Guid entityId,
        CustomRecordViewMode mode,
        RecordViewDefinition definition,
        IReadOnlyList<RecordViewFilter> filters,
        string? search,
        IReadOnlyList<string> searchableKeys,
        IReadOnlyDictionary<string, CustomFieldDefinition> fieldsByKey,
        IReadOnlyDictionary<string, CustomFieldType> fieldTypes,
        int page,
        int pageSize,
        DateOnly? rangeStart,
        DateOnly? rangeEnd,
        CancellationToken cancellationToken) =>
        mode switch
        {
            CustomRecordViewMode.Kanban => RunKanban(records, settings, tenantId, entityId, definition, filters, search, searchableKeys, fieldTypes, fieldsByKey[definition.Kanban!.GroupByFieldKey], cancellationToken),
            CustomRecordViewMode.Calendar => RunCalendar(records, settings, tenantId, entityId, definition, rangeStart, rangeEnd, filters, search, searchableKeys, fieldTypes, cancellationToken),
            _ => RunList(records, tenantId, entityId, definition, page, pageSize, filters, search, searchableKeys, fieldTypes, cancellationToken)
        };

    /// <summary>
    /// Construit le <see cref="RecordQuerySpec"/> et exécute la requête. L'ensemble des clés indexées
    /// part vide : il est résolu par le dépôt (Infrastructure), seul endroit où le seek jx_ est décidé.
    /// </summary>
    private static Task<(IReadOnlyList<CustomRecord> Items, int Total)> QueryRecordsAsync(
        ICustomRecordRepository records,
        Guid tenantId, Guid entityId, IReadOnlyList<RecordViewFilter> filters, IReadOnlyList<RecordViewSort> sort,
        string? search, IReadOnlyList<string> searchableKeys, int skip, int take,
        IReadOnlyDictionary<string, CustomFieldType> fieldTypes, CancellationToken cancellationToken) =>
        records.QueryAsync(
            new RecordQuerySpec(tenantId, entityId, filters, sort, search, searchableKeys, skip, take,
                new HashSet<string>(StringComparer.Ordinal)),
            fieldTypes, cancellationToken);

    // ---- Liste paginée ----

    private static async Task<Result<RecordViewRunResultDto>> RunList(
        ICustomRecordRepository records,
        Guid tenantId, Guid entityId, RecordViewDefinition definition,
        int page, int pageSize, IReadOnlyList<RecordViewFilter> filters, string? search,
        IReadOnlyList<string> searchableKeys,
        IReadOnlyDictionary<string, CustomFieldType> fieldTypes, CancellationToken cancellationToken)
    {
        var (items, total) = await QueryRecordsAsync(records,
            tenantId, entityId, filters, definition.Sort, search, searchableKeys,
            (page - 1) * pageSize, pageSize, fieldTypes, cancellationToken);
        var dtos = items.Select(StudioMappers.ToDto).ToList();

        return Result.Success(new RecordViewRunResultDto(
            CustomRecordViewMode.List, dtos, total, page, pageSize, null, null, Truncated: false));
    }

    // ---- Kanban (groupé en mémoire) ----

    private static async Task<Result<RecordViewRunResultDto>> RunKanban(
        ICustomRecordRepository records, OllamaSettings settings,
        Guid tenantId, Guid entityId, RecordViewDefinition definition,
        IReadOnlyList<RecordViewFilter> filters, string? search,
        IReadOnlyList<string> searchableKeys,
        IReadOnlyDictionary<string, CustomFieldType> fieldTypes, CustomFieldDefinition groupField,
        CancellationToken cancellationToken)
    {
        var kanban = definition.Kanban!;
        var maxCards = settings.StudioRecordViewMaxKanbanCards;
        var options = StudioFieldJson.ParseOptions(groupField.OptionsJson) ?? Array.Empty<SelectOptionDto>();

        // Ordre des colonnes : ColumnOrder si fourni (filtré aux options connues), sinon ordre des options.
        // Un ColumnOrder PARTIEL est complété par les options manquantes — sinon leurs fiches
        // tomberaient à tort dans « Sans valeur » (option ajoutée au champ après l'enregistrement de la vue).
        var optionValues = options.Select(o => o.Value).ToList();
        List<string> columnOrder;
        if (kanban.ColumnOrder is { Count: > 0 })
        {
            columnOrder = kanban.ColumnOrder.Where(v => optionValues.Contains(v, StringComparer.Ordinal)).ToList();
            columnOrder.AddRange(optionValues.Where(v => !columnOrder.Contains(v, StringComparer.Ordinal)));
        }
        else
        {
            columnOrder = optionValues;
        }
        var labelByValue = options.ToDictionary(o => o.Value, o => o.Label, StringComparer.Ordinal);

        // Tri : groupe d'abord (pour un regroupement stable), puis les tris de la vue.
        var sort = new List<RecordViewSort> { new(kanban.GroupByFieldKey) };
        sort.AddRange(definition.Sort.Where(s => !string.Equals(s.FieldKey, kanban.GroupByFieldKey, StringComparison.Ordinal)));

        var (items, total) = await QueryRecordsAsync(records,
            tenantId, entityId, filters, sort, search, searchableKeys, 0, maxCards, fieldTypes, cancellationToken);
        var truncated = total > maxCards;

        // Regroupement en mémoire, dans l'ordre des colonnes décidé.
        var buckets = new Dictionary<string, List<CustomRecordDto>>(StringComparer.Ordinal);
        foreach (var v in columnOrder)
            buckets[v] = new List<CustomRecordDto>();
        var sansValeur = new List<CustomRecordDto>();

        foreach (var record in items)
        {
            var value = ReadScalar(ParseJson(record.DataJson), kanban.GroupByFieldKey);
            if (value is not null && buckets.TryGetValue(value, out var bucket))
                bucket.Add(StudioMappers.ToDto(record));
            else if (kanban.ShowEmptyGroup)
                // Valeur absente ou hors options (donnée orpheline) : « Sans valeur » si le groupe est prévu.
                sansValeur.Add(StudioMappers.ToDto(record));
        }

        var groups = new List<RecordViewKanbanGroupDto>();
        foreach (var value in columnOrder)
        {
            var bucket = buckets[value];
            if (bucket.Count == 0 && !kanban.ShowEmptyGroup)
                continue;
            groups.Add(new RecordViewKanbanGroupDto(value, labelByValue.GetValueOrDefault(value, value), bucket.Count, bucket));
        }
        if (sansValeur.Count > 0)
            groups.Add(new RecordViewKanbanGroupDto(null, "Sans valeur", sansValeur.Count, sansValeur));

        return Result.Success(new RecordViewRunResultDto(
            CustomRecordViewMode.Kanban, Array.Empty<CustomRecordDto>(), total, 1, maxCards, groups, null, truncated));
    }

    // ---- Calendrier (fenêtre bornée) ----

    private static async Task<Result<RecordViewRunResultDto>> RunCalendar(
        ICustomRecordRepository records, OllamaSettings settings,
        Guid tenantId, Guid entityId, RecordViewDefinition definition,
        DateOnly? rangeStart, DateOnly? rangeEnd, IReadOnlyList<RecordViewFilter> filters, string? search,
        IReadOnlyList<string> searchableKeys,
        IReadOnlyDictionary<string, CustomFieldType> fieldTypes, CancellationToken cancellationToken)
    {
        var calendar = definition.Calendar!;
        var maxEvents = settings.StudioRecordViewMaxCalendarEvents;

        // Fenêtre obligatoire, ≤ 92 jours.
        if (rangeStart is null || rangeEnd is null)
            return Result.Failure<RecordViewRunResultDto>(
                Error.Validation("range", "Une vue Calendrier exige « rangeStart » et « rangeEnd »."));
        if (rangeEnd.Value < rangeStart.Value)
            return Result.Failure<RecordViewRunResultDto>(
                Error.Validation("range", "« rangeEnd » doit être postérieur ou égal à « rangeStart »."));
        if (rangeEnd.Value.DayNumber - rangeStart.Value.DayNumber > 92)
            return Result.Failure<RecordViewRunResultDto>(
                Error.Validation("range", "La fenêtre d'une vue Calendrier ne peut dépasser 92 jours."));

        // Fenêtre ajoutée sur le champ de début : gte rangeStart + lt rangeEnd+1 jour (borne haute
        // EXCLUSIVE — un `between 'yyyy-MM-dd' AND 'yyyy-MM-dd'` coupe à minuit et perdrait les
        // enregistrements DateTime du dernier jour).
        var rangeFilters = filters.ToList();
        rangeFilters.Add(new RecordViewFilter(
            calendar.StartFieldKey, "gte", JsonValue.Create(rangeStart.Value.ToString("yyyy-MM-dd"))));
        rangeFilters.Add(new RecordViewFilter(
            calendar.StartFieldKey, "lt", JsonValue.Create(rangeEnd.Value.AddDays(1).ToString("yyyy-MM-dd"))));

        var (items, total) = await QueryRecordsAsync(records,
            tenantId, entityId, rangeFilters, new List<RecordViewSort> { new(calendar.StartFieldKey) },
            search, searchableKeys, 0, maxEvents, fieldTypes, cancellationToken);
        var truncated = total > maxEvents;

        var events = new List<RecordViewCalendarEventDto>(items.Count);
        foreach (var record in items)
        {
            var json = ParseJson(record.DataJson); // un seul parse par enregistrement
            if (!DateTime.TryParse(ReadScalar(json, calendar.StartFieldKey), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var start))
                continue; // ligne sans date exploitable : ignorée (le filtre between l'a normalement écartée).

            DateTime? end = null;
            if (!string.IsNullOrWhiteSpace(calendar.EndFieldKey)
                && DateTime.TryParse(ReadScalar(json, calendar.EndFieldKey), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var endValue))
                end = endValue;

            var title = !string.IsNullOrWhiteSpace(calendar.TitleFieldKey)
                ? ReadScalar(json, calendar.TitleFieldKey)
                : null;
            if (string.IsNullOrWhiteSpace(title))
                title = $"#{record.Id.ToString()[..8]}";

            var color = !string.IsNullOrWhiteSpace(calendar.ColorFieldKey)
                ? ReadScalar(json, calendar.ColorFieldKey)
                : null;

            events.Add(new RecordViewCalendarEventDto(record.Id, title, start, end, color));
        }

        return Result.Success(new RecordViewRunResultDto(
            CustomRecordViewMode.Calendar, Array.Empty<CustomRecordDto>(), total, 1, maxEvents, null, events, truncated));
    }

    /// <summary>Parse le JSON d'un enregistrement en objet ; null s'il est absent ou corrompu.</summary>
    private static JsonObject? ParseJson(string dataJson)
    {
        try { return JsonNode.Parse(dataJson) as JsonObject; }
        catch (JsonException) { return null; }
    }

    /// <summary>Lit une valeur scalaire (string) d'un champ dans le JSON d'un enregistrement ; null si absente.</summary>
    private static string? ReadScalar(JsonObject? json, string fieldKey)
    {
        if (json is null || !json.TryGetPropertyValue(fieldKey, out var node) || node is null)
            return null;
        if (node is JsonValue v)
        {
            if (v.TryGetValue<string>(out var s)) return s;
            if (v.TryGetValue<bool>(out var b)) return b ? "true" : "false";
            if (v.TryGetValue<decimal>(out var d)) return d.ToString(CultureInfo.InvariantCulture);
        }
        return node.ToJsonString();
    }
}
