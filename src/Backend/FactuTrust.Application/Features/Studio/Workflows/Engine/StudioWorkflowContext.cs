using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>
/// Contexte d'exécution d'une instance de workflow Studio (persisté dans
/// <c>StudioWorkflowInstances.ContextJson</c>). Porte les variables <c>_record</c>,
/// <c>_startedBy</c>, <c>_previous</c>, <c>_approval.&lt;clé&gt;</c>, <c>_results.&lt;clé&gt;</c>
/// et <c>vars</c>. Sérialisation bornée à 64 Ko : 1) abandon de <c>previous</c>,
/// 2) troncature de chaque résultat à 2 Ko, 3) échec avec un message figé.
/// </summary>
public sealed class StudioWorkflowContext
{
    public const int Version = 1;
    public const int MaxBytes = 64 * 1024;
    public const int MaxResultBytes = 2 * 1024;

    private StudioWorkflowContext(JsonObject root)
    {
        Root = root;
        Previous = root["previous"] as JsonObject;
        Approval = GetOrAddObject(root, "approval");
        Results = GetOrAddObject(root, "results");
        Vars = GetOrAddObject(root, "vars");
    }

    /// <summary>Racine du contexte ; <see cref="Approval"/>, <see cref="Results"/> et <see cref="Vars"/> en sont des vues.</summary>
    public JsonObject Root { get; }

    /// <summary>Cliché de l'enregistrement avant déclenchement ; null après abandon par <see cref="Serialize"/>.</summary>
    public JsonObject? Previous { get; private set; }

    public JsonObject Approval { get; }
    public JsonObject Results { get; }
    public JsonObject Vars { get; }

    public static StudioWorkflowContext Create(
        Guid recordId, string entityKey, Guid? startedById, string? startedByEmail, JsonObject? previous)
        => new(new JsonObject
        {
            ["version"] = Version,
            ["record"] = new JsonObject
            {
                ["id"] = recordId.ToString(),
                ["entityKey"] = entityKey
            },
            ["startedBy"] = new JsonObject
            {
                ["id"] = startedById?.ToString(),
                ["email"] = startedByEmail
            },
            ["previous"] = previous?.DeepClone() as JsonObject,
            ["approval"] = new JsonObject(),
            ["results"] = new JsonObject(),
            ["vars"] = new JsonObject()
        });

    /// <summary>Recharge un contexte persisté ; JSON illisible ou non-objet ⇒ contexte v1 vide.</summary>
    public static StudioWorkflowContext Parse(string json)
    {
        try
        {
            if (JsonNode.Parse(json) is JsonObject root)
                return new StudioWorkflowContext(root);
        }
        catch (JsonException)
        {
            // fall through : contexte vide
        }
        return Empty();
    }

    /// <summary>Mémorise le résultat d'une étape ; tronqué à <see cref="MaxResultBytes"/> en chaîne.</summary>
    public void SetResult(string key, JsonNode? value) => Results[key] = TruncateResult(value);

    public void SetApproval(string key, string status, string? comment, Guid? decidedBy, DateTime? decidedAt)
        => Approval[key] = new JsonObject
        {
            ["status"] = status,
            ["comment"] = comment,
            ["decidedBy"] = decidedBy?.ToString(),
            ["decidedAt"] = decidedAt?.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture)
        };

    /// <summary>
    /// Résout un chemin de contexte : <c>_previous.x</c>, <c>_approval.k.status|comment|decidedBy|decidedAt</c>,
    /// <c>_results.k.p</c>, <c>_startedBy.id|email</c>, <c>_record.id|entityKey</c>. Inconnu ⇒ null.
    /// </summary>
    public JsonNode? Resolve(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var segments = path.Split('.');
        return segments[0] switch
        {
            "_previous" when segments.Length == 2 => Previous?[segments[1]],
            "_approval" when segments.Length == 3 => ResolveApproval(segments[1], segments[2]),
            "_results" when segments.Length == 3 => (Results[segments[1]] as JsonObject)?[segments[2]],
            "_startedBy" when segments.Length == 2 => (Root["startedBy"] as JsonObject)?[segments[1]],
            "_record" when segments.Length == 2 => (Root["record"] as JsonObject)?[segments[1]],
            _ => null
        };
    }

    /// <summary>
    /// Sérialise le contexte en tenant dans <see cref="MaxBytes"/> : 1) abandon de <c>previous</c>,
    /// 2) troncature de chaque résultat à <see cref="MaxResultBytes"/>, 3) échec figé.
    /// </summary>
    public Result<string> Serialize()
    {
        var json = Root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) <= MaxBytes)
            return Result.Success(json);

        // Étape 1 : le cliché « previous » est la partie la plus volumineuse et la moins utile.
        Previous = null;
        Root["previous"] = null;
        json = Root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) <= MaxBytes)
            return Result.Success(json);

        // Étape 2 : chaque résultat est re-tronqué à 2 Ko en chaîne.
        foreach (var pair in Results.ToList())
            Results[pair.Key] = TruncateResult(pair.Value);
        json = Root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) <= MaxBytes)
            return Result.Success(json);

        return Result.Failure<string>(Error.Validation("context", "Contexte d'exécution trop volumineux (64 Ko)."));
    }

    private JsonNode? ResolveApproval(string key, string property) =>
        property is "status" or "comment" or "decidedBy" or "decidedAt"
            ? (Approval[key] as JsonObject)?[property]
            : null;

    private static JsonNode? TruncateResult(JsonNode? value)
    {
        switch (value)
        {
            case null:
                return null;
            case JsonValue v when v.TryGetValue<string>(out var s):
                return s is not null && s.Length > MaxResultBytes
                    ? JsonValue.Create(s[..MaxResultBytes])
                    : v.DeepClone();
            default:
                var serialized = value.ToJsonString();
                return serialized.Length > MaxResultBytes
                    ? JsonValue.Create(serialized[..MaxResultBytes])
                    : value.DeepClone();
        }
    }

    private static JsonObject GetOrAddObject(JsonObject root, string key)
    {
        if (root[key] is JsonObject existing) return existing;
        var created = new JsonObject();
        root[key] = created;
        return created;
    }

    private static StudioWorkflowContext Empty() => new(new JsonObject
    {
        ["version"] = Version,
        ["record"] = new JsonObject(),
        ["startedBy"] = new JsonObject(),
        ["previous"] = null,
        ["approval"] = new JsonObject(),
        ["results"] = new JsonObject(),
        ["vars"] = new JsonObject()
    });
}
