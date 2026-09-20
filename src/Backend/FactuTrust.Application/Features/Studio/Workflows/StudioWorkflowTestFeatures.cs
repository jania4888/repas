using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>Simulation pure d'un workflow sur un enregistrement réel (4.7c1 / R17).</summary>
public sealed record TestWorkflowQuery(Guid WorkflowId, Guid RecordId) : IRequest<Result<WorkflowTestResultDto>>;

/// <summary>
/// « Tester sur un enregistrement » (4.7c1 / D-47-B07, D-47-B08) : simule le <b>premier segment</b>
/// du workflow (la boucle de <c>StudioWorkflowEngine.RunSegmentAsync</c>, sans écriture) contre un
/// enregistrement réel, sur une <b>copie</b> de <c>DataJson</c> — les <c>update_field</c> appliquent
/// leurs valeurs rendues à la copie pour que les conditions suivantes les voient (fidélité), rien
/// n'est persisté. Réutilise les briques pures du moteur : <see cref="StudioWorkflowStepsSpec.Parse"/>,
/// <see cref="StudioFilterEvaluator"/>, <see cref="StudioTemplateRenderer"/> et
/// <see cref="StudioWorkflowContext"/> (démarrage système : <c>startedBy</c> nul, pas de
/// <c>_previous</c>). AUCUNE écriture : ni instance, ni journal d'étape, ni approbation, ni
/// notification, ni audit — le handler ne dépend d'aucun service d'écriture (D-47-B07).
/// Fidélité assumée et signalée (D-47-B08) : les sorties <c>_results.*</c> des étapes productrices
/// ne sont pas simulées ; une condition qui y fait référence est évaluée avec des valeurs vides et
/// un avertissement est émis.
/// </summary>
public sealed class TestWorkflowQueryHandler : IRequestHandler<TestWorkflowQuery, Result<WorkflowTestResultDto>>
{
    /// <summary>Borne du premier segment simulé — même valeur que <c>StudioWorkflowEngine.MaxStepsPerSegment</c> (B-test-1).</summary>
    public const int MaxSimulatedSteps = 30;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _time;

    public TestWorkflowQueryHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        TimeProvider time)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _records = records;
        _currentUser = currentUser;
        _time = time;
    }

    public async Task<Result<WorkflowTestResultDto>> Handle(TestWorkflowQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowTestResultDto>(err);
        // Le contrôleur porte déjà la policy ; le handler la reprend (motif B-pag-1, S-base).
        if (!_currentUser.HasPermission(Permissions.Studio.DesignEntities))
            return Result.Failure<WorkflowTestResultDto>(Error.Unauthorized("Permission de conception Studio requise."));
        // 4.7★1 (D-47-74, U6) — défense en profondeur : la trace rend les gabarits sur une fiche RÉELLE ;
        // un concepteur sans lecture des enregistrements ne doit pas la voir (motif CustomRecordHistoryFeatures).
        if (!_currentUser.HasPermission(Permissions.CustomData.RecordsRead))
            return Result.Failure<WorkflowTestResultDto>(Error.Unauthorized("Permission de lecture des enregistrements requise."));

        var definition = await _workflows.GetDefinitionAsync(tenantId, query.WorkflowId, cancellationToken);
        if (definition is null)
            return Result.Failure<WorkflowTestResultDto>(Error.NotFound("StudioWorkflowDefinition", query.WorkflowId));

        var entity = await _entities.GetByIdAsync(tenantId, definition.EntityDefinitionId, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowTestResultDto>(Error.NotFound("CustomEntityDefinition", definition.EntityDefinitionId));

        // 404 identique pour « inconnu » et « autre tenant » (non révélateur, motif existant).
        var record = await _records.GetAsync(tenantId, entity.Id, query.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<WorkflowTestResultDto>(Error.NotFound("CustomRecord", query.RecordId));

        // Le moteur créerait une instance en échec ; le test, lui, refuse net (consigné D-47-B07).
        var parsed = StudioWorkflowStepsSpec.Parse(definition.StepsJson);
        if (!parsed.IsSuccess)
            return Result.Failure<WorkflowTestResultDto>(Error.Validation("steps", parsed.Error.Description));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        return Result.Success(Simulate(parsed.Value, entity, fields, record));
    }

    /// <summary>Boucle de segment sans écriture (miroir de <c>RunSegmentAsync</c>).</summary>
    private WorkflowTestResultDto Simulate(
        ParsedWorkflowSpec spec,
        CustomEntityDefinition entity,
        IReadOnlyList<CustomFieldDefinition> fields,
        CustomRecord record)
    {
        var nowUtc = _time.GetUtcNow().UtcDateTime;
        // Copie de travail : les update_field l'enrichissent pour les conditions suivantes.
        var recordData = JsonNode.Parse(record.DataJson) as JsonObject ?? new JsonObject();
        var context = StudioWorkflowContext.Create(record.Id, entity.Key, startedById: null, startedByEmail: null, previous: null);

        var trace = new List<WorkflowTestStepTraceDto>();
        var warnings = new List<string>();
        var resultsWarned = new HashSet<string>(StringComparer.Ordinal);
        var suspended = false;
        var evaluated = 0;

        var index = 0;
        while (index < spec.Steps.Count && trace.Count < MaxSimulatedSteps)
        {
            var step = spec.Steps[index];
            switch (step.Type)
            {
                case StudioWorkflowStepTypes.Condition:
                {
                    evaluated++;
                    var (passed, match) = EvaluateCondition(step, fields, recordData, context, warnings, resultsWarned);
                    if (passed)
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                            $"Condition remplie (match = {match}).", new JsonObject { ["passed"] = true, ["match"] = match }));
                        index++;
                        break;
                    }

                    var onFalse = ReadString(step.Raw, "onFalse") ?? "stop";
                    var gotoKey = ReadString(step.Raw, "gotoKey");
                    if (onFalse == "skip")
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.Skipped,
                            "Condition non remplie — étape passée (onFalse = skip).", new JsonObject { ["passed"] = false, ["match"] = match }));
                        index++;
                    }
                    else if (onFalse == "goto" && !string.IsNullOrWhiteSpace(gotoKey))
                    {
                        if (!spec.IndexByKey.TryGetValue(gotoKey, out var target) || target <= index)
                        {
                            trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldFail,
                                $"Cible de branchement « {gotoKey} » inconnue ou non postérieure.", null));
                            index = spec.Steps.Count;
                            break;
                        }
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                            $"Condition non remplie — saut à « {gotoKey} ».", new JsonObject { ["passed"] = false, ["match"] = match }));
                        for (var skippedIndex = index + 1; skippedIndex < target; skippedIndex++)
                        {
                            var jumped = spec.Steps[skippedIndex];
                            trace.Add(new(jumped.Key, jumped.Type, jumped.Label, WorkflowTestVerdicts.Skipped,
                                $"Sautée par le branchement de « {step.Key} ».", null));
                        }
                        index = target;
                    }
                    else
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                            "Condition non remplie — le workflow s'arrêterait ici (onFalse = stop).",
                            new JsonObject { ["passed"] = false, ["match"] = match }));
                        index = spec.Steps.Count;
                    }
                    break;
                }

                case StudioWorkflowStepTypes.UpdateField:
                {
                    evaluated++;
                    if (!TryRenderSet(step.Raw, recordData, context, nowUtc, out var patch))
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldFail,
                            "« set » est requis (1 à 10 paires champ → valeur, gabarits autorisés).", null));
                        index = spec.Steps.Count;
                        break;
                    }
                    foreach (var pair in patch)
                        recordData[pair.Key] = pair.Value?.DeepClone();
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun, null, patch));
                    index++;
                    break;
                }

                case StudioWorkflowStepTypes.Notify:
                {
                    evaluated++;
                    var rendered = new JsonObject
                    {
                        ["to"] = step.Raw["to"]?.DeepClone(),
                        ["title"] = Render(step.Raw, "title", recordData, context, nowUtc),
                        ["body"] = Render(step.Raw, "body", recordData, context, nowUtc)
                    };
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun, null, rendered));
                    index++;
                    break;
                }

                case StudioWorkflowStepTypes.ErpAction:
                {
                    evaluated++;
                    var action = ReadString(step.Raw, "action") ?? "?";
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                        $"Action « {action} » — exécutée réellement au lancement.",
                        RenderMapping(step.Raw, recordData, context, nowUtc, action)));
                    WarnIfSaveResultAs(step, warnings);
                    index++;
                    break;
                }

                case StudioWorkflowStepTypes.CreateRecord:
                {
                    evaluated++;
                    if (!TryRenderSet(step.Raw, recordData, context, nowUtc, out var data))
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldFail,
                            "« set » est requis (1 à 10 paires champ → valeur, gabarits autorisés).", null));
                        index = spec.Steps.Count;
                        break;
                    }
                    var targetKey = ReadString(step.Raw, "entity");
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                        targetKey is null ? "Création dans la même table." : $"Création dans la table « {targetKey} ».",
                        new JsonObject { ["entity"] = targetKey, ["set"] = data }));
                    WarnIfSaveResultAs(step, warnings);
                    index++;
                    break;
                }

                case StudioWorkflowStepTypes.Approval:
                {
                    evaluated++;
                    var assignee = ReadAssignee(step.Raw);
                    var dueAt = nowUtc.AddHours(Math.Clamp(ReadInt(step.Raw, "dueInHours") ?? StudioWorkflowStepsSpec.DefaultApprovalDueInHours, 1, StudioWorkflowStepsSpec.MaxHours));
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldSuspend,
                        $"Approbation {assignee} ; échéance calculée : {Iso(dueAt)}.",
                        new JsonObject
                        {
                            ["title"] = Render(step.Raw, "title", recordData, context, nowUtc),
                            ["message"] = Render(step.Raw, "message", recordData, context, nowUtc)
                        }));
                    suspended = true;
                    index = spec.Steps.Count;
                    break;
                }

                case StudioWorkflowStepTypes.Wait:
                {
                    evaluated++;
                    DateTime dueAt;
                    var hours = ReadInt(step.Raw, "hours");
                    if (hours is not null)
                    {
                        dueAt = nowUtc.AddHours(hours.Value);
                    }
                    else
                    {
                        var rendered = StudioTemplateRenderer.Render(
                            ReadString(step.Raw, "until") ?? string.Empty, recordData, context, nowUtc).Value;
                        if (!DateTime.TryParse(rendered, CultureInfo.InvariantCulture,
                                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out dueAt))
                        {
                            trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldFail,
                                "Date d'attente invalide.", null));
                            index = spec.Steps.Count;
                            break;
                        }
                    }
                    var cap = nowUtc.AddHours(Math.Clamp(ReadInt(step.Raw, "maxHours") ?? StudioWorkflowStepsSpec.DefaultWaitMaxHours, 1, StudioWorkflowStepsSpec.MaxHours));
                    if (dueAt > cap)
                        dueAt = cap;

                    if (dueAt <= nowUtc)
                    {
                        trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldRun,
                            "Échéance déjà passée — aucune attente.", null));
                        index++;
                        break;
                    }
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldSuspend,
                        $"Reprise prévue le {Iso(dueAt)}.", null));
                    suspended = true;
                    index = spec.Steps.Count;
                    break;
                }

                default:
                    evaluated++;
                    trace.Add(new(step.Key, step.Type, step.Label, WorkflowTestVerdicts.WouldFail,
                        $"Type d'étape inconnu : « {step.Type} ».", null));
                    index = spec.Steps.Count;
                    break;
            }
        }

        if (index < spec.Steps.Count)
        {
            // Segment épuisé (borne partagée avec le moteur) : le vrai run suspendrait pour reprise différée.
            suspended = true;
            warnings.Add($"Segment épuisé après {MaxSimulatedSteps} lignes de trace : la suite serait reprise par le job différé.");
        }

        return new WorkflowTestResultDto(record.Id, entity.Key, evaluated, suspended, trace, warnings);
    }

    /// <summary>
    /// Évalue une condition avec la sémantique exacte de <c>ConditionStepHandler</c> (champs actifs,
    /// <c>_previous.*</c> — vide en simulation — et variables <c>_approval.*</c>/<c>_results.*</c> en texte).
    /// </summary>
    private (bool Passed, string Match) EvaluateCondition(
        WorkflowStepSpec step,
        IReadOnlyList<CustomFieldDefinition> fields,
        JsonObject recordData,
        StudioWorkflowContext context,
        List<string> warnings,
        HashSet<string> resultsWarned)
    {
        var filters = ReadFilters(step.Raw);
        var meta = new Dictionary<string, FilterFieldMeta>(StringComparer.Ordinal);
        var row = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (!field.IsActive) continue;
            var numeric = IsNumeric(field.FieldType);
            var date = IsDate(field.FieldType);
            meta[field.Key] = new FilterFieldMeta(field.Key, numeric, date);
            meta[$"_previous.{field.Key}"] = new FilterFieldMeta($"_previous.{field.Key}", numeric, date);
            row[$"_previous.{field.Key}"] = context.Previous?[field.Key];
        }
        foreach (var pair in recordData)
            row[pair.Key] = pair.Value;
        foreach (var filter in filters)
        {
            if (!filter.Field.StartsWith("_approval.", StringComparison.Ordinal)
                && !filter.Field.StartsWith("_results.", StringComparison.Ordinal))
                continue;
            meta.TryAdd(filter.Field, new FilterFieldMeta(filter.Field, Numeric: false, Date: false));
            row[filter.Field] = context.Resolve(filter.Field);
            // D-47-B08 : les sorties des étapes productrices ne sont pas simulées (évaluées vides).
            if (filter.Field.StartsWith("_results.", StringComparison.Ordinal) && resultsWarned.Add(filter.Field))
                warnings.Add($"Sorties fictives : « {filter.Field} » est évalué vide en simulation (l'étape productrice n'est pas exécutée).");
        }

        var match = ReadString(step.Raw, "match") ?? "all";
        return (StudioFilterEvaluator.PassesAll(row, filters, meta, match == "all"), match);
    }

    /// <summary>Rend le « set » d'un <c>update_field</c>/<c>create_record</c> (nœuds détachés, prêts à appliquer).</summary>
    private static bool TryRenderSet(
        JsonObject raw, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc, out JsonObject patch)
    {
        patch = new JsonObject();
        if (!raw.TryGetPropertyValue("set", out var node) || node is not JsonObject set || set.Count == 0)
            return false;
        foreach (var pair in set)
            patch[pair.Key] = StudioTemplateRenderer.RenderValue(pair.Value, recordData, context, nowUtc)?.DeepClone();
        return true;
    }

    /// <summary>Rend le « mapping » d'un <c>erp_action</c> : gabarit rendu, champ lu sur la copie, constante telle quelle.</summary>
    private static JsonObject RenderMapping(
        JsonObject raw, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc, string action)
    {
        var mapping = new JsonArray();
        if (raw.TryGetPropertyValue("mapping", out var node) && node is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not JsonObject map) continue;
                var param = ReadString(map, "param");
                if (string.IsNullOrWhiteSpace(param)) continue;
                var source = ReadString(map, "source") ?? "field";
                var value = ReadString(map, "value");
                JsonNode? rendered = source switch
                {
                    "template" => JsonValue.Create(
                        StudioTemplateRenderer.Render(value ?? string.Empty, recordData, context, nowUtc).Value),
                    "field" => value is not null && recordData.TryGetPropertyValue(value, out var fieldValue)
                        ? fieldValue?.DeepClone()
                        : null,
                    _ => map["value"]?.DeepClone()
                };
                mapping.Add(new JsonObject { ["param"] = param, ["source"] = source, ["value"] = rendered });
            }
        }
        return new JsonObject { ["action"] = action, ["mapping"] = mapping };
    }

    /// <summary>Rappel de non-fidélité assumée (D-47-B08) quand l'étape mémorise un résultat.</summary>
    private static void WarnIfSaveResultAs(WorkflowStepSpec step, List<string> warnings)
    {
        var saveAs = ReadString(step.Raw, "saveResultAs");
        if (!string.IsNullOrWhiteSpace(saveAs))
            warnings.Add($"Sorties fictives : « _results.{saveAs}.* » ne sera renseigné qu'à l'exécution réelle de « {step.Key} ».");
    }

    private static string ReadAssignee(JsonObject raw)
    {
        if (raw.TryGetPropertyValue("assignee", out var node) && node is JsonObject assignee)
        {
            var kind = ReadString(assignee, "kind");
            var value = ReadString(assignee, "value");
            if (kind == "user" && Guid.TryParse(value, out var userId))
                return $"assignée à l'utilisateur {userId}";
            if (kind == "role" && !string.IsNullOrWhiteSpace(value))
                return $"assignée au rôle « {value} »";
        }
        return "sans assignation";
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

    private static string? Render(JsonObject raw, string property, JsonObject recordData, StudioWorkflowContext context, DateTime nowUtc)
        => ReadString(raw, property) is { } template
            ? StudioTemplateRenderer.Render(template, recordData, context, nowUtc).Value
            : null;

    private static string? ReadString(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<string>(out var s)
            ? s
            : null;

    private static int? ReadInt(JsonObject obj, string name) =>
        obj.TryGetPropertyValue(name, out var node) && node is JsonValue v && v.TryGetValue<int>(out var i)
            ? i
            : null;

    private static string Iso(DateTime utc) => utc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);

    private static bool IsNumeric(CustomFieldType type) => type is
        CustomFieldType.Number or CustomFieldType.Decimal or CustomFieldType.Money
        or CustomFieldType.Percentage or CustomFieldType.Rating or CustomFieldType.AutoNumber;

    private static bool IsDate(CustomFieldType type) => type is
        CustomFieldType.Date or CustomFieldType.DateTime;
}
