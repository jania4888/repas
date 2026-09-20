using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Échantillonnage des données de départ pour l'aperçu structuré (PR 3.2b) : 3 premières lignes
/// dans l'ordre de la spec, valeurs projetées en chaînes bornées à 80 caractères, déterminisme
/// strict (jamais de hasard).
/// </summary>
public sealed class StudioAiSeedSamplerTests
{
    private static ParsedSystemField Field(string key, string label) =>
        new(key, label, CustomFieldType.Text, false, false, null, null, null);

    private static Dictionary<string, JsonNode?> Record(params (string Key, string? Value)[] values) =>
        values.ToDictionary(v => v.Key, v => v.Value is null ? null : (JsonNode?)JsonValue.Create(v.Value));

    [Fact]
    public void Sample_takes_first_three_rows_in_spec_order()
    {
        var batch = new ParsedSeedBatch("employes", new[]
        {
            Record(("nom", "Sami"), ("ville", "Tunis")),
            Record(("nom", "Ines"), ("ville", "Sfax")),
            Record(("nom", "Yassine"), ("ville", "Sousse")),
            Record(("nom", "Nour"), ("ville", "Ariana"))
        });
        var fields = new[] { Field("nom", "Nom"), Field("ville", "Ville") };

        var rows = StudioAiSeedSampler.Sample(batch, fields);

        Assert.Equal(4, StudioAiSeedSampler.Count(batch));          // compteur non borné
        Assert.Equal(StudioAiSeedSampler.MaxSampleRows, rows.Count); // échantillon borné à 3
        Assert.Equal(new[] { "Sami", "Ines", "Yassine" }, rows.Select(r => r["nom"]).ToArray());
        Assert.Equal(new[] { "Tunis", "Sfax", "Sousse" }, rows.Select(r => r["ville"]).ToArray());
        // Colonnes ordonnées comme les champs de la spec.
        Assert.Equal(new[] { "nom", "ville" }, rows[0].Keys.ToArray());
    }

    [Fact]
    public void Sample_truncates_long_values_to_80_chars()
    {
        var longText = new string('x', StudioAiSeedSampler.MaxValueLength + 20);
        var batch = new ParsedSeedBatch("notes", new[] { Record(("contenu", longText)) });

        var rows = StudioAiSeedSampler.Sample(batch, new[] { Field("contenu", "Contenu") });

        var projected = Assert.Single(rows)["contenu"];
        Assert.NotNull(projected);
        Assert.Equal(longText[..StudioAiSeedSampler.MaxValueLength] + "…", projected);
        Assert.Equal(StudioAiSeedSampler.MaxValueLength + 1, projected!.Length);

        // Une valeur d'exactement 80 caractères n'est PAS tronquée.
        var exact = new string('y', StudioAiSeedSampler.MaxValueLength);
        var exactRows = StudioAiSeedSampler.Sample(
            new ParsedSeedBatch("notes", new[] { Record(("contenu", exact)) }),
            new[] { Field("contenu", "Contenu") });
        Assert.Equal(exact, Assert.Single(exactRows)["contenu"]);
    }

    [Fact]
    public void Sample_serializes_nested_nodes_as_json()
    {
        var record = new Dictionary<string, JsonNode?>
        {
            ["nom"] = JsonValue.Create("Sami"),
            ["adresse"] = JsonNode.Parse("""{ "rue": "Av. Habib Bourguiba", "code": 1000 }"""),
            ["tags"] = JsonNode.Parse("""[ "vip", "fondateur" ]"""),
            ["surnom"] = null
        };
        var batch = new ParsedSeedBatch("employes", new[] { record });

        var rows = StudioAiSeedSampler.Sample(batch, new[] { Field("nom", "Nom") });

        var row = Assert.Single(rows);
        Assert.Equal("Sami", row["nom"]);                       // scalaire : valeur brute
        Assert.Equal("""{"rue":"Av. Habib Bourguiba","code":1000}""", row["adresse"]); // objet : JSON compact
        Assert.Equal("""["vip","fondateur"]""", row["tags"]);  // tableau : JSON compact
        Assert.Null(row["surnom"]);                             // null ⇒ null
        // Champ de la spec d'abord, clés supplémentaires ensuite, dans l'ordre du document.
        Assert.Equal(new[] { "nom", "adresse", "tags", "surnom" }, row.Keys.ToArray());
    }

    [Fact]
    public void Sample_is_deterministic_across_calls()
    {
        var batch = new ParsedSeedBatch("employes", new[]
        {
            Record(("nom", "Sami"), ("ville", "Tunis")),
            Record(("nom", "Ines"), ("ville", null))
        });
        var fields = new[] { Field("nom", "Nom"), Field("ville", "Ville") };

        var first = StudioAiSeedSampler.Sample(batch, fields);
        var second = StudioAiSeedSampler.Sample(batch, fields);

        Assert.Equal(
            first.Select(r => r.Select(kv => kv.Key + "=" + kv.Value).ToArray()).ToArray(),
            second.Select(r => r.Select(kv => kv.Key + "=" + kv.Value).ToArray()).ToArray());
    }
}
