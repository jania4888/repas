using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Caching.Memory;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Digests de contexte Studio injectés dans le prompt StudioBuilder (PR 1.2). Métadonnées de schéma
/// uniquement — jamais de valeurs d'enregistrements. Toutes les lectures sont SÉQUENTIELLES (chaque
/// dépôt ouvre son propre DbContext tenant : le séquentiel évite d'ouvrir jusqu'à 50 connexions en
/// rafale sur le chemin critique d'un tour de chat) et bornées : au plus <see cref="MaxEntities"/>
/// tables, une lecture de champs par table, le tout mis en cache <see cref="CacheTtl"/> par tenant.
/// </summary>
public sealed class StudioContextDigestService : IStudioContextDigestService
{
    /// <summary>Nombre maximal de tables résumées (au-delà : « … (+N tables) »).</summary>
    public const int MaxEntities = 50;

    /// <summary>
    /// Longueur maximale d'une ligne de table : au-delà, la liste des champs est coupée avec
    /// « , … (+N champs) ». Une seule table très large ne doit pas consommer tout le budget CPU
    /// (1200 caractères) — la règle 11 porte d'abord sur les CLÉS des tables.
    /// </summary>
    public const int MaxLineChars = 320;

    /// <summary>Durée de vie du digest de schéma en cache. Courte : une table créée doit apparaître vite.</summary>
    public static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    /// <summary>Un plan terminé plus ancien n'est plus « le dernier plan » : l'utilisateur est passé à autre chose.</summary>
    public static readonly TimeSpan CompletedPlanWindow = TimeSpan.FromHours(24);

    private const string Ellipsis = "…";

    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomSystemRepository _systems;
    private readonly IStudioAiBuildPlanRepository _plans;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _timeProvider;

    public StudioContextDigestService(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomSystemRepository systems,
        IStudioAiBuildPlanRepository plans,
        IMemoryCache cache,
        TimeProvider? timeProvider = null)
    {
        _entities = entities;
        _fields = fields;
        _systems = systems;
        _plans = plans;
        _cache = cache;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public static string SchemaCacheKey(Guid tenantId) => $"studio:schema-digest:{tenantId}";

    public async Task<string> BuildSchemaDigestAsync(Guid tenantId, int maxChars, CancellationToken cancellationToken)
    {
        if (maxChars <= 0)
            return string.Empty;

        // Le cache porte les lignes NON tronquées : les budgets CPU / avancé partagent la même entrée.
        var cacheKey = SchemaCacheKey(tenantId);
        if (!_cache.TryGetValue(cacheKey, out SchemaLines? lines) || lines is null)
        {
            lines = await LoadSchemaLinesAsync(tenantId, cancellationToken);
            _cache.Set(cacheKey, lines, CacheTtl);
        }

        return Render(lines, maxChars);
    }

    public async Task<string?> BuildLastPlanDigestAsync(Guid tenantId, string userId, int maxChars, CancellationToken cancellationToken)
    {
        if (maxChars <= 0 || string.IsNullOrWhiteSpace(userId))
            return null;

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var entries = new List<string>();

        // Lectures séquentielles (un DbContext tenant par appel de dépôt — voir l'en-tête de classe).
        var pending = await _plans.ListPendingByOwnerAsync(tenantId, userId, cancellationToken);
        var latestPending = pending
            .Where(p => p.TenantId == tenantId)
            .OrderByDescending(p => p.CreatedAt)
            .FirstOrDefault();
        if (latestPending is not null)
            entries.Add(DescribePlan(latestPending, "En attente", latestPending.CreatedAt));

        var (completed, _) = await _plans.ListByOwnerAsync(
            tenantId, userId, StudioAiPlanStatus.Completed, kind: null, page: 1, pageSize: 1, cancellationToken);
        var latestCompleted = completed.FirstOrDefault(p => p.TenantId == tenantId);
        if (latestCompleted is not null)
        {
            var when = latestCompleted.ExecutedAt ?? latestCompleted.CreatedAt;
            if (now - when <= CompletedPlanWindow)
                entries.Add(DescribePlan(latestCompleted, "Terminé", when));
        }

        if (entries.Count == 0)
            return null;

        return Truncate(string.Join("\n", entries), maxChars);
    }

    // ---------------------------------------------------------------- schéma

    private async Task<SchemaLines> LoadSchemaLinesAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var entities = (await _entities.ListAsync(tenantId, includeInactive: false, cancellationToken))
            .Where(e => e.TenantId == tenantId && e.IsActive && !e.IsDeleted)
            .OrderBy(e => e.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Key, StringComparer.Ordinal)
            .ToList();
        if (entities.Count == 0)
            return new SchemaLines([], 0);

        var systemKeys = new Dictionary<Guid, string>();
        if (entities.Any(e => e.SystemId.HasValue))
        {
            foreach (var system in await _systems.ListAsync(tenantId, includeInactive: true, cancellationToken))
                systemKeys.TryAdd(system.Id, system.Key);
        }

        var lines = new List<string>(Math.Min(entities.Count, MaxEntities));
        foreach (var entity in entities.Take(MaxEntities))
        {
            var fields = (await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken))
                .Where(f => f.IsActive)
                .OrderBy(f => f.SortOrder)
                .ThenBy(f => f.Key, StringComparer.Ordinal)
                .ToList();
            lines.Add(FormatEntityLine(entity, fields, systemKeys));
        }

        return new SchemaLines(lines, Math.Max(0, entities.Count - lines.Count));
    }

    internal static string FormatEntityLine(
        CustomEntityDefinition entity,
        IReadOnlyList<CustomFieldDefinition> fields,
        IReadOnlyDictionary<Guid, string> systemKeys)
    {
        var system = entity.SystemId is { } systemId && systemKeys.TryGetValue(systemId, out var systemKey)
            ? $" (systeme:{systemKey})"
            : string.Empty;
        var sb = new StringBuilder($"- {entity.Key} « {entity.DisplayName} »{system} : ");
        if (fields.Count == 0)
            return sb.Append("(aucun champ)").ToString();

        // Le premier champ est toujours montré ; les suivants tant que la ligne (suffixe compris) tient
        // dans MaxLineChars. Au-delà : « , … (+N champs) » — le modèle sait que la table est plus large.
        var shown = 0;
        foreach (var field in fields)
        {
            var token = $"{field.Key}:{FieldTypeToken(field.FieldType)}";
            var remainingAfter = fields.Count - shown - 1;
            var suffixReserve = remainingAfter > 0 ? FieldsOmittedSuffix(remainingAfter).Length : 0;
            if (shown > 0 && sb.Length + 2 + token.Length + suffixReserve > MaxLineChars)
                break;
            if (shown > 0) sb.Append(", ");
            sb.Append(token);
            shown++;
        }

        if (shown < fields.Count)
            sb.Append(FieldsOmittedSuffix(fields.Count - shown));
        return sb.ToString();
    }

    private static string FieldsOmittedSuffix(int count) => $", {Ellipsis} (+{count} champ{(count > 1 ? "s" : "")})";

    /// <summary>Jeton de type court, aligné sur le vocabulaire des specs (<c>text</c>, <c>money</c>, <c>select</c>…).</summary>
    internal static string FieldTypeToken(CustomFieldType type) => type switch
    {
        CustomFieldType.Text => "text",
        CustomFieldType.MultilineText => "multiline",
        CustomFieldType.Number => "number",
        CustomFieldType.Decimal => "decimal",
        CustomFieldType.Boolean => "boolean",
        CustomFieldType.Date => "date",
        CustomFieldType.DateTime => "datetime",
        CustomFieldType.Select => "select",
        CustomFieldType.MultiSelect => "multiselect",
        CustomFieldType.RelationCustom => "relation",
        CustomFieldType.RelationExisting => "relation_erp",
        CustomFieldType.Money => "money",
        CustomFieldType.Percentage => "percentage",
        CustomFieldType.Rating => "rating",
        CustomFieldType.QrCode => "qrcode",
        CustomFieldType.Barcode => "barcode",
        CustomFieldType.AutoNumber => "autonumber",
        CustomFieldType.Formula => "formula",
        CustomFieldType.Lookup => "lookup",
        CustomFieldType.Rollup => "rollup",
        CustomFieldType.Attachment => "attachment",
        CustomFieldType.Signature => "signature",
        _ => type.ToString().ToLowerInvariant()
    };

    /// <summary>
    /// Assemble les lignes dans le budget. Une ligne qui ne tient pas est remplacée (avec les suivantes)
    /// par « … (+N tables) » : le modèle sait qu'il existe d'autres tables même s'il ne les voit pas.
    /// </summary>
    internal static string Render(SchemaLines lines, int maxChars)
    {
        if (lines.Lines.Count == 0)
            return string.Empty;

        var sb = new StringBuilder();
        var included = 0;
        foreach (var line in lines.Lines)
        {
            var remainingAfter = lines.Lines.Count - included - 1 + lines.OmittedCount;
            var suffixReserve = remainingAfter > 0 ? OmittedSuffix(remainingAfter).Length + 1 : 0;
            var needed = (sb.Length > 0 ? 1 : 0) + line.Length;
            if (sb.Length + needed + suffixReserve > maxChars)
                break;
            if (sb.Length > 0) sb.Append('\n');
            sb.Append(line);
            included++;
        }

        var omitted = lines.Lines.Count - included + lines.OmittedCount;
        if (omitted > 0)
        {
            var suffix = OmittedSuffix(omitted);
            if (sb.Length == 0)
                return Truncate(suffix, maxChars);
            sb.Append('\n').Append(suffix);
        }
        return sb.ToString();
    }

    private static string OmittedSuffix(int count) => $"{Ellipsis} (+{count} table{(count > 1 ? "s" : "")})";

    // ---------------------------------------------------------------- dernier plan

    private static string DescribePlan(StudioAiBuildPlan plan, string statusLabel, DateTime whenUtc)
    {
        var (title, names) = ReadPlanNames(plan);
        var tables = names.Count == 0
            ? string.Empty
            : $" : {names.Count} table{(names.Count > 1 ? "s" : "")} ({string.Join(", ", names)})";
        return $"- [{statusLabel} {whenUtc:HH:mm}] {KindLabel(plan.Kind)} « {title} »{tables}";
    }

    /// <summary>Libellé court du type de plan, dans la langue du prompt.</summary>
    internal static string KindLabel(StudioAiPlanKind kind) => kind switch
    {
        StudioAiPlanKind.CreateApp => "Table",
        StudioAiPlanKind.CreateSystem => "Système",
        StudioAiPlanKind.Amendment => "Modification",
        StudioAiPlanKind.View => "Fenêtre",
        StudioAiPlanKind.Report => "État",
        StudioAiPlanKind.RecordView => "Vue enregistrée",
        StudioAiPlanKind.Workflow => "Workflow",
        _ => kind.ToString()
    };

    /// <summary>
    /// Titre et tables du plan : clés RÉELLES depuis <c>ResultJson</c> quand le plan a été exécuté
    /// (<c>entityKey</c> / <c>entities[].entityKey</c>), sinon libellés de <c>SummaryJson</c>.
    /// Toute erreur de lecture JSON dégrade vers « (sans titre) » — jamais d'exception dans le prompt.
    /// </summary>
    internal static (string Title, IReadOnlyList<string> Names) ReadPlanNames(StudioAiBuildPlan plan)
    {
        var title = "(sans titre)";
        IReadOnlyList<string> names = [];
        try
        {
            using var summary = JsonDocument.Parse(plan.SummaryJson);
            title = ReadString(summary.RootElement, "title") ?? title;
            names = ReadStrings(summary.RootElement, "entities", "displayName");
        }
        catch (JsonException)
        {
            // SummaryJson illisible : on garde le titre par défaut.
        }

        if (plan.Status == StudioAiPlanStatus.Completed && !string.IsNullOrWhiteSpace(plan.ResultJson))
        {
            try
            {
                using var result = JsonDocument.Parse(plan.ResultJson);
                var keys = ReadStrings(result.RootElement, "entities", "entityKey");
                if (keys.Count == 0 && ReadString(result.RootElement, "entityKey") is { } single)
                    keys = [single];
                if (keys.Count > 0)
                    names = keys;
            }
            catch (JsonException)
            {
                // ResultJson illisible : les libellés de l'aperçu suffisent.
            }
        }

        return (title, names);
    }

    /// <summary>Valeur (trim) de la propriété chaîne <paramref name="name"/> d'un objet JSON ; null si absente ou vide.</summary>
    private static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
        && value.GetString() is { } text
        && !string.IsNullOrWhiteSpace(text)
            ? text.Trim()
            : null;

    /// <summary>Valeurs non vides de <c>obj[arrayName][*][property]</c> ; liste vide si le tableau est absent.</summary>
    private static List<string> ReadStrings(JsonElement obj, string arrayName, string property)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(arrayName, out var array)
            || array.ValueKind != JsonValueKind.Array)
            return [];

        return array.EnumerateArray()
            .Select(e => ReadString(e, property))
            .OfType<string>()
            .ToList();
    }

    private static string Truncate(string text, int maxChars)
    {
        if (maxChars <= 0) return string.Empty;
        if (text.Length <= maxChars) return text;
        return maxChars == 1 ? Ellipsis : text[..(maxChars - 1)].TrimEnd() + Ellipsis;
    }

    /// <summary>Lignes non tronquées + nombre de tables au-delà de <see cref="MaxEntities"/> (entrée de cache).</summary>
    public sealed record SchemaLines(IReadOnlyList<string> Lines, int OmittedCount);
}
