using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Workflows.Spec;

/// <summary>Une étape d'un workflow Studio : clé, type, libellé optionnel et nœud JSON brut validé.</summary>
public sealed record WorkflowStepSpec(string Key, string Type, string? Label, JsonObject Raw);

/// <summary>Une définition d'étapes analysée : version, étapes ordonnées et index par clé.</summary>
public sealed record ParsedWorkflowSpec(int Version, IReadOnlyList<WorkflowStepSpec> Steps, IReadOnlyDictionary<string, int> IndexByKey);

/// <summary>Un problème de validation localisé (chemin <c>steps[i].&lt;prop&gt;</c>, <c>trigger</c>, <c>triggerConfig</c>…).</summary>
public sealed record WorkflowValidationIssue(string Path, string Message);

/// <summary>Résultat complet de <see cref="StudioWorkflowStepsSpec.Validate"/> : erreurs, avertissements et spec analysée.</summary>
public sealed record WorkflowValidationOutcome(
    IReadOnlyList<WorkflowValidationIssue> Errors,
    IReadOnlyList<WorkflowValidationIssue> Warnings,
    ParsedWorkflowSpec? Spec)
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>
/// Analyse et validation de <c>StepsJson</c> / <c>TriggerConfigJson</c> des workflows Studio (§0.5).
/// Pure (aucune dépendance Infrastructure) : l'entité, ses champs et les résolveurs sont fournis par
/// l'appelant. Toutes les bornes sont vérifiées avant toute allocation (taille UTF-8 d'abord) et les
/// messages ne citent que la propriété fautive.
/// </summary>
public static class StudioWorkflowStepsSpec
{
    public const int MaxSteps = 30;
    public const int MaxStepsJsonBytes = 64 * 1024;
    public const int MaxTriggerConfigBytes = 2 * 1024;
    public const int MaxFilters = 10;
    public const int MaxSetKeys = 10;
    public const int MaxMappings = 20;
    public const int MaxHours = 720;

    /// <summary>Échéance par défaut d'une étape <c>approval</c> sans <c>dueInHours</c> explicite (72 h) —
    /// partagée moteur/simulation depuis 4.7★3 (D-47-80), bornée <c>1..MaxHours</c> à l'usage.</summary>
    public const int DefaultApprovalDueInHours = 72;
    /// <summary>Plafond par défaut d'une étape <c>wait</c> sans <c>maxHours</c> explicite : le plafond
    /// absolu <see cref="MaxHours"/> (720 h) — partagé moteur/simulation depuis 4.7★3 (D-47-80).</summary>
    public const int DefaultWaitMaxHours = MaxHours;

    /// <summary>Nom de variable <c>saveResultAs</c> / clé de <c>_results</c>.</summary>
    public static readonly Regex SaveAsRegex = new("^[a-z][a-z0-9_]{0,31}$", RegexOptions.CultureInvariant);

    private static readonly string[] MatchValues = { "all", "any" };
    private static readonly string[] OnFalseValues = { "stop", "skip", "goto" };
    private static readonly string[] OnFailureValues = { "fail", "continue" };
    private static readonly string[] OnTimeoutValues = { "reject", "approve", "fail" };
    private static readonly string[] OnRejectValues = { "stop", "goto", "continue" };

    /// <summary>Opérateurs autorisés sur les variables texte <c>_approval.*</c> / <c>_results.*</c>.</summary>
    private static readonly IReadOnlySet<string> TextVariableOperators = new HashSet<string>(StringComparer.Ordinal)
        { "eq", "neq", "contains", "is_empty", "is_not_empty" };

    private static readonly IReadOnlySet<string> CommonProperties = new HashSet<string>(StringComparer.Ordinal)
        { "key", "type", "label" };

    private static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> AllowedProperties =
        new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            [StudioWorkflowStepTypes.Condition] = Set("filters", "match", "onFalse", "gotoKey"),
            [StudioWorkflowStepTypes.UpdateField] = Set("set"),
            [StudioWorkflowStepTypes.ErpAction] = Set("action", "mapping", "onFailure", "saveResultAs"),
            [StudioWorkflowStepTypes.Notify] = Set("to", "title", "body", "link"),
            [StudioWorkflowStepTypes.Approval] = Set("assignee", "title", "message", "dueInHours", "onTimeout", "onReject", "gotoKey"),
            [StudioWorkflowStepTypes.Wait] = Set("hours", "until", "maxHours"),
            [StudioWorkflowStepTypes.CreateRecord] = Set("entity", "set", "saveResultAs")
        };

    private static IReadOnlySet<string> Set(params string[] names) => new HashSet<string>(names, StringComparer.Ordinal);

    // ---------------------------------------------------------------- Parse

    /// <summary>
    /// Analyse structurelle de <c>StepsJson</c> : taille ≤ 64 Ko (vérifiée en premier), objet JSON,
    /// <c>version == 1</c>, 1..30 étapes, chaque étape objet avec <c>key</c> (<see cref="StudioKey.IsValidShape"/>)
    /// unique et <c>type</c> ∈ <see cref="StudioWorkflowStepTypes.All"/>. Échec au premier problème.
    /// </summary>
    public static Result<ParsedWorkflowSpec> Parse(string stepsJson)
    {
        if (stepsJson is null)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", "La définition des étapes est manquante."));
        if (Encoding.UTF8.GetByteCount(stepsJson) > MaxStepsJsonBytes)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", "La définition des étapes dépasse 64 Ko."));

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(stepsJson);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", "La définition des étapes est illisible (JSON attendu)."));
        }
        if (root is not JsonObject obj)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", "La définition des étapes doit être un objet JSON."));

        if (!TryReadInt(obj, "version", out var version, out _) || version != 1)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("version", "La version de la définition doit être 1."));

        if (!obj.TryGetPropertyValue("steps", out var stepsNode) || stepsNode is not JsonArray stepsArray || stepsArray.Count == 0)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", "Le workflow doit comporter au moins 1 étape."));
        if (stepsArray.Count > MaxSteps)
            return Result.Failure<ParsedWorkflowSpec>(Error.Validation("steps", $"Un workflow comporte au plus {MaxSteps} étapes."));

        var steps = new List<WorkflowStepSpec>(stepsArray.Count);
        var indexByKey = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < stepsArray.Count; i++)
        {
            if (stepsArray[i] is not JsonObject stepObj)
                return Result.Failure<ParsedWorkflowSpec>(Error.Validation($"steps[{i}]", "Chaque étape doit être un objet JSON."));

            TryReadString(stepObj, "key", out var key, out _);
            if (!StudioKey.IsValidShape(key))
                return Result.Failure<ParsedWorkflowSpec>(Error.Validation($"steps[{i}].key",
                    $"Clé d'étape invalide : « {key} » (a-z, 0-9, _ ; 2 à 64 caractères, commence par une lettre)."));
            if (!indexByKey.TryAdd(key!, i))
                return Result.Failure<ParsedWorkflowSpec>(Error.Validation($"steps[{i}].key", $"Clé d'étape déjà utilisée : « {key} »."));

            TryReadString(stepObj, "type", out var type, out _);
            if (string.IsNullOrWhiteSpace(type) || !StudioWorkflowStepTypes.All.Contains(type, StringComparer.Ordinal))
                return Result.Failure<ParsedWorkflowSpec>(Error.Validation($"steps[{i}].type", $"Type d'étape inconnu : « {type} »."));

            TryReadString(stepObj, "label", out var label, out _);
            steps.Add(new WorkflowStepSpec(key!, type!, label, stepObj));
        }

        return Result.Success(new ParsedWorkflowSpec(version, steps, indexByKey));
    }

    /// <summary>Clés d'entités référencées par les étapes <c>create_record</c> (distinctes, ordre d'apparition).</summary>
    public static IReadOnlyList<string> ReferencedEntityKeys(ParsedWorkflowSpec spec)
    {
        var keys = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var step in spec.Steps)
        {
            if (step.Type != StudioWorkflowStepTypes.CreateRecord)
                continue;
            if (TryReadString(step.Raw, "entity", out var key, out _) && !string.IsNullOrWhiteSpace(key) && seen.Add(key!))
                keys.Add(key!);
        }
        return keys;
    }

    // ------------------------------------------------------------- Validate

    /// <summary>
    /// Validation complète (§0.5) : déclencheur (<c>trigger</c>, <c>triggerConfig</c>, <c>triggerConfig.field</c>)
    /// puis chaque étape (<c>steps[i].&lt;prop&gt;</c>). Les avertissements (<see cref="Lint"/>) ne sont calculés
    /// que lorsqu'il n'y a aucune erreur.
    /// </summary>
    public static WorkflowValidationOutcome Validate(
        string stepsJson,
        StudioWorkflowTriggerKind trigger,
        string triggerConfigJson,
        CustomEntityDefinition entity,
        IReadOnlyList<CustomFieldDefinition> fields,
        Func<string, AiToolDefinition?> resolveAction,
        Func<string, IReadOnlyList<CustomFieldDefinition>?> resolveEntityFields)
    {
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentNullException.ThrowIfNull(fields);
        ArgumentNullException.ThrowIfNull(resolveAction);
        ArgumentNullException.ThrowIfNull(resolveEntityFields);

        var errors = new List<WorkflowValidationIssue>();

        ValidateTrigger(trigger, errors);
        ValidateTriggerConfig(trigger, triggerConfigJson, fields, errors);

        ParsedWorkflowSpec? spec = null;
        var parse = Parse(stepsJson);
        if (parse.IsFailure)
        {
            errors.Add(ToIssue(parse.Error));
        }
        else
        {
            spec = parse.Value;
            var activeFields = fields.Where(f => f.IsActive).ToDictionary(f => f.Key, StringComparer.Ordinal);
            var eligibleFields = fields.Where(f => f.IsActive && !CustomRecordValidator.IsComputed(f.FieldType))
                .ToDictionary(f => f.Key, StringComparer.Ordinal);
            for (var i = 0; i < spec.Steps.Count; i++)
                ValidateStep(i, spec.Steps[i], spec, activeFields, eligibleFields, resolveAction, resolveEntityFields, errors);
        }

        IReadOnlyList<WorkflowValidationIssue> warnings = errors.Count == 0 && spec is not null
            ? Lint(spec)
            : Array.Empty<WorkflowValidationIssue>();
        return new WorkflowValidationOutcome(errors, warnings, spec);
    }

    private static void ValidateTrigger(StudioWorkflowTriggerKind trigger, List<WorkflowValidationIssue> errors)
    {
        // 4.7b1 / D-47-B02 : Scheduled est accepté (D5 levé) — sa configuration est validée dans ValidateTriggerConfig.
        if (!Enum.IsDefined(trigger))
            errors.Add(new WorkflowValidationIssue("trigger", $"Déclencheur inconnu : « {(int)trigger} »."));
    }

    private static void ValidateTriggerConfig(
        StudioWorkflowTriggerKind trigger,
        string triggerConfigJson,
        IReadOnlyList<CustomFieldDefinition> fields,
        List<WorkflowValidationIssue> errors)
    {
        if (trigger is not (StudioWorkflowTriggerKind.OnCreate or StudioWorkflowTriggerKind.OnUpdate
            or StudioWorkflowTriggerKind.Manual or StudioWorkflowTriggerKind.FieldChanged
            or StudioWorkflowTriggerKind.Scheduled))
            return; // Déclencheur inconnu : déjà consigné sur « trigger ».

        if (string.IsNullOrWhiteSpace(triggerConfigJson))
            triggerConfigJson = "{}";
        if (Encoding.UTF8.GetByteCount(triggerConfigJson) > MaxTriggerConfigBytes)
        {
            errors.Add(new WorkflowValidationIssue("triggerConfig", "La configuration du déclencheur dépasse 2 Ko."));
            return;
        }

        JsonNode? node;
        try
        {
            node = JsonNode.Parse(triggerConfigJson);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            errors.Add(new WorkflowValidationIssue("triggerConfig", "La configuration du déclencheur est illisible (JSON attendu)."));
            return;
        }
        if (node is not JsonObject config)
        {
            errors.Add(new WorkflowValidationIssue("triggerConfig", "La configuration du déclencheur doit être un objet JSON."));
            return;
        }

        if (trigger is StudioWorkflowTriggerKind.OnCreate or StudioWorkflowTriggerKind.OnUpdate or StudioWorkflowTriggerKind.Manual)
        {
            foreach (var prop in config)
            {
                errors.Add(new WorkflowValidationIssue("triggerConfig", $"Propriété « {prop.Key} » non reconnue."));
                break; // une seule erreur suffit : la configuration doit être vide
            }
            return;
        }

        // 4.7b1 / D-47-B02 — Scheduled : { "cron": string (requis, 5 champs UTC), "filters"?: 0..10 }
        if (trigger is StudioWorkflowTriggerKind.Scheduled)
        {
            ValidateScheduledTriggerConfig(config, fields, errors);
            return;
        }

        // FieldChanged : { "field", "from"?, "to"? }
        foreach (var prop in config)
            if (prop.Key is not ("field" or "from" or "to"))
                errors.Add(new WorkflowValidationIssue("triggerConfig", $"Propriété « {prop.Key} » non reconnue."));

        if (!TryReadString(config, "field", out var fieldKey, out _) || string.IsNullOrWhiteSpace(fieldKey))
        {
            errors.Add(new WorkflowValidationIssue("triggerConfig.field", "Un champ est requis pour le déclencheur « field_changed »."));
            return;
        }
        var field = fields.FirstOrDefault(f => f.IsActive && f.Key == fieldKey);
        if (field is null)
            errors.Add(new WorkflowValidationIssue("triggerConfig.field", $"Champ inconnu ou inactif : « {fieldKey} »."));
        else if (CustomRecordValidator.IsComputed(field.FieldType))
            errors.Add(new WorkflowValidationIssue("triggerConfig.field", $"Champ calculé non suivi : « {fieldKey} »."));
    }

    /// <summary>
    /// Configuration du déclencheur planifié (4.7b1 / D-47-B02) :
    /// <c>{ "cron": string (requis, 5 champs UTC), "filters"?: [ { field, op, value, value2? } ≤ 10 ] }</c>.
    /// Les filtres visent des champs <b>actifs non calculés</b> (le balayage n'a ni <c>_previous</c> ni
    /// résultats d'étapes) avec opérateur compatible (motif <c>ValidateConditionFilter</c>, chemin
    /// <c>triggerConfig.filters</c>). Stockage : <c>TriggerConfigJson</c> existant (aucune migration).
    /// </summary>
    private static void ValidateScheduledTriggerConfig(
        JsonObject config,
        IReadOnlyList<CustomFieldDefinition> fields,
        List<WorkflowValidationIssue> errors)
    {
        foreach (var prop in config)
            if (prop.Key is not ("cron" or "filters"))
                errors.Add(new WorkflowValidationIssue("triggerConfig", $"Propriété « {prop.Key} » non reconnue."));

        if (!TryReadString(config, "cron", out var cron, out _) || string.IsNullOrWhiteSpace(cron))
        {
            errors.Add(new WorkflowValidationIssue(
                "triggerConfig.cron", "Une expression cron (5 champs, UTC) est requise pour le déclencheur « scheduled »."));
        }
        else if (!StudioWorkflowCronSpec.TryParse(cron, out _))
        {
            errors.Add(new WorkflowValidationIssue(
                "triggerConfig.cron", $"Expression cron invalide : « {cron} » (5 champs : minute heure jour-du-mois mois jour-de-semaine)."));
        }

        if (!config.TryGetPropertyValue("filters", out var filtersNode) || filtersNode is null)
            return;
        if (filtersNode is not JsonArray filters)
        {
            errors.Add(new WorkflowValidationIssue(
                "triggerConfig.filters", "« filters » doit être un tableau de 0 à 10 filtres { field, op, value, value2? }."));
            return;
        }
        if (filters.Count > MaxFilters)
            errors.Add(new WorkflowValidationIssue(
                "triggerConfig.filters", $"Le déclencheur planifié accepte au plus {MaxFilters} filtres."));
        foreach (var filterNode in filters.Take(MaxFilters))
        {
            if (filterNode is not JsonObject filter)
            {
                errors.Add(new WorkflowValidationIssue(
                    "triggerConfig.filters", "Chaque filtre doit être un objet JSON { field, op, value, value2? }."));
                continue;
            }
            ValidateScheduledFilter(filter, fields, errors);
        }
    }

    /// <summary>Filtre du balayage planifié : champ actif non calculé de l'entité, opérateur compatible avec son type.</summary>
    private static void ValidateScheduledFilter(
        JsonObject filter,
        IReadOnlyList<CustomFieldDefinition> fields,
        List<WorkflowValidationIssue> errors)
    {
        const string path = "triggerConfig.filters";
        if (!TryValidateFilterShape(path, filter, errors, out var field, out var op))
            return;

        var target = fields.FirstOrDefault(f => f.IsActive && f.Key == field);
        if (target is null)
        {
            errors.Add(new WorkflowValidationIssue(path, $"Champ de filtre inconnu ou inactif : « {field} »."));
            return;
        }
        if (CustomRecordValidator.IsComputed(target.FieldType))
        {
            errors.Add(new WorkflowValidationIssue(path, $"Champ calculé non filtrable : « {field} »."));
            return;
        }
        if (!RecordViewDefinitionValidator.IsOperatorCompatible(op!, target.FieldType))
            errors.Add(new WorkflowValidationIssue(path, $"Opérateur « {op} » incompatible avec le champ « {field} »."));
    }

    private static void ValidateStep(
        int i,
        WorkflowStepSpec step,
        ParsedWorkflowSpec spec,
        IReadOnlyDictionary<string, CustomFieldDefinition> activeFields,
        IReadOnlyDictionary<string, CustomFieldDefinition> eligibleFields,
        Func<string, AiToolDefinition?> resolveAction,
        Func<string, IReadOnlyList<CustomFieldDefinition>?> resolveEntityFields,
        List<WorkflowValidationIssue> errors)
    {
        // Propriété inconnue ⇒ message figé.
        var allowed = AllowedProperties[step.Type];
        foreach (var prop in step.Raw)
            if (!CommonProperties.Contains(prop.Key) && !allowed.Contains(prop.Key))
                errors.Add(new WorkflowValidationIssue(Path(i, prop.Key), $"Propriété « {prop.Key} » non reconnue."));

        switch (step.Type)
        {
            case StudioWorkflowStepTypes.Condition:
                ValidateCondition(i, step, activeFields, spec.IndexByKey, errors);
                break;
            case StudioWorkflowStepTypes.UpdateField:
                ValidateSetMap(i, step.Raw, eligibleFields, errors);
                break;
            case StudioWorkflowStepTypes.ErpAction:
                ValidateErpAction(i, step.Raw, resolveAction, errors);
                break;
            case StudioWorkflowStepTypes.Notify:
                ValidateNotify(i, step.Raw, errors);
                break;
            case StudioWorkflowStepTypes.Approval:
                ValidateApproval(i, step.Raw, spec.IndexByKey, errors);
                break;
            case StudioWorkflowStepTypes.Wait:
                ValidateWait(i, step.Raw, errors);
                break;
            case StudioWorkflowStepTypes.CreateRecord:
                ValidateCreateRecord(i, step.Raw, resolveEntityFields, errors);
                break;
        }
    }

    // --------------------------------------------------------------- Lint

    /// <summary>
    /// Avertissements non bloquants : étape sitôt après un « stop » de condition (jamais atteinte si la
    /// condition échoue), <c>erp_action</c> sans <c>saveResultAs</c> référencé par aucun <c>_results</c>,
    /// <c>approval</c> sans <c>dueInHours</c> explicite (72 h par défaut).
    /// </summary>
    public static IReadOnlyList<WorkflowValidationIssue> Lint(ParsedWorkflowSpec spec)
    {
        var warnings = new List<WorkflowValidationIssue>();
        for (var i = 0; i < spec.Steps.Count; i++)
        {
            var step = spec.Steps[i];
            switch (step.Type)
            {
                case StudioWorkflowStepTypes.Condition:
                    // « stop » est le défaut : la condition est un portail qui termine le flux quand elle
                    // échoue ; on avertit sur l'étape immédiatement suivante (le reste est en aval d'elle).
                    if (i + 1 < spec.Steps.Count && EffectiveEnum(step.Raw, "onFalse", "stop") == "stop")
                        warnings.Add(new WorkflowValidationIssue($"steps[{i + 1}]",
                            $"Étape « {spec.Steps[i + 1].Key} » jamais atteinte si la condition « {step.Key} » n'est pas remplie (« onFalse » = « stop »)."));
                    break;
                case StudioWorkflowStepTypes.ErpAction:
                    if (!TryReadString(step.Raw, "saveResultAs", out _, out _) && !ReferencesResult(spec, step.Key))
                        warnings.Add(new WorkflowValidationIssue($"steps[{i}]",
                            $"Étape « {step.Key} » : le résultat de l'action n'est pas mémorisé (« saveResultAs » absent) et n'est référencé par aucun « _results »."));
                    break;
                case StudioWorkflowStepTypes.Approval:
                    if (!step.Raw.ContainsKey("dueInHours"))
                        warnings.Add(new WorkflowValidationIssue($"steps[{i}].dueInHours",
                            $"Étape « {step.Key} » : délai d'approbation non précisé — 72 h par défaut."));
                    break;
            }
        }
        return warnings;
    }

    private static bool ReferencesResult(ParsedWorkflowSpec spec, string stepKey)
    {
        var needle = $"_results.{stepKey}";
        return spec.Steps.Any(s => s.Raw.ToJsonString().Contains(needle, StringComparison.Ordinal));
    }

    // ----------------------------------------------- Validateurs par type

    private static void ValidateCondition(
        int i,
        WorkflowStepSpec step,
        IReadOnlyDictionary<string, CustomFieldDefinition> activeFields,
        IReadOnlyDictionary<string, int> indexByKey,
        List<WorkflowValidationIssue> errors)
    {
        var raw = step.Raw;

        if (!raw.TryGetPropertyValue("filters", out var filtersNode) || filtersNode is not JsonArray filters)
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "filters"), "Une condition exige « filters » (1 à 10 filtres)."));
        }
        else
        {
            if (filters.Count is < 1 or > MaxFilters)
                errors.Add(new WorkflowValidationIssue(Path(i, "filters"), $"Une condition accepte de 1 à {MaxFilters} filtres."));
            foreach (var filterNode in filters.Take(MaxFilters))
            {
                if (filterNode is not JsonObject filter)
                {
                    errors.Add(new WorkflowValidationIssue(Path(i, "filters"), "Chaque filtre doit être un objet JSON { field, op, value, value2? }."));
                    continue;
                }
                ValidateConditionFilter(i, filter, activeFields, errors);
            }
        }

        ValidateEnumProp(i, raw, "match", MatchValues, errors);
        var onFalse = ValidateEnumProp(i, raw, "onFalse", OnFalseValues, errors) ?? "stop";
        ValidateGotoKey(i, raw, onFalse == "goto", indexByKey, errors);
    }

    private static void ValidateConditionFilter(
        int i,
        JsonObject filter,
        IReadOnlyDictionary<string, CustomFieldDefinition> activeFields,
        List<WorkflowValidationIssue> errors)
    {
        var path = Path(i, "filters");
        if (!TryValidateFilterShape(path, filter, errors, out var field, out var op))
            return;

        if (!TryResolveFilterFieldType(field!, activeFields, out var type, out var textVariable))
        {
            errors.Add(new WorkflowValidationIssue(path, $"Champ de filtre inconnu ou inactif : « {field} »."));
            return;
        }
        var compatible = textVariable
            ? TextVariableOperators.Contains(op!)
            : RecordViewDefinitionValidator.IsOperatorCompatible(op!, type!.Value);
        if (!compatible)
            errors.Add(new WorkflowValidationIssue(path, $"Opérateur « {op} » incompatible avec le champ « {field} »."));
    }

    /// <summary>
    /// Forme commune d'un filtre (4.7b1 : extraite de <c>ValidateConditionFilter</c> pour le planifié) :
    /// clés <c>{ field, op, value, value2? }</c>, <c>field</c> non vide, <c>op</c> ∈
    /// <c>StudioFilterEvaluator.Operators</c>. Retourne <c>false</c> si le filtre est rejeté.
    /// </summary>
    private static bool TryValidateFilterShape(
        string path,
        JsonObject filter,
        List<WorkflowValidationIssue> errors,
        out string? field,
        out string? op)
    {
        field = null;
        op = null;
        foreach (var prop in filter)
            if (prop.Key is not ("field" or "op" or "value" or "value2"))
                errors.Add(new WorkflowValidationIssue(path, $"Propriété « {prop.Key} » non reconnue."));

        if (!TryReadString(filter, "field", out field, out _) || string.IsNullOrWhiteSpace(field))
        {
            errors.Add(new WorkflowValidationIssue(path, "Chaque filtre exige « field » (chaîne non vide)."));
            return false;
        }
        if (!TryReadString(filter, "op", out op, out _) || string.IsNullOrWhiteSpace(op)
            || !StudioFilterEvaluator.Operators.Contains(op))
        {
            errors.Add(new WorkflowValidationIssue(path, $"Opérateur inconnu : « {op} »."));
            return false;
        }
        return true;
    }

    /// <summary>
    /// Type d'un champ de filtre : champ actif de l'entité, <c>_previous.&lt;champ&gt;</c> (même type),
    /// <c>_approval.&lt;clé&gt;.&lt;prop&gt;</c> / <c>_results.&lt;clé&gt;.&lt;prop&gt;</c> (variables texte).
    /// </summary>
    private static bool TryResolveFilterFieldType(
        string field,
        IReadOnlyDictionary<string, CustomFieldDefinition> activeFields,
        out CustomFieldType? type,
        out bool textVariable)
    {
        type = null;
        textVariable = false;

        if (field.StartsWith("_previous.", StringComparison.Ordinal))
        {
            var key = field["_previous.".Length..];
            if (key.Length == 0 || !activeFields.TryGetValue(key, out var previous))
                return false;
            type = previous.FieldType;
            return true;
        }
        if (field.StartsWith("_approval.", StringComparison.Ordinal) || field.StartsWith("_results.", StringComparison.Ordinal))
        {
            var segments = field.Split('.');
            if (segments.Length != 3 || segments[1].Length == 0 || segments[2].Length == 0)
                return false;
            if (segments[0] == "_approval" && segments[2] is not ("status" or "comment" or "decidedBy" or "decidedAt"))
                return false;
            textVariable = true;
            return true;
        }
        if (field.StartsWith('_'))
            return false;
        if (!activeFields.TryGetValue(field, out var plain))
            return false;
        type = plain.FieldType;
        return true;
    }

    private static void ValidateSetMap(
        int i,
        JsonObject raw,
        IReadOnlyDictionary<string, CustomFieldDefinition>? eligibleFields,
        List<WorkflowValidationIssue> errors)
    {
        if (!raw.TryGetPropertyValue("set", out var setNode) || setNode is not JsonObject set)
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "set"), "« set » est requis (1 à 10 paires champ → valeur, gabarits autorisés)."));
            return;
        }
        if (set.Count is < 1 or > MaxSetKeys)
            errors.Add(new WorkflowValidationIssue(Path(i, "set"), $"« set » accepte de 1 à {MaxSetKeys} champs."));
        if (eligibleFields is null)
            return; // table cible non résolue : l'erreur a déjà été consignée sur « entity »
        foreach (var pair in set)
            if (!eligibleFields.ContainsKey(pair.Key))
                errors.Add(new WorkflowValidationIssue(Path(i, "set"), $"Champ « {pair.Key} » inconnu, inactif ou calculé."));
    }

    private static void ValidateErpAction(
        int i,
        JsonObject raw,
        Func<string, AiToolDefinition?> resolveAction,
        List<WorkflowValidationIssue> errors)
    {
        AiToolDefinition? tool = null;
        if (!TryReadString(raw, "action", out var action, out _) || string.IsNullOrWhiteSpace(action))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "action"), "Une étape « erp_action » exige « action » (clé du catalogue Pont)."));
        }
        else
        {
            tool = resolveAction(action);
            if (tool is null)
                errors.Add(new WorkflowValidationIssue(Path(i, "action"), $"Action ERP « {action} » inconnue ou non autorisée."));
        }

        var mappedParams = new HashSet<string>(StringComparer.Ordinal);
        if (raw.TryGetPropertyValue("mapping", out var mappingNode))
        {
            if (mappingNode is not JsonArray mapping)
            {
                errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), "« mapping » doit être un tableau de { param, source, value }."));
            }
            else
            {
                if (mapping.Count > MaxMappings)
                    errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), $"« mapping » accepte au plus {MaxMappings} entrées."));
                foreach (var entry in mapping.Take(MaxMappings))
                {
                    if (entry is not JsonObject map)
                    {
                        errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), "Chaque entrée de « mapping » doit être un objet JSON."));
                        continue;
                    }
                    foreach (var prop in map)
                        if (prop.Key is not ("param" or "source" or "value"))
                            errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), $"Propriété « {prop.Key} » non reconnue."));
                    if (TryReadString(map, "param", out var param, out _) && !string.IsNullOrWhiteSpace(param))
                        mappedParams.Add(param!);
                    else
                        errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), "Chaque entrée de « mapping » exige « param » (chaîne non vide)."));
                    if (!TryReadString(map, "source", out var source, out _) || source is not ("field" or "const" or "template"))
                        errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), "« source » attendu parmi « field », « const », « template »."));
                    if (!map.ContainsKey("value"))
                        errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), "Chaque entrée de « mapping » exige « value »."));
                }
            }
        }

        if (tool is not null)
            foreach (var required in tool.RequiredParameters)
                if (!mappedParams.Contains(required))
                    errors.Add(new WorkflowValidationIssue(Path(i, "mapping"), $"Paramètre requis non couvert par « mapping » : « {required} »."));

        ValidateEnumProp(i, raw, "onFailure", OnFailureValues, errors);
        ValidateSaveResultAs(i, raw, errors);
    }

    private static void ValidateNotify(int i, JsonObject raw, List<WorkflowValidationIssue> errors)
    {
        ValidateRecipient(i, raw, "to", allowStartedBy: true, errors);
        ValidateTextProp(i, raw, "title", required: true, max: 200, errors);
        ValidateTextProp(i, raw, "body", required: false, max: 1000, errors);

        if (!TryReadString(raw, "link", out var link, out var invalid))
            return;
        if (invalid || string.IsNullOrEmpty(link))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "link"), "« link » doit être une chaîne non vide."));
            return;
        }
        if (link!.Length > 300)
            errors.Add(new WorkflowValidationIssue(Path(i, "link"), "« link » accepte au plus 300 caractères."));
        if (!link.StartsWith('/'))
            errors.Add(new WorkflowValidationIssue(Path(i, "link"), "« link » doit être relatif (commencer par « / »)."));
    }

    private static void ValidateApproval(
        int i,
        JsonObject raw,
        IReadOnlyDictionary<string, int> indexByKey,
        List<WorkflowValidationIssue> errors)
    {
        ValidateRecipient(i, raw, "assignee", allowStartedBy: false, errors);
        ValidateTextProp(i, raw, "title", required: true, max: 200, errors);
        ValidateTextProp(i, raw, "message", required: false, max: 1000, errors);
        ValidateHoursProp(i, raw, "dueInHours", errors);
        ValidateEnumProp(i, raw, "onTimeout", OnTimeoutValues, errors);
        var onReject = ValidateEnumProp(i, raw, "onReject", OnRejectValues, errors) ?? "stop";
        ValidateGotoKey(i, raw, onReject == "goto", indexByKey, errors);
    }

    private static void ValidateWait(int i, JsonObject raw, List<WorkflowValidationIssue> errors)
    {
        var hasHours = TryReadInt(raw, "hours", out var hours, out var hoursInvalid);
        var hoursOk = hasHours && !hoursInvalid && hours is >= 1 and <= MaxHours;
        if (hasHours && !hoursOk)
            errors.Add(new WorkflowValidationIssue(Path(i, "hours"), $"« hours » doit être un entier entre 1 et {MaxHours}."));

        var hasUntil = TryReadString(raw, "until", out var until, out var untilInvalid);
        var untilOk = hasUntil && !untilInvalid && !string.IsNullOrWhiteSpace(until);
        if (hasUntil && !untilOk)
            errors.Add(new WorkflowValidationIssue(Path(i, "until"), "« until » doit être un gabarit de date (chaîne non vide)."));

        if (hoursOk == untilOk)
            errors.Add(new WorkflowValidationIssue(Path(i, "hours"), "Précisez exactement un des deux : « hours » ou « until »."));

        ValidateHoursProp(i, raw, "maxHours", errors);
    }

    private static void ValidateCreateRecord(
        int i,
        JsonObject raw,
        Func<string, IReadOnlyList<CustomFieldDefinition>?> resolveEntityFields,
        List<WorkflowValidationIssue> errors)
    {
        IReadOnlyDictionary<string, CustomFieldDefinition>? targetEligible = null;
        if (!TryReadString(raw, "entity", out var entityKey, out _) || string.IsNullOrWhiteSpace(entityKey))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "entity"), "Une étape « create_record » exige « entity » (clé d'une table active)."));
        }
        else
        {
            // Le résolveur ne renvoie les champs que pour une table active et standard du tenant ;
            // null ⇒ inconnue, inactive ou jonction.
            var targetFields = resolveEntityFields(entityKey);
            if (targetFields is null)
                errors.Add(new WorkflowValidationIssue(Path(i, "entity"), $"Table cible « {entityKey} » inconnue, inactive ou de jonction."));
            else
                targetEligible = targetFields
                    .Where(f => f.IsActive && !CustomRecordValidator.IsComputed(f.FieldType))
                    .ToDictionary(f => f.Key, StringComparer.Ordinal);
        }

        ValidateSetMap(i, raw, targetEligible, errors);
        ValidateSaveResultAs(i, raw, errors);
    }

    // ---------------------------------------------------------- Propriétés

    private static void ValidateRecipient(
        int i,
        JsonObject raw,
        string name,
        bool allowStartedBy,
        List<WorkflowValidationIssue> errors)
    {
        var kinds = allowStartedBy ? "« user », « role » ou « startedBy »" : "« user » ou « role »";
        if (!raw.TryGetPropertyValue(name, out var node) || node is not JsonObject to)
        {
            errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name} » est requis ({{ kind, value }} ; kind ∈ {kinds})."));
            return;
        }
        foreach (var prop in to)
            if (prop.Key is not ("kind" or "value"))
                errors.Add(new WorkflowValidationIssue(Path(i, name), $"Propriété « {prop.Key} » non reconnue."));

        if (!TryReadString(to, "kind", out var kind, out _) || string.IsNullOrWhiteSpace(kind))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name}.kind » attendu parmi {kinds}."));
            return;
        }
        if (kind == "startedBy")
        {
            if (!allowStartedBy)
                errors.Add(new WorkflowValidationIssue(Path(i, name), "Le lanceur (« startedBy ») ne peut pas être l'approbateur."));
            return;
        }

        TryReadString(to, "value", out var value, out _);
        switch (kind)
        {
            case "user" when !Guid.TryParse(value, out _):
                errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name}.value » doit être l'identifiant (Guid) de l'utilisateur."));
                break;
            case "role" when !Enum.TryParse<UserRole>(value, ignoreCase: false, out _):
                errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name}.value » doit être un nom de rôle connu : « {value} »."));
                break;
            case "user" or "role":
                break;
            default:
                errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name}.kind » attendu parmi {kinds}."));
                break;
        }
    }

    private static void ValidateTextProp(
        int i,
        JsonObject raw,
        string name,
        bool required,
        int max,
        List<WorkflowValidationIssue> errors)
    {
        if (!TryReadString(raw, name, out var value, out var invalid))
        {
            if (required)
                errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name} » est requis (≤ {max} caractères)."));
            return;
        }
        if (invalid || (required && string.IsNullOrWhiteSpace(value)))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, name),
                invalid ? $"« {name} » doit être une chaîne." : $"« {name} » est requis (≤ {max} caractères)."));
            return;
        }
        if (value is not null && value.Length > max)
            errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name} » accepte au plus {max} caractères."));
    }

    private static void ValidateHoursProp(int i, JsonObject raw, string name, List<WorkflowValidationIssue> errors)
    {
        if (!TryReadInt(raw, name, out var hours, out var invalid))
            return;
        if (invalid || hours is < 1 or > MaxHours)
            errors.Add(new WorkflowValidationIssue(Path(i, name), $"« {name} » doit être un entier entre 1 et {MaxHours}."));
    }

    private static string? ValidateEnumProp(
        int i,
        JsonObject raw,
        string name,
        IReadOnlyList<string> allowedValues,
        List<WorkflowValidationIssue> errors)
    {
        if (!TryReadString(raw, name, out var value, out var invalid))
            return null;
        if (invalid || string.IsNullOrWhiteSpace(value) || !allowedValues.Contains(value, StringComparer.Ordinal))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, name),
                $"« {name} » attendu parmi {string.Join(", ", allowedValues.Select(v => $"« {v} »"))}."));
            return null;
        }
        return value;
    }

    private static void ValidateGotoKey(
        int i,
        JsonObject raw,
        bool required,
        IReadOnlyDictionary<string, int> indexByKey,
        List<WorkflowValidationIssue> errors)
    {
        if (!TryReadString(raw, "gotoKey", out var gotoKey, out var invalid))
        {
            if (required)
                errors.Add(new WorkflowValidationIssue(Path(i, "gotoKey"), "« gotoKey » est requis quand le branchement vaut « goto »."));
            return;
        }
        if (invalid || string.IsNullOrWhiteSpace(gotoKey))
        {
            errors.Add(new WorkflowValidationIssue(Path(i, "gotoKey"), "« gotoKey » doit être une clé d'étape (chaîne)."));
            return;
        }
        if (!indexByKey.TryGetValue(gotoKey!, out var target) || target <= i)
            errors.Add(new WorkflowValidationIssue(Path(i, "gotoKey"), $"« gotoKey » doit référencer une étape postérieure : « {gotoKey} »."));
    }

    private static void ValidateSaveResultAs(int i, JsonObject raw, List<WorkflowValidationIssue> errors)
    {
        if (!TryReadString(raw, "saveResultAs", out var saveAs, out var invalid))
            return;
        if (invalid || string.IsNullOrWhiteSpace(saveAs) || !SaveAsRegex.IsMatch(saveAs))
            errors.Add(new WorkflowValidationIssue(Path(i, "saveResultAs"),
                $"Nom de résultat invalide : « {saveAs} » (a-z, 0-9, _ ; 1 à 32 caractères, commence par une lettre)."));
    }

    // ------------------------------------------------------------ Helpers

    private static string Path(int i, string prop) => $"steps[{i}].{prop}";

    private static string EffectiveEnum(JsonObject raw, string name, string fallback)
        => TryReadString(raw, name, out var value, out _) && !string.IsNullOrWhiteSpace(value) ? value! : fallback;

    private static WorkflowValidationIssue ToIssue(Error error)
        => new(error.Code.StartsWith("Validation.", StringComparison.Ordinal)
                ? error.Code["Validation.".Length..]
                : "steps",
            error.Description);

    /// <summary>Lit une propriété chaîne ; <paramref name="invalid"/> = présente, non nulle, mais pas une chaîne.</summary>
    private static bool TryReadString(JsonObject obj, string name, out string? value, out bool invalid)
    {
        value = null;
        invalid = false;
        if (!obj.TryGetPropertyValue(name, out var node) || node is null)
            return false;
        if (node is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var s))
        {
            value = s;
            return true;
        }
        invalid = true;
        return true;
    }

    /// <summary>Lit une propriété entière ; <paramref name="invalid"/> = présente, non nulle, mais pas un entier.</summary>
    private static bool TryReadInt(JsonObject obj, string name, out int value, out bool invalid)
    {
        value = 0;
        invalid = false;
        if (!obj.TryGetPropertyValue(name, out var node) || node is null)
            return false;
        if (node is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var i))
        {
            value = i;
            return true;
        }
        invalid = true;
        return true;
    }
}
