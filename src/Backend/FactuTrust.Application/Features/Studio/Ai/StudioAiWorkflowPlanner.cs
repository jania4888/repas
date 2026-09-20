using System.Text.Json.Nodes;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// PR 4.3c — contrôles LÉGERS d'un plan de workflows contre le schéma réel, exécutés à l'aperçu
/// (outil <c>studio_plan_workflow</c>). La validation complète (<see cref="StudioWorkflowStepsSpec.Validate"/>,
/// entités Domain) reste faite à l'exécution par <c>CreateWorkflowCommand</c> : ici on bloque seulement ce qui
/// est manifestement faux pour que l'utilisateur ne valide pas un plan voué à l'échec.
/// Pur : aucune I/O, les schémas et la résolution d'action sont passés en paramètre.
/// </summary>
public static class StudioAiWorkflowPlanner
{
    /// <summary>Résultat des contrôles : erreurs bloquantes (plan refusé) et avertissements (plan accepté, à relire).</summary>
    public sealed record WorkflowPlanReview(IReadOnlyList<string> BlockingErrors, IReadOnlyList<string> Warnings)
    {
        /// <summary>Vrai dès qu'une erreur bloquante est présente.</summary>
        public bool IsBlocked => BlockingErrors.Count > 0;
    }

    /// <summary>Avertissement ajouté à tout plan accepté : les workflows sont créés inactifs (D-08).</summary>
    public const string InactiveWarning = "Les workflows seront créés inactifs : activez-les depuis le hub après relecture.";

    /// <summary>Contrôle un plan de workflows parsé contre les schémas réels des tables citées.</summary>
    /// <param name="spec">plan parsé et normalisé (<see cref="StudioAiWorkflowSpec.TryParse"/>).</param>
    /// <param name="schemasByEntityKey">schémas réels des tables citées (clé normalisée) ; une table absente ⇒ erreur bloquante.</param>
    /// <param name="resolveAction">résolution d'une clé d'action ERP (AiToolRegistry.GetToolDefinition).</param>
    public static WorkflowPlanReview Review(
        ParsedWorkflowPlanSpec spec,
        IReadOnlyDictionary<string, CustomEntitySchemaDto> schemasByEntityKey,
        Func<string, AiToolDefinition?> resolveAction)
    {
        var errors = new List<string>();
        var warnings = new List<string>(spec.Warnings);

        foreach (var wf in spec.Workflows)
        {
            if (!schemasByEntityKey.TryGetValue(wf.EntityKey, out var schema) || !schema.Entity.IsActive)
            {
                errors.Add($"Workflow « {wf.Name} » : table « {wf.EntityKey} » introuvable ou inactive.");
                continue;
            }
            var fields = schema.Fields.Select(f => f.Key).ToHashSet(StringComparer.Ordinal);

            if (wf.Trigger == StudioWorkflowTriggerKind.FieldChanged)
            {
                var field = Str(wf.TriggerConfig["field"]);
                if (field is null || !fields.Contains(field))
                    errors.Add($"Workflow « {wf.Name} » : le champ déclencheur « {field ?? "?"} » n'existe pas dans « {schema.Entity.DisplayName} ».");
            }

            // 4.7b5 : un plan planifié sans cron valide est bloqué ici (manifestement faux) ; les
            // bornes fines des filtres restent à la validation complète (b1) à l'exécution.
            if (wf.Trigger == StudioWorkflowTriggerKind.Scheduled
                && !StudioWorkflowCronSpec.TryParse(Str(wf.TriggerConfig["cron"]), out _))
                errors.Add($"Workflow « {wf.Name} » : déclencheur planifié sans expression cron valide (triggerConfig.cron — 5 champs, UTC).");

            if (wf.Steps["steps"] is not JsonArray steps) continue;
            foreach (var step in steps.OfType<JsonObject>())
                ReviewStep(wf, step, fields, schema.Entity.DisplayName, resolveAction, errors);
        }

        if (errors.Count == 0) warnings.Add(InactiveWarning);
        return new WorkflowPlanReview(errors, warnings);
    }

    private static void ReviewStep(ParsedWorkflowItem wf, JsonObject step, HashSet<string> fields,
        string entityName, Func<string, AiToolDefinition?> resolveAction, List<string> errors)
    {
        var key = Str(step["key"]) ?? "?";
        switch (Str(step["type"]))
        {
            case StudioWorkflowStepTypes.UpdateField:
                if (step["set"] is JsonObject set)
                    foreach (var f in set.Select(p => p.Key).Where(f => !fields.Contains(f)))
                        errors.Add($"Workflow « {wf.Name} », étape « {key} » : champ « {f} » inconnu dans « {entityName} ».");
                break;
            case StudioWorkflowStepTypes.Condition:
                if (step["filters"] is JsonArray filters)
                    foreach (var f in filters.OfType<JsonObject>().Select(x => Str(x["field"])).OfType<string>())
                        if (!IsKnownConditionField(f, fields))
                            errors.Add($"Workflow « {wf.Name} », étape « {key} » : champ « {f} » inconnu dans « {entityName} ».");
                break;
            case StudioWorkflowStepTypes.ErpAction:
                var action = Str(step["action"]);
                var tool = action is null ? null : resolveAction(action);
                if (tool is null || !StudioBridgeActionCatalog.IsBridgeable(tool))
                    errors.Add($"Workflow « {wf.Name} », étape « {key} » : action ERP « {action ?? "?"} » inconnue ou non autorisée.");
                break;
            case StudioWorkflowStepTypes.Approval:
                if (step["assignee"] is JsonObject a && string.Equals(Str(a["kind"]), "startedBy", StringComparison.OrdinalIgnoreCase))
                    errors.Add($"Workflow « {wf.Name} », étape « {key} » : le lanceur (« startedBy ») ne peut pas être l'approbateur.");
                break;
        }
    }

    // _previous.<champ>, _approval.<clé>.status, _results.<clé>.<prop> sont résolus par le moteur : tolérés ici.
    private static bool IsKnownConditionField(string field, HashSet<string> fields) =>
        fields.Contains(field)
        || field.StartsWith("_previous.", StringComparison.Ordinal) && fields.Contains(field["_previous.".Length..])
        || field.StartsWith("_approval.", StringComparison.Ordinal)
        || field.StartsWith("_results.", StringComparison.Ordinal);

    private static string? Str(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;
}
