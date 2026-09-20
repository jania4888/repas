using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Spec d'un plan de workflows proposé par l'IA (PR 4.3 — outil <c>studio_plan_workflow</c>) :
/// les workflows déjà normalisés (clés anglaises) et les avertissements à remonter à l'utilisateur.
/// </summary>
public sealed record ParsedWorkflowPlanSpec(
    IReadOnlyList<ParsedWorkflowItem> Workflows,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Un workflow normalisé de la spec. <see cref="IsActive"/> est TOUJOURS <c>false</c> (D-08) :
/// l'utilisateur active le workflow après relecture, jamais l'IA.
/// </summary>
public sealed record ParsedWorkflowItem(
    string EntityKey,
    string Key,
    string Name,
    string? Description,
    StudioWorkflowTriggerKind Trigger,
    JsonObject TriggerConfig,
    JsonObject Steps,
    bool IsActive);

/// <summary>
/// Parse la spec tolérante émise par le modèle (alias FR/EN insensibles à la casse et aux accents,
/// racine tableau ou objet) et la normalise vers la forme exacte de
/// <see cref="StudioWorkflowStepsSpec"/> (<c>{ "version": 1, "steps": [ { "key", "type", … } ] }</c>).
/// Jamais silencieux : toute dégradation est une erreur en clair (jamais de troncature). Depuis 4.7b5,
/// le déclencheur <c>scheduled</c> est conservé (D5 levé en 4.7b1) : la validation du cron et des
/// filtres fait foi en aval (<see cref="StudioWorkflowStepsSpec.Validate"/> + contrôle bloquant du
/// planificateur). Les bornes fines (10 filtres, 20 mappings, 720 h) sont laissées à
/// <see cref="StudioWorkflowStepsSpec.Validate"/> (4.3f) pour ne pas dupliquer le validateur.
/// </summary>
public static class StudioAiWorkflowSpec
{
    /// <summary>Nombre maximal de workflows dans un plan.</summary>
    public const int MaxWorkflows = 5;

    /// <summary>Parse une spec JSON complète (outil <c>studio_plan_workflow</c>).</summary>
    public static bool TryParse(string? specJson, out ParsedWorkflowPlanSpec? spec, out string? error)
    {
        spec = null;
        error = null;
        if (string.IsNullOrWhiteSpace(specJson)) { error = "spec_json est vide."; return false; }

        JsonNode? root;
        try { root = JsonNode.Parse(specJson); }
        catch (JsonException) { error = "spec_json n'est pas un JSON valide."; return false; }

        return TryParseNode(root, out spec, out error);
    }

    /// <summary>Parse un nœud déjà lu (réutilisable par un parseur de spec composite).</summary>
    public static bool TryParseNode(JsonNode? node, out ParsedWorkflowPlanSpec? spec, out string? error)
    {
        spec = null;
        error = null;

        // Racine : tableau nu, ou objet { workflows|automatisations : [...] }.
        JsonArray? array = node as JsonArray;
        if (array is null)
        {
            if (node is not JsonObject rootObj)
            {
                error = "La spec doit être un objet { \"workflows\": [ … ] } ou un tableau de workflows.";
                return false;
            }
            if (GetAliased(rootObj, "workflows", "automatisations") is not JsonArray arr)
            {
                error = "La propriété « workflows » est manquante ou n'est pas un tableau.";
                return false;
            }
            array = arr;
        }
        if (array.Count == 0)
        {
            error = "La spec ne contient aucun workflow.";
            return false;
        }

        var warnings = new List<string>();
        var items = new List<ParsedWorkflowItem>();
        foreach (var entry in array)
        {
            if (entry is not JsonObject wf)
            {
                error = "Chaque workflow doit être un objet JSON.";
                return false;
            }

            var name = Str(GetAliased(wf, "name", "nom"))?.Trim();
            var triggerRaw = Str(GetAliased(wf, "trigger", "declencheur"));
            // 4.7b5 : `scheduled` est conservé (D5 levé en b1) — cron et filtres validés en aval.
            if (!TryParseItem(wf, name, triggerRaw, out var item, out error))
                return false;
            items.Add(item!);
        }

        if (items.Count == 0)
        {
            error = "La spec ne contient aucun workflow.";
            return false;
        }
        if (items.Count > MaxWorkflows)
        {
            error = $"La spec propose plus de {MaxWorkflows} workflows ({MaxWorkflows} max).";
            return false;
        }

        spec = new ParsedWorkflowPlanSpec(items, warnings);
        return true;
    }

    /// <summary>Demande d'enregistrement (4.1j) d'un item : déclencheur en snake_case, inactif forcé (D-08).</summary>
    public static SaveWorkflowRequest ToSaveRequest(ParsedWorkflowItem item) =>
        new(item.Key, item.Name, item.Description, StudioWorkflowEnumNames.TriggerName(item.Trigger),
            item.TriggerConfig, item.Steps, IsActive: false, RowVersion: null);

    // ---------------------------------------------------------------- un workflow

    private static bool TryParseItem(
        JsonObject wf, string? name, string? triggerRaw, out ParsedWorkflowItem? item, out string? error)
    {
        item = null;
        error = null;

        var entityRaw = Str(GetAliased(wf, "entityKey", "entity", "table", "entite"));
        if (string.IsNullOrWhiteSpace(entityRaw))
        {
            error = "entityKey est obligatoire (clé de la table cible).";
            return false;
        }
        // Normalisée comme les refs de spec (le modèle écrit souvent le libellé) ; l'existence est
        // revérifiée contre le schéma réel à l'aperçu (4.3c) et à l'exécution (4.3f).
        var entitySlug = StudioAiAppSpec.SlugKey(entityRaw);
        var entityKey = string.IsNullOrEmpty(entitySlug) ? entityRaw!.Trim() : entitySlug;

        if (string.IsNullOrWhiteSpace(name))
        {
            error = "name est obligatoire (nom du workflow).";
            return false;
        }

        var key = Str(GetAliased(wf, "key", "cle"))?.Trim();
        if (string.IsNullOrWhiteSpace(key))
            key = StudioKey.Slugify(name);
        if (!StudioKey.IsValidShape(key))
        {
            error = $"Clé de workflow invalide : « {key} » (a-z, 0-9, _ ; 2 à 64 caractères, commence par une lettre).";
            return false;
        }

        var trigger = ParseTrigger(triggerRaw);
        if (trigger is null)
        {
            error = string.IsNullOrWhiteSpace(triggerRaw)
                ? $"Workflow « {name} » : trigger est obligatoire (on_create, on_update, field_changed, manual ou scheduled)."
                : $"Workflow « {name} » : déclencheur inconnu « {triggerRaw} » (attendu : on_create, on_update, field_changed, manual ou scheduled).";
            return false;
        }

        var triggerConfig = ParseTriggerConfig(wf, trigger.Value, out error);
        if (triggerConfig is null)
            return false;

        if (GetAliased(wf, "steps", "etapes") is not JsonArray stepsArray || stepsArray.Count == 0)
        {
            error = $"Workflow « {name} » : au moins une étape est requise (steps).";
            return false;
        }
        if (stepsArray.Count > StudioWorkflowStepsSpec.MaxSteps)
        {
            error = $"Workflow « {name} » : un workflow comporte au plus {StudioWorkflowStepsSpec.MaxSteps} étapes.";
            return false;
        }
        if (!TryParseSteps(stepsArray, name!, out var steps, out error))
            return false;

        if (Encoding.UTF8.GetByteCount(triggerConfig.ToJsonString()) > StudioWorkflowStepsSpec.MaxTriggerConfigBytes)
        {
            error = $"Workflow « {name} » : la configuration du déclencheur dépasse 2 Ko.";
            return false;
        }
        if (Encoding.UTF8.GetByteCount(steps.ToJsonString()) > StudioWorkflowStepsSpec.MaxStepsJsonBytes)
        {
            error = $"Workflow « {name} » : la définition des étapes dépasse 64 Ko.";
            return false;
        }

        item = new ParsedWorkflowItem(
            entityKey, key!, name!, Str(wf["description"])?.Trim(),
            trigger.Value, triggerConfig, steps, IsActive: false);
        return true;
    }

    // ---------------------------------------------------------------- étapes

    private static bool TryParseSteps(JsonArray stepsArray, string workflowName, out JsonObject steps, out string? error)
    {
        steps = new JsonObject();
        error = null;

        var normalized = new JsonArray();
        var usedKeys = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < stepsArray.Count; i++)
        {
            if (stepsArray[i] is not JsonObject stepObj)
            {
                error = $"Workflow « {workflowName} » : chaque étape doit être un objet JSON.";
                return false;
            }

            var typeRaw = Str(stepObj["type"]);
            var type = typeRaw is null ? null : ParseStepType(typeRaw);
            if (type is null)
            {
                error = $"Workflow « {workflowName} » : type d'étape inconnu : « {typeRaw} ».";
                return false;
            }

            var key = Str(GetAliased(stepObj, "key", "cle"))?.Trim();
            if (key is null)
            {
                // Clé dérivée : etape_1, etape_2… (suffixée si une clé explicite l'a déjà prise).
                var baseKey = $"etape_{i + 1}";
                key = baseKey;
                for (var n = 2; usedKeys.Contains(key) && n <= 99; n++)
                    key = $"{baseKey}_{n}";
            }
            if (!StudioKey.IsValidShape(key))
            {
                error = $"Workflow « {workflowName} » : clé d'étape invalide : « {key} » (a-z, 0-9, _ ; 2 à 64 caractères, commence par une lettre).";
                return false;
            }
            if (!usedKeys.Add(key))
            {
                error = $"Workflow « {workflowName} » : clé d'étape déjà utilisée : « {key} ».";
                return false;
            }

            var label = Str(GetAliased(stepObj, "label", "libelle"))?.Trim();

            var output = new JsonObject
            {
                ["key"] = key,
                ["type"] = type
            };
            if (label is not null) output["label"] = label;

            // Propriétés : alias FR/EN normalisés vers les clés anglaises du catalogue (les clés
            // inconnues sont CONSERVÉES — le validateur les signalera à l'aperçu, rien n'est perdu).
            foreach (var prop in stepObj)
            {
                var normalizedName = NormalizeAlias(prop.Key);
                if (normalizedName is "type" or "key" or "cle" or "label" or "libelle")
                    continue;
                output[CanonicalStepProperty(type, normalizedName, prop.Key)] = prop.Value?.DeepClone();
            }
            normalized.Add(output);
        }

        steps["version"] = 1;
        steps["steps"] = normalized;
        return true;
    }

    // ---------------------------------------------------------------- déclencheur

    private static StudioWorkflowTriggerKind? ParseTrigger(string? raw) =>
        raw is null ? null : NormalizeAlias(raw) switch
        {
            "on_create" or "creation" or "a_la_creation" => StudioWorkflowTriggerKind.OnCreate,
            "on_update" or "modification" => StudioWorkflowTriggerKind.OnUpdate,
            "field_changed" or "changement_champ" => StudioWorkflowTriggerKind.FieldChanged,
            "manual" or "manuel" => StudioWorkflowTriggerKind.Manual,
            "scheduled" or "planifie" => StudioWorkflowTriggerKind.Scheduled,
            _ => null
        };

    /// <summary>
    /// Configuration normalisée du déclencheur : <c>field|champ</c>, <c>from|de</c>, <c>to|vers</c> pour
    /// <c>field_changed</c> ; <c>filters|filtres</c> pour <c>scheduled</c> (4.7b5) ; objet vide par
    /// défaut. Les clés inconnues sont conservées (le validateur les signalera) — sauf les alias
    /// reconnus, traduits.
    /// </summary>
    private static JsonObject? ParseTriggerConfig(JsonObject wf, StudioWorkflowTriggerKind trigger, out string? error)
    {
        error = null;
        var config = new JsonObject();
        if (GetAliased(wf, "triggerConfig", "config") is not { } node)
            return config;
        if (node is not JsonObject obj)
        {
            error = "triggerConfig doit être un objet JSON.";
            return null;
        }
        foreach (var prop in obj)
        {
            var key = trigger switch
            {
                StudioWorkflowTriggerKind.FieldChanged => NormalizeAlias(prop.Key) switch
                {
                    "field" or "champ" => "field",
                    "from" or "de" => "from",
                    "to" or "vers" => "to",
                    _ => prop.Key
                },
                // 4.7b5 : alias FR des filtres planifiés ; cron et bornes validés en aval (b1).
                StudioWorkflowTriggerKind.Scheduled => NormalizeAlias(prop.Key) switch
                {
                    "filters" or "filtres" => "filters",
                    _ => prop.Key
                },
                _ => prop.Key
            };
            config[key] = prop.Value?.DeepClone();
        }
        return config;
    }

    // ---------------------------------------------------------------- alias

    /// <summary>Alias de types d'étape (normalisés : minuscules, sans accents) ; null = inconnu.</summary>
    private static string? ParseStepType(string raw) => NormalizeAlias(raw) switch
    {
        "condition" or "si" => StudioWorkflowStepTypes.Condition,
        "update_field" or "modifier_champ" or "mettre_a_jour" => StudioWorkflowStepTypes.UpdateField,
        "erp_action" or "action_erp" or "action" => StudioWorkflowStepTypes.ErpAction,
        "notify" or "notifier" or "notification" => StudioWorkflowStepTypes.Notify,
        "approval" or "approbation" or "validation" => StudioWorkflowStepTypes.Approval,
        "wait" or "attendre" or "delai" or "attente" => StudioWorkflowStepTypes.Wait,
        "create_record" or "creer_enregistrement" => StudioWorkflowStepTypes.CreateRecord,
        _ => null
    };

    /// <summary>
    /// Nom canonique (catalogue §0.5) d'une propriété d'étape écrite par le modèle ; la clé d'origine
    /// est conservée quand aucun alias ne correspond (le validateur la signalera à l'aperçu).
    /// <c>body|message|texte</c> est conscient du type : <c>body</c> pour notify, <c>message</c> pour approval.
    /// </summary>
    private static string CanonicalStepProperty(string stepType, string normalizedName, string originalName) =>
        normalizedName switch
        {
            "filters" or "filtres" or "conditions" => "filters",
            "match" => "match",
            "onfalse" or "sinon" => "onFalse",
            "gotokey" => "gotoKey",
            "set" or "valeurs" => "set",
            "action" => "action",
            "mapping" or "parametres" => "mapping",
            "onfailure" => "onFailure",
            "saveresultas" => "saveResultAs",
            "to" or "destinataire" => "to",
            "title" or "titre" => "title",
            "body" or "message" or "texte" => stepType == StudioWorkflowStepTypes.Approval
                ? "message"
                : stepType == StudioWorkflowStepTypes.Notify ? "body" : originalName,
            "link" => "link",
            "assignee" or "approbateur" => "assignee",
            "dueinhours" or "delai_heures" => "dueInHours",
            "ontimeout" or "si_expiration" => "onTimeout",
            "onreject" or "si_refus" => "onReject",
            "hours" or "heures" => "hours",
            "until" => "until",
            "maxhours" => "maxHours",
            "entity" => "entity",
            _ => originalName
        };

    /// <summary>Première propriété dont le nom normalisé (casse/accents) figure parmi les alias (normalisés aussi).</summary>
    private static JsonNode? GetAliased(JsonObject obj, params string[] aliases)
    {
        foreach (var prop in obj)
        {
            var normalizedKey = NormalizeAlias(prop.Key);
            foreach (var alias in aliases)
                if (string.Equals(normalizedKey, NormalizeAlias(alias), StringComparison.Ordinal))
                    return prop.Value;
        }
        return null;
    }

    /// <summary>Normalisation des alias : minuscules + sans accents (même base que StudioAiRecordViewSpec).</summary>
    private static string NormalizeAlias(string raw) =>
        StudioAiAppSpec.RemoveDiacritics(raw).Trim().ToLowerInvariant();

    private static string? Str(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<string>(out var s)) return string.IsNullOrWhiteSpace(s) ? null : s;
        return v.ToString();
    }
}
