using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;

namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Audit des mutations d'enregistrements Studio (4.7 « v1.1 » hi-b1, D‑47‑62/63) : actions
/// <c>Studio.Record.*</c> sur <c>entityType = "CustomRecord"</c>, écrites via
/// <see cref="StudioAudit.SafeLogAsync"/> (best-effort : l'audit ne fait jamais échouer la mutation).
/// Portée honnête : seules les mutations via l'API records (POST/PUT/PATCH/DELETE) sont auditées —
/// le moteur de workflows et l'outil IA <c>update_field</c> écrivent en dehors de ces handlers
/// (déjà traçables par les StepRuns / le plan IA). Pas de rétroactivité.
/// </summary>
public static class StudioRecordAudit
{
    public const string ActionCreated = "Studio.Record.Created";
    public const string ActionUpdated = "Studio.Record.Updated";
    public const string ActionDeleted = "Studio.Record.Deleted";
    public const string EntityType = "CustomRecord";

    /// <summary>Création : document canonique complet en <c>NewValues</c> (≤ 100 clés — quota champs).</summary>
    public static Task LogCreatedAsync(IAuditService? audit, Guid recordId, string canonicalJson, CancellationToken cancellationToken)
    {
        object? values;
        try
        {
            values = Flatten(canonicalJson).ToDictionary(kv => kv.Key, kv => Materialize(kv.Value));
        }
        catch (JsonException)
        {
            values = new Dictionary<string, object?> { ["_raw"] = canonicalJson };
        }
        return LogAsync(audit, ActionCreated, recordId, null, values, cancellationToken);
    }

    /// <summary>
    /// PUT/PATCH : uniquement les clés modifiées (ajout/retrait/changement) ; <b>aucune ligne</b>
    /// quand le document canonique est inchangé (D‑47‑63 : pas de bruit d'audit).
    /// </summary>
    public static Task LogUpdatedAsync(IAuditService? audit, Guid recordId, string previousJson, string canonicalJson, CancellationToken cancellationToken)
    {
        var diff = Diff(previousJson, canonicalJson);
        return diff is null
            ? Task.CompletedTask
            : LogAsync(audit, ActionUpdated, recordId, diff.Value.OldValues, diff.Value.NewValues, cancellationToken);
    }

    /// <summary>Suppression douce : ligne sans valeurs.</summary>
    public static Task LogDeletedAsync(IAuditService? audit, Guid recordId, CancellationToken cancellationToken)
        => LogAsync(audit, ActionDeleted, recordId, null, null, cancellationToken);

    /// <summary>
    /// Diff des clés de premier niveau de deux documents JSON plats canoniques (comparaison sur le
    /// texte brut de chaque valeur). <see langword="null"/> si identique. JSON inattendu (illisible
    /// ou non-objet) ⇒ repli <c>_raw</c> (l'écriture a eu lieu : mieux vaut une ligne brute que rien).
    /// </summary>
    public static (Dictionary<string, object?> OldValues, Dictionary<string, object?> NewValues)? Diff(string previousJson, string currentJson)
    {
        Dictionary<string, JsonElement>? before;
        Dictionary<string, JsonElement>? after;
        try
        {
            before = Flatten(previousJson);
            after = Flatten(currentJson);
        }
        catch (JsonException)
        {
            before = null;
            after = null;
        }

        if (before is null || after is null)
        {
            return (new Dictionary<string, object?> { ["_raw"] = previousJson },
                    new Dictionary<string, object?> { ["_raw"] = currentJson });
        }

        var oldValues = new Dictionary<string, object?>();
        var newValues = new Dictionary<string, object?>();
        foreach (var key in before.Keys.Union(after.Keys))
        {
            var hasOld = before.TryGetValue(key, out var oldElement);
            var hasNew = after.TryGetValue(key, out var newElement);
            if (hasOld && hasNew && string.Equals(oldElement.GetRawText(), newElement.GetRawText(), StringComparison.Ordinal))
                continue;
            oldValues[key] = hasOld ? Materialize(oldElement) : null;
            newValues[key] = hasNew ? Materialize(newElement) : null;
        }
        return oldValues.Count == 0 ? null : (oldValues, newValues);
    }

    private static async Task LogAsync(IAuditService? audit, string action, Guid recordId, object? oldValues, object? newValues, CancellationToken cancellationToken)
    {
        if (audit is null)
            return;
        await StudioAudit.SafeLogAsync(audit, action, EntityType, recordId, oldValues, newValues, cancellationToken);
    }

    /// <summary>Table des propriétés de premier niveau (éléments clonés, indépendants du document).</summary>
    private static Dictionary<string, JsonElement> Flatten(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var map = new Dictionary<string, JsonElement>();
        if (doc.RootElement.ValueKind == JsonValueKind.Object)
            foreach (var prop in doc.RootElement.EnumerateObject())
                map[prop.Name] = prop.Value.Clone();
        return map;
    }

    /// <summary>Valeur CLR naturelle ; objets/tableaux (inattendus en canonique plat) en texte brut.</summary>
    private static object? Materialize(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String: return element.GetString();
            case JsonValueKind.Number:
                // Pas de ternaire long/double : les branches distinctes élèveraient tout en double.
                if (element.TryGetInt64(out var integral)) return integral;
                return element.GetDouble();
            case JsonValueKind.True: return true;
            case JsonValueKind.False: return false;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined: return null;
            default: return element.GetRawText();
        }
    }
}
