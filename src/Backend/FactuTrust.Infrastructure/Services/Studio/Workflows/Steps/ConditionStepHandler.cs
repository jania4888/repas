using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;

/// <summary>
/// Handler de l'étape <c>condition</c> : évalue les filtres sur l'enregistrement courant et les
/// variables <c>_previous.&lt;champ&gt;</c>, <c>_approval.&lt;clé&gt;.&lt;prop&gt;</c>,
/// <c>_results.&lt;clé&gt;.&lt;prop&gt;</c> avec la sémantique exacte de
/// <see cref="StudioFilterEvaluator"/> (champ inconnu ⇒ le filtre passe). Condition remplie ⇒
/// poursuite avec <c>{ passed, match }</c> ; sinon <c>onFalse</c> : <c>stop</c> (défaut),
/// <c>skip</c> ou <c>goto</c>.
/// </summary>
public sealed class ConditionStepHandler : IStudioWorkflowStepHandler
{
    public string StepType => StudioWorkflowStepTypes.Condition;

    public Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken)
    {
        var raw = ctx.Step.Raw;
        var filters = ReadFilters(raw);
        var fieldByKey = BuildFieldMeta(ctx, filters);
        var row = BuildRow(ctx, filters);

        var match = ReadString(raw, "match") ?? "all";
        var passed = StudioFilterEvaluator.PassesAll(row, filters, fieldByKey, match == "all");

        if (passed)
        {
            return Task.FromResult<StepOutcome>(new StepOutcome.Continue(new JsonObject
            {
                ["passed"] = true,
                ["match"] = match
            }));
        }

        var onFalse = ReadString(raw, "onFalse") ?? "stop";
        var gotoKey = ReadString(raw, "gotoKey");
        StepOutcome outcome = onFalse switch
        {
            "skip" => new StepOutcome.Skip("Condition non remplie"),
            "goto" when !string.IsNullOrWhiteSpace(gotoKey) => new StepOutcome.Goto(gotoKey),
            _ => new StepOutcome.Stop("Condition non remplie")
        };
        return Task.FromResult(outcome);
    }

    /// <summary>Métadonnées : champs actifs de l'entité et <c>_previous.*</c> (même méta), variables texte.</summary>
    private static Dictionary<string, FilterFieldMeta> BuildFieldMeta(
        StepExecutionContext ctx, IReadOnlyList<StudioFilter> filters)
    {
        var meta = new Dictionary<string, FilterFieldMeta>(StringComparer.Ordinal);
        foreach (var field in ctx.Fields)
        {
            if (!field.IsActive) continue;
            var numeric = IsNumeric(field.FieldType);
            var date = IsDate(field.FieldType);
            meta[field.Key] = new FilterFieldMeta(field.Key, numeric, date);
            meta[$"_previous.{field.Key}"] = new FilterFieldMeta($"_previous.{field.Key}", numeric, date);
        }

        // _approval.<clé>.<prop> et _results.<clé>.<prop> sont toujours comparés en texte.
        foreach (var filter in filters)
            if (IsContextVariable(filter.Field))
                meta.TryAdd(filter.Field, new FilterFieldMeta(filter.Field, Numeric: false, Date: false));
        return meta;
    }

    /// <summary>Valeurs : enregistrement courant, cliché <c>previous</c> et variables via Resolve.</summary>
    private static Dictionary<string, object?> BuildRow(StepExecutionContext ctx, IReadOnlyList<StudioFilter> filters)
    {
        var row = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var pair in ctx.RecordData)
            row[pair.Key] = pair.Value;
        foreach (var field in ctx.Fields)
        {
            if (!field.IsActive) continue;
            row[$"_previous.{field.Key}"] = ctx.Context.Previous?[field.Key];
        }
        foreach (var filter in filters)
            if (IsContextVariable(filter.Field))
                row[filter.Field] = ctx.Context.Resolve(filter.Field);
        return row;
    }

    private static List<StudioFilter> ReadFilters(JsonObject raw)
    {
        var filters = new List<StudioFilter>();
        if (!raw.TryGetPropertyValue("filters", out var node) || node is not JsonArray arr)
            return filters;
        foreach (var item in arr)
        {
            if (item is not JsonObject f) continue;
            var field = ReadString(f, "field");
            var op = ReadString(f, "op");
            if (string.IsNullOrWhiteSpace(field) || string.IsNullOrWhiteSpace(op)) continue;
            filters.Add(new StudioFilter(
                field, op,
                StudioFilterEvaluator.ToPrimitive(f["value"]),
                StudioFilterEvaluator.ToPrimitive(f["value2"])));
        }
        return filters;
    }

    private static bool IsContextVariable(string field) =>
        field.StartsWith("_approval.", StringComparison.Ordinal) ||
        field.StartsWith("_results.", StringComparison.Ordinal);

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;

    private static bool IsNumeric(CustomFieldType type) => type is
        CustomFieldType.Number or CustomFieldType.Decimal or CustomFieldType.Money
        or CustomFieldType.Percentage or CustomFieldType.Rating or CustomFieldType.AutoNumber;

    private static bool IsDate(CustomFieldType type) => type is
        CustomFieldType.Date or CustomFieldType.DateTime;
}
