using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FactuTrust.Application.Features.Studio.Workflows.Spec;

/// <summary>
/// 4.7★3 (D-47-80) : relecture tolérante d'une colonne JSON des workflows Studio (<c>StepsJson</c>,
/// <c>TriggerConfigJson</c>, <c>ResultJson</c>…), partagée par le mapping des DTO, le job planifié et
/// le service d'ordonnancement — auparavant trois copies du même bloc <c>try / JsonNode.Parse</c>.
/// Un seul contrat : chaîne nulle, vide ou blanche, JSON illisible ou d'une autre forme qu'un objet
/// ⇒ <c>false</c>. Aucune exception ne sort (la validation amont, b1, garantit la forme en écriture).
/// </summary>
public static class StudioWorkflowJson
{
    public static bool TryParseObject(string? json, [NotNullWhen(true)] out JsonObject? obj)
    {
        obj = null;
        if (string.IsNullOrWhiteSpace(json))
            return false;
        try
        {
            obj = JsonNode.Parse(json) as JsonObject;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return false;
        }
        return obj is not null;
    }
}
