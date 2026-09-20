using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>Une opération de modification d'un artefact Studio existant.</summary>
public abstract record ParsedAmendmentOp(string Op);

/// <summary>Ajout d'un champ. Le champ est déjà normalisé (type, options, config).</summary>
public sealed record AddFieldOp(ParsedAppField Field) : ParsedAmendmentOp("add_field");

/// <summary>
/// Modification d'un champ existant. <paramref name="FieldRef"/> est la référence BRUTE écrite par le
/// modèle (clé ou libellé) : elle est résolue contre le schéma réel au moment de l'aperçu et de
/// l'exécution. Seules les propriétés non nulles sont appliquées.
/// </summary>
public sealed record UpdateFieldOp(
    string FieldRef,
    string? Label,
    bool? Required,
    bool? Unique,
    IReadOnlyList<SelectOptionDto>? AddOptions) : ParsedAmendmentOp("update_field");

/// <summary>Retrait d'un champ : désactivation (les données saisies restent conservées).</summary>
public sealed record RemoveFieldOp(string FieldRef) : ParsedAmendmentOp("remove_field");

public sealed record UpdateEntityOp(
    string? DisplayName,
    string? DisplayNamePlural,
    string? Icon,
    string? Description) : ParsedAmendmentOp("update_entity");

/// <summary>Remplacement de la mise en page du formulaire. Résolu contre les champs réels.</summary>
public sealed record SetFormOp(JsonNode FormNode) : ParsedAmendmentOp("set_form");

/// <summary>Création/remplacement d'un état. Résolu contre les champs réels.</summary>
public sealed record SetReportOp(string? DisplayName, JsonNode ReportNode) : ParsedAmendmentOp("set_report");

/// <summary>
/// Réordonne les champs (PR 3.1b). Références BRUTES (clé ou libellé), résolues contre le schéma
/// réel à l'aperçu/l'exécution ; toute référence introuvable est retirée avec un avertissement. Les
/// champs non cités conservent leur position relative existante (l'exécuteur complète la liste).
/// </summary>
public sealed record ReorderFieldsOp(IReadOnlyList<string> FieldRefs) : ParsedAmendmentOp("reorder_fields");

/// <summary>
/// Change le type d'un champ existant (PR 3.1b). La classification Lossless / RequiresEmptyTable /
/// Forbidden n'est PAS appliquée ici (matrice D4 — <see cref="FieldTypeConversionPolicy"/>) : cette
/// spec accepte n'importe quel type d'énumération valide, y compris les cibles interdites, pour que
/// l'aperçu puisse les signaler explicitement en erreur plutôt que les faire disparaître au parsing.
/// </summary>
public sealed record ChangeFieldTypeOp(
    string FieldRef,
    CustomFieldType FieldType,
    IReadOnlyList<SelectOptionDto>? Options,
    RelationRefDto? Relation,
    IReadOnlyDictionary<string, JsonNode?>? Config) : ParsedAmendmentOp("change_field_type");

/// <summary>
/// Ajoute une relation vers une autre table (PR 3.1b). <c>Kind</c> est déjà normalisé vers
/// <see cref="EntityRelationKinds.ManyToOne"/> ou <see cref="EntityRelationKinds.ManyToMany"/> ;
/// <c>TargetRef</c> est la clé normalisée (slug) de la table cible — son existence et son type
/// (standard, pas jonction) sont revérifiés à l'exécution, contre le schéma réel.
/// </summary>
public sealed record AddRelationOp(
    string Kind, string TargetRef, string? Label, string? JunctionName) : ParsedAmendmentOp("add_relation");

/// <summary>
/// Rattache (ou détache si <c>SystemRef</c> est null) la table à un système (PR 3.1b). Clé de
/// système normalisée (slug), résolue à l'exécution via <c>GetCustomSystemByKeyQuery</c>.
/// </summary>
public sealed record AssignSystemOp(string? SystemRef) : ParsedAmendmentOp("assign_system");

/// <summary>Ajoute une vue enregistrée sur la table (PR 3.1b) — enveloppe une spec de vue déjà parsée.</summary>
public sealed record SetViewOp(ParsedRecordViewSpec View) : ParsedAmendmentOp("set_view");

/// <summary>
/// Automatisation demandée (PR 3.1b) — PAS ENCORE prise en charge : l'exécuteur ignore toujours cette
/// étape (statut « skipped ») et avertit l'utilisateur. Le nœud brut est conservé pour un round-trip
/// canonique stable, indépendamment de son contenu.
/// </summary>
public sealed record SetAutomationOp(JsonObject Node) : ParsedAmendmentOp("set_automation");

public sealed record ParsedAmendmentSpec(
    string TargetEntityRef,
    IReadOnlyList<ParsedAmendmentOp> Operations,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Analyse la spécification de MODIFICATION d'une table Studio existante (<c>studio_plan_changes</c>).
/// Pur (aucun accès base) et tolérant comme <see cref="StudioAiSystemSpec"/> : une opération inconnue
/// ou mal formée est ignorée avec un avertissement plutôt que de faire échouer toute la demande.
/// Liste blanche stricte d'opérations : ni suppression de table, ni suppression de système.
/// Les références de champ restent BRUTES ici — elles sont résolues contre le schéma réel par
/// <see cref="StudioAiAmendmentPlanner"/> (aperçu) puis à nouveau à l'exécution.
/// </summary>
public static class StudioAiAmendmentSpec
{
    public const int MaxOperations = 20;

    private static readonly HashSet<string> ManyToOneAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        "many_to_one", "manytoone", "many-to-one", "n_1", "n-1", "plusieurs_a_un", "plusieurs-a-un"
    };

    private static readonly HashSet<string> ManyToManyAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        "many_to_many", "manytomany", "many-to-many", "n_n", "nn", "n-n", "plusieurs_a_plusieurs",
        "plusieurs-a-plusieurs", "m2m"
    };

    private static readonly HashSet<string> DetachSystemAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        "none", "aucun", "aucune", "retirer", "detacher", "détacher", "null"
    };

    public static bool TryParse(string? specJson, out ParsedAmendmentSpec? spec, out string? error)
    {
        spec = null;
        error = null;
        if (string.IsNullOrWhiteSpace(specJson)) { error = "spec_json est vide."; return false; }

        JsonNode? root;
        try { root = JsonNode.Parse(specJson); }
        catch (JsonException) { error = "spec_json n'est pas un JSON valide."; return false; }

        var target = Str(root?["target"]?["entityKey"])
            ?? Str(root?["target"]?["table"])
            ?? Str(root?["entityKey"])
            ?? Str(root?["table"]);
        if (string.IsNullOrWhiteSpace(target))
        {
            error = "target.entityKey est obligatoire (la table à modifier).";
            return false;
        }

        var opsArr = (root?["operations"] ?? root?["changes"] ?? root?["ops"])?.AsArray();
        if (opsArr is null || opsArr.Count == 0)
        {
            error = "Au moins une opération est requise.";
            return false;
        }

        var warnings = new List<string>();
        var operations = new List<ParsedAmendmentOp>();

        foreach (var node in opsArr)
        {
            if (operations.Count >= MaxOperations)
            {
                warnings.Add($"Au-delà de {MaxOperations} opérations, les suivantes ont été ignorées.");
                break;
            }
            if (node is not JsonObject obj) continue;

            var op = (Str(obj["op"]) ?? Str(obj["action"]) ?? string.Empty).Trim();

            // Liste blanche = les cas du switch (source unique) : toute opération inconnue est
            // écartée AVEC avertissement par le default de ParseOperation, jamais silencieusement.
            var parsed = ParseOperation(op, obj, warnings);
            if (parsed is not null) operations.Add(parsed);
        }

        if (operations.Count == 0)
        {
            error = "Aucune opération de modification valide.";
            return false;
        }

        spec = new ParsedAmendmentSpec(StudioAiAppSpec.SlugKey(target!), operations, warnings);
        return true;
    }

    private static ParsedAmendmentOp? ParseOperation(string op, JsonObject obj, List<string> warnings)
    {
        switch (op.ToLowerInvariant())
        {
            case "add_field":
            {
                var field = ParseSingleField(obj);
                if (field is null)
                {
                    warnings.Add("Ajout de champ ignoré : libellé manquant.");
                    return null;
                }
                return new AddFieldOp(field);
            }
            case "update_field":
            {
                var fieldRef = FieldRef(obj);
                if (fieldRef is null)
                {
                    warnings.Add("Modification de champ ignorée : champ cible non précisé.");
                    return null;
                }
                return new UpdateFieldOp(
                    fieldRef,
                    Str(obj["label"]) ?? Str(obj["newLabel"]),
                    Bool(obj["required"]) ?? Bool(obj["isRequired"]),
                    Bool(obj["unique"]) ?? Bool(obj["isUnique"]),
                    ParseOptions(obj["addOptions"] ?? obj["options"]));
            }
            case "remove_field":
            {
                var fieldRef = FieldRef(obj);
                if (fieldRef is null)
                {
                    warnings.Add("Retrait de champ ignoré : champ cible non précisé.");
                    return null;
                }
                return new RemoveFieldOp(fieldRef);
            }
            case "update_entity":
            {
                var display = Str(obj["displayName"]) ?? Str(obj["name"]);
                var plural = Str(obj["displayNamePlural"]);
                var icon = Str(obj["icon"]);
                var description = Str(obj["description"]);
                if (display is null && plural is null && icon is null && description is null)
                {
                    warnings.Add("Modification de la table ignorée : aucune propriété fournie.");
                    return null;
                }
                return new UpdateEntityOp(display, plural, icon, description);
            }
            case "set_form":
            {
                // Le nœud peut être { "sections": [...] } ou directement [ ... ].
                var form = obj["form"] ?? (obj["sections"] is not null
                    ? new JsonObject { ["sections"] = obj["sections"]!.DeepClone() }
                    : null);
                if (form is null)
                {
                    warnings.Add("Mise en page du formulaire ignorée : sections manquantes.");
                    return null;
                }
                return new SetFormOp(form.DeepClone());
            }
            case "set_report":
            {
                var report = obj["definition"] ?? obj["report"];
                if (report is null)
                {
                    // Tolérance : le modèle a pu poser groupBy/measures directement sur l'opération.
                    var inline = new JsonObject();
                    foreach (var key in new[] { "groupBy", "measures", "columns", "filters", "sort" })
                        if (obj[key] is not null) inline[key] = obj[key]!.DeepClone();
                    if (inline.Count == 0)
                    {
                        warnings.Add("État ignoré : définition manquante.");
                        return null;
                    }
                    report = inline;
                }
                return new SetReportOp(Str(obj["displayName"]) ?? Str(obj["title"]), report.DeepClone());
            }
            case "reorder_fields":
            case "reorder":
            case "reordonner_champs":
            case "reorganiser_champs":
            {
                var refs = new List<string>();
                var seenRefs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in (obj["fields"] ?? obj["order"] ?? obj["ordre"])?.AsArray() ?? new JsonArray())
                {
                    var raw = Str(item)?.Trim();
                    // Déduplication dès le parsing (forme canonique propre) ; la résolution au
                    // schéma réel déduplique aussi les alias pointant vers le même champ.
                    if (raw is not null && seenRefs.Add(raw)) refs.Add(raw);
                }
                if (refs.Count == 0)
                {
                    warnings.Add("Réorganisation des champs ignorée : aucune référence de champ fournie.");
                    return null;
                }
                return new ReorderFieldsOp(refs);
            }
            case "change_field_type":
            case "change_type":
            case "changer_type":
            case "convertir_champ":
            {
                var fieldRef = FieldRef(obj);
                if (fieldRef is null)
                {
                    warnings.Add("Changement de type ignoré : champ cible non précisé.");
                    return null;
                }
                var rawType = Str(obj["type"]) ?? Str(obj["fieldType"]) ?? Str(obj["to"]);
                if (!StudioAiAppSpec.TryMapType(rawType, out var fieldType))
                {
                    warnings.Add($"Changement de type ignoré : type « {rawType ?? "?"} » inconnu.");
                    return null;
                }
                return new ChangeFieldTypeOp(
                    fieldRef, fieldType, ParseOptions(obj["options"]), ParseRelationRef(obj["relation"]),
                    ParseConfigPassthrough(obj["config"]));
            }
            case "add_relation":
            case "ajouter_relation":
            {
                var targetRef = Str(obj["target"]) ?? Str(obj["entityKey"]) ?? Str(obj["table"]) ?? Str(obj["ref"]);
                if (targetRef is null)
                {
                    warnings.Add("Ajout de relation ignoré : table cible non précisée.");
                    return null;
                }
                var kindRaw = (Str(obj["kind"]) ?? EntityRelationKinds.ManyToOne).Trim();
                string? kind = ManyToOneAliases.Contains(kindRaw) ? EntityRelationKinds.ManyToOne
                    : ManyToManyAliases.Contains(kindRaw) ? EntityRelationKinds.ManyToMany
                    : null;
                if (kind is null)
                {
                    warnings.Add(
                        $"Ajout de relation ignoré : type « {kindRaw} » non pris en charge (many_to_one ou many_to_many).");
                    return null;
                }
                // Clés normalisées (slug) comme les autres références de table (vue, cible du plan,
                // jonction) : une valeur brute avec majuscules/espaces resterait introuvable ou
                // deviendrait une erreur d'exécution que l'aperçu n'annonçait pas.
                var junctionRaw = Str(obj["junctionName"]) ?? Str(obj["junctionKey"]);
                return new AddRelationOp(kind, SlugOrRaw(targetRef), Str(obj["label"]),
                    junctionRaw is null ? null : SlugOrRaw(junctionRaw));
            }
            case "assign_system":
            case "assigner_systeme":
            case "rattacher_systeme":
            {
                // Clé ABSENTE = oubli du modèle (avertissement, op ignorée) ; clé présente mais
                // nulle/vide/alias (« none », « aucun »…) = détachement explicite. Distinction
                // nécessaire à l'aller-retour canonique (un détachement se réécrit « none »).
                if (!obj.ContainsKey("system") && !obj.ContainsKey("systemKey"))
                {
                    warnings.Add("Rattachement au système ignoré : système non précisé (« none » pour détacher).");
                    return null;
                }
                var raw = Str(obj["system"]) ?? Str(obj["systemKey"]);
                var detach = raw is null || DetachSystemAliases.Contains(raw.Trim());
                if (detach) return new AssignSystemOp(null);
                return new AssignSystemOp(SlugOrRaw(raw!));
            }
            case "set_view":
            case "definir_vue":
            case "creer_vue":
            {
                if (!StudioAiRecordViewSpec.TryParseNode(obj, out var viewSpec, out var viewError) || viewSpec is null)
                {
                    warnings.Add($"Vue enregistrée ignorée : {viewError ?? "spécification invalide"}.");
                    return null;
                }
                // Dans un amendement, la vue porte TOUJOURS sur la table cible du plan : toute clé
                // « entity » écrite par le modèle est écartée (la forme canonique n'en porte pas).
                return new SetViewOp(viewSpec with { EntityKey = null });
            }
            case "set_automation":
            case "definir_automatisation":
                return new SetAutomationOp((JsonObject)obj.DeepClone());
            default:
                warnings.Add($"Opération « {(string.IsNullOrEmpty(op) ? "?" : op)} » non prise en charge : ignorée.");
                return null;
        }
    }

    /// <summary>
    /// Normalise un champ à ajouter en réutilisant le parseur d'application (types, options, config) —
    /// même patron que <c>StudioAiSystemSpec.ParseEntityReport</c> : on enveloppe dans un spec minimal.
    /// </summary>
    private static ParsedAppField? ParseSingleField(JsonObject obj)
    {
        var wrapper = new JsonObject
        {
            ["entity"] = new JsonObject { ["displayName"] = "T" },
            ["fields"] = new JsonArray(obj.DeepClone())
        };
        return StudioAiAppSpec.TryParse(wrapper.ToJsonString(), out var appSpec, out _)
            ? appSpec?.Fields.FirstOrDefault()
            : null;
    }

    private static string? FieldRef(JsonObject obj) =>
        Str(obj["key"]) ?? Str(obj["field"]) ?? Str(obj["fieldKey"]) ?? Str(obj["label"]) ?? Str(obj["name"]);

    private static IReadOnlyList<SelectOptionDto>? ParseOptions(JsonNode? node)
    {
        if (node is not JsonArray arr) return null;
        var result = new List<SelectOptionDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in arr)
        {
            string? value;
            string? label;
            if (item is JsonObject o)
            {
                value = Str(o["value"]) ?? Str(o["label"]);
                label = Str(o["label"]) ?? value;
            }
            else
            {
                value = Str(item);
                label = value;
            }
            if (string.IsNullOrWhiteSpace(value)) continue;
            var slug = SlugOrRaw(value);
            if (!seen.Add(slug)) continue;
            result.Add(new SelectOptionDto(slug, (label ?? value)!.Trim()));
        }
        return result.Count > 0 ? result : null;
    }

    private static RelationRefDto? ParseRelationRef(JsonNode? node)
    {
        if (node is not JsonObject obj) return null;
        var kind = Str(obj["kind"]);
        var refKey = Str(obj["ref"]) ?? Str(obj["target"]) ?? Str(obj["entityKey"]);
        if (kind is null || refKey is null) return null;
        return new RelationRefDto(kind.Trim().ToLowerInvariant(), SlugOrRaw(refKey));
    }

    private static Dictionary<string, JsonNode?>? ParseConfigPassthrough(JsonNode? node)
    {
        if (node is not JsonObject obj) return null;
        var dict = new Dictionary<string, JsonNode?>();
        foreach (var kvp in obj)
            dict[kvp.Key] = kvp.Value?.DeepClone();
        return dict.Count > 0 ? dict : null;
    }

    /// <summary>
    /// Clé normalisée (slug) d'une référence écrite par le modèle ; si l'entrée ne produit rien
    /// d'exploitable (que des caractères filtrés), le brut élagué est conservé.
    /// </summary>
    private static string SlugOrRaw(string raw)
    {
        var slug = StudioAiAppSpec.SlugKey(raw);
        return string.IsNullOrEmpty(slug) ? raw.Trim() : slug;
    }

    private static string? Str(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<string>(out var s)) return string.IsNullOrWhiteSpace(s) ? null : s;
        return v.ToString();
    }

    private static bool? Bool(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<bool>(out var b)) return b;
        var s = Str(n)?.Trim().ToLowerInvariant();
        return s switch { "true" or "oui" or "yes" or "1" => true, "false" or "non" or "no" or "0" => false, _ => (bool?)null };
    }
}
