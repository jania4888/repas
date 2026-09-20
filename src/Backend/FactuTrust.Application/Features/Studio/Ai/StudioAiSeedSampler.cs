using System.Text.Json.Nodes;

namespace FactuTrust.Application.Features.Studio.Ai;

/// <summary>
/// Échantillonneur PUR des données de départ d'un plan Studio IA (PR 3.2b) : expose à l'aperçu les
/// <see cref="MaxSampleRows"/> premiers enregistrements d'une série de seed, DANS L'ORDRE DE LA
/// SPEC (déterminisme — jamais de <c>Random</c>), chaque valeur projetée en chaîne d'affichage
/// bornée. Aucune dépendance MediatR / dépôt / <c>ICurrentUser</c> : l'appelant fournit la série
/// parsée et les champs de l'entité.
/// </summary>
public static class StudioAiSeedSampler
{
    /// <summary>Nombre maximal de lignes d'exemple exposées par entité dans l'aperçu.</summary>
    public const int MaxSampleRows = 3;

    /// <summary>
    /// Nombre de caractères CONSERVÉS par valeur affichée ; au-delà, la valeur est tronquée et
    /// suivie de « … ».
    /// </summary>
    public const int MaxValueLength = 80;

    /// <summary>Nombre total d'enregistrements de la série (compteur de l'aperçu, jamais borné ici).</summary>
    public static int Count(ParsedSeedBatch batch) => batch.Records.Count;

    /// <summary>
    /// Projette les <see cref="MaxSampleRows"/> premiers enregistrements en dictionnaires
    /// « colonne ⇒ valeur affichable ». Colonnes ordonnées comme les champs de la spec, puis les
    /// clés supplémentaires de l'enregistrement dans l'ordre du document. Projection des valeurs :
    /// <c>null</c> ⇒ <c>null</c> ; objets et tableaux ⇒ <c>ToJsonString()</c> ; scalaires ⇒ valeur
    /// brute (chaîne telle quelle, littéral JSON canonique pour nombres et booléens) ; au-delà de
    /// <see cref="MaxValueLength"/> caractères ⇒ tronquée puis suivie de « … ».
    /// </summary>
    public static IReadOnlyList<IReadOnlyDictionary<string, string?>> Sample(
        ParsedSeedBatch batch, IReadOnlyList<ParsedSystemField> fields)
    {
        var rows = new List<IReadOnlyDictionary<string, string?>>(Math.Min(batch.Records.Count, MaxSampleRows));
        foreach (var record in batch.Records.Take(MaxSampleRows))
        {
            var row = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var field in fields)
                if (record.TryGetValue(field.Key, out var node))
                    row[field.Key] = Project(node);
            foreach (var (key, node) in record)
                if (!row.ContainsKey(key))
                    row[key] = Project(node);
            rows.Add(row);
        }
        return rows;
    }

    private static string? Project(JsonNode? node)
    {
        var text = node switch
        {
            null => null,
            // Chaîne : valeur brute, sans guillemets JSON.
            JsonValue value when value.TryGetValue<string>(out var raw) => raw,
            // Nombre, booléen… : littéral JSON canonique (culture-invariant : 42, true).
            JsonValue value => value.ToJsonString(),
            // Objets et tableaux : forme JSON compacte.
            _ => node.ToJsonString()
        };
        return text is { Length: > MaxValueLength } ? text[..MaxValueLength] + "…" : text;
    }
}
