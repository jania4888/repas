using System.Data;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 2.3 : <see cref="RecordQuerySql.Build"/> est un constructeur SQL PUR (aucune base).
/// Verrouille : expressions par type (JSON_VALUE / TRY_CONVERT), opérateurs, <c>in</c> MultiSelect via
/// OPENJSON, seek <c>jx_</c> sur égalité indexée seulement, clé invalide ⇒ exception, AUCUNE valeur
/// utilisateur dans le SQL (paramètres <c>@pN</c> typés), tri <c>createdAt/updatedAt</c>, tie-breaker Id.
/// </summary>
public sealed class RecordQuerySqlTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid Eid = Guid.NewGuid();

    private static readonly IReadOnlyDictionary<string, CustomFieldType> Types =
        new Dictionary<string, CustomFieldType>(StringComparer.Ordinal)
        {
            ["nom"] = CustomFieldType.Text,
            ["statut"] = CustomFieldType.Select,
            ["tags"] = CustomFieldType.MultiSelect,
            ["montant"] = CustomFieldType.Money,
            ["debut"] = CustomFieldType.Date,
            ["actif"] = CustomFieldType.Boolean,
            ["client"] = CustomFieldType.RelationCustom
        };

    private static RecordQuerySpec Spec(
        IReadOnlyList<RecordViewFilter>? filters = null,
        IReadOnlyList<RecordViewSort>? sort = null,
        string? search = null,
        IReadOnlyList<string>? searchable = null,
        IReadOnlySet<string>? indexed = null) =>
        new(Tid, Eid,
            filters ?? Array.Empty<RecordViewFilter>(),
            sort ?? Array.Empty<RecordViewSort>(),
            search,
            searchable ?? new List<string> { "nom" },
            Skip: 0, Take: 25,
            indexed ?? new HashSet<string>(StringComparer.Ordinal));

    [Fact]
    public void Always_filters_tenant_entity_and_soft_delete()
    {
        var result = RecordQuerySql.Build(Spec(), Types);

        Assert.Contains("r.[TenantId] = @t", result.WhereSql);
        Assert.Contains("r.[EntityDefinitionId] = @e", result.WhereSql);
        Assert.Contains("r.[IsDeleted] = 0", result.WhereSql);
        Assert.Equal(Tid, result.Parameters.Single(p => p.Name == "@t").Value);
        Assert.Equal(Eid, result.Parameters.Single(p => p.Name == "@e").Value);
        // Tri par défaut déterministe pour OFFSET/FETCH.
        Assert.Contains("r.[CreatedAt] DESC", result.OrderBySql);
        Assert.Contains("r.[Id] ASC", result.OrderBySql);
    }

    /// <summary>4.7★2 (S7) : un filtre de déclencheur planifié dont le champ a été supprimé depuis (clé absente du
    /// dictionnaire des types) ne fait pas échouer le tick — repli en comparaison texte sur le chemin JSON, paramétrée.</summary>
    [Fact]
    public void Eq_on_a_field_that_no_longer_exists_falls_back_to_a_parameterized_text_comparison()
    {
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("ancien_statut", "eq", JsonValue.Create("archive")) }), Types);

        Assert.Contains("JSON_VALUE(r.[DataJson], '$.ancien_statut') = @p0", result.WhereSql);
        Assert.DoesNotContain("TRY_CONVERT", result.WhereSql);
        var p = result.Parameters.Single(x => x.Name == "@p0");
        Assert.Equal("archive", p.Value);
        Assert.Equal(SqlDbType.NVarChar, p.Type);

        // Les opérateurs numériques / de date sur un champ disparu restent eux aussi une comparaison texte sans exception.
        var gt = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("ancien_montant", "gt", JsonValue.Create(10)) }), Types);
        Assert.Contains("'$.ancien_montant'", gt.WhereSql);
    }

    [Fact]
    public void Eq_on_text_uses_json_value_with_a_parameter()
    {
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "eq", JsonValue.Create("Dupont")) }), Types);

        Assert.Contains("JSON_VALUE(r.[DataJson], '$.nom') = @p0", result.WhereSql);
        var p = result.Parameters.Single(x => x.Name == "@p0");
        Assert.Equal("Dupont", p.Value);
        Assert.Equal(SqlDbType.NVarChar, p.Type);
        Assert.DoesNotContain("'Dupont'", result.WhereSql); // jamais de littéral utilisateur
    }

    [Fact]
    public void Eq_on_indexed_key_seeks_jx_column_and_rechecks_exactly()
    {
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("statut", "eq", JsonValue.Create("encours")) },
            indexed: new HashSet<string>(StringComparer.Ordinal) { "statut" }), Types);

        Assert.Contains("[jx_statut] = @p0", result.WhereSql);
        Assert.Contains("JSON_VALUE(r.[DataJson], '$.statut') = @p0", result.WhereSql);
    }

    [Fact]
    public void Neq_and_non_indexed_eq_never_touch_the_jx_column()
    {
        var indexed = new HashSet<string>(StringComparer.Ordinal) { "statut" };
        var neq = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("statut", "neq", JsonValue.Create("x")) }, indexed: indexed), Types);
        Assert.DoesNotContain("[jx_statut]", neq.WhereSql);

        var eqNotIndexed = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("statut", "eq", JsonValue.Create("x")) }), Types);
        Assert.DoesNotContain("[jx_statut]", eqNotIndexed.WhereSql);
    }

    [Fact]
    public void Contains_is_a_parameterised_like_with_escaping()
    {
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "contains", JsonValue.Create("100%_")) }), Types);

        Assert.Contains("JSON_VALUE(r.[DataJson], '$.nom') LIKE @p0 ESCAPE '\\'", result.WhereSql);
        Assert.Equal("%100\\%\\_%", result.Parameters.Single(p => p.Name == "@p0").Value);
    }

    [Fact]
    public void Comparison_operators_convert_numbers_and_dates()
    {
        var money = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("montant", "gt", JsonValue.Create(100.5m)) }), Types);
        Assert.Contains("TRY_CONVERT(decimal(18,6), JSON_VALUE(r.[DataJson], '$.montant')) > @p0", money.WhereSql);
        Assert.Equal(SqlDbType.Decimal, money.Parameters.Single(p => p.Name == "@p0").Type);

        var date = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("debut", "gte", JsonValue.Create("2026-01-15")) }), Types);
        Assert.Contains("TRY_CONVERT(datetime2, JSON_VALUE(r.[DataJson], '$.debut'), 127) >= @p0", date.WhereSql);
        Assert.Equal(SqlDbType.DateTime2, date.Parameters.Single(p => p.Name == "@p0").Type);
    }

    [Fact]
    public void Between_uses_two_bounds()
    {
        var bounds = new JsonArray(JsonValue.Create("2026-01-01"), JsonValue.Create("2026-03-31"));
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("debut", "between", bounds) }), Types);

        Assert.Contains("TRY_CONVERT(datetime2, JSON_VALUE(r.[DataJson], '$.debut'), 127) BETWEEN @p0 AND @p1", result.WhereSql);
        Assert.Equal(new DateTime(2026, 1, 1), result.Parameters.Single(p => p.Name == "@p0").Value);
        Assert.Equal(new DateTime(2026, 3, 31), result.Parameters.Single(p => p.Name == "@p1").Value);
    }

    [Fact]
    public void Contains_on_multiselect_searches_array_elements_via_openjson()
    {
        // JSON_VALUE renvoie NULL sur un tableau JSON : un LIKE direct serait un filtre muet.
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("tags", "contains", JsonValue.Create("urg")) }), Types);

        Assert.Contains("EXISTS (SELECT 1 FROM OPENJSON(r.[DataJson], '$.tags') WHERE [value] LIKE @p0 ESCAPE '\\')", result.WhereSql);
        Assert.Equal("%urg%", result.Parameters.Single(p => p.Name == "@p0").Value);

        // Texte : LIKE simple inchangé.
        var text = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "contains", JsonValue.Create("urg")) }), Types);
        Assert.Contains("JSON_VALUE(r.[DataJson], '$.nom') LIKE @p0 ESCAPE '\\'", text.WhereSql);
        Assert.DoesNotContain("OPENJSON", text.WhereSql);
    }

    [Fact]
    public void In_on_multiselect_uses_openjson_exists()
    {
        var values = new JsonArray(JsonValue.Create("a"), JsonValue.Create("b"));
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("tags", "in", values) }), Types);

        Assert.Contains("EXISTS (SELECT 1 FROM OPENJSON(r.[DataJson], '$.tags') WHERE [value] = @p0)", result.WhereSql);
        Assert.Contains("EXISTS (SELECT 1 FROM OPENJSON(r.[DataJson], '$.tags') WHERE [value] = @p1)", result.WhereSql);
        Assert.Equal("a", result.Parameters.Single(p => p.Name == "@p0").Value);
        Assert.Equal("b", result.Parameters.Single(p => p.Name == "@p1").Value);
    }

    [Fact]
    public void In_on_select_is_a_plain_in_list()
    {
        var values = new JsonArray(JsonValue.Create("x"), JsonValue.Create("y"));
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("statut", "in", values) }), Types);

        Assert.Contains("JSON_VALUE(r.[DataJson], '$.statut') IN (@p0, @p1)", result.WhereSql);
    }

    [Fact]
    public void Is_empty_and_is_not_empty_have_no_parameter()
    {
        var empty = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "is_empty", null) }), Types);
        Assert.Contains("(JSON_VALUE(r.[DataJson], '$.nom') IS NULL OR JSON_VALUE(r.[DataJson], '$.nom') = '')", empty.WhereSql);
        Assert.Equal(2, empty.Parameters.Count); // @t/@e seulement

        var notEmpty = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "is_not_empty", null) }), Types);
        Assert.Contains("(JSON_VALUE(r.[DataJson], '$.nom') IS NOT NULL AND JSON_VALUE(r.[DataJson], '$.nom') <> '')", notEmpty.WhereSql);
    }

    [Fact]
    public void Boolean_eq_matches_true_literals()
    {
        var isTrue = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("actif", "eq", JsonValue.Create(true)) }), Types);
        Assert.Contains("JSON_VALUE(r.[DataJson], '$.actif') IN ('true','1')", isTrue.WhereSql);

        var isFalse = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("actif", "eq", JsonValue.Create(false)) }), Types);
        Assert.Contains("JSON_VALUE(r.[DataJson], '$.actif') IN ('false','0')", isFalse.WhereSql);
    }

    [Fact]
    public void Invalid_key_shape_throws_and_never_reaches_sql()
    {
        var ex = Assert.Throws<ArgumentException>(() => RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom'); DROP TABLE x;--", "eq", JsonValue.Create("x")) }), Types));
        Assert.Contains("Invalid Studio key shape", ex.Message);
    }

    [Fact]
    public void No_user_value_is_ever_embedded_in_the_sql_text()
    {
        var secret = "O'Connor'; DROP TABLE CustomRecords;--";
        var result = RecordQuerySql.Build(Spec(
            filters: new[] { new RecordViewFilter("nom", "contains", JsonValue.Create(secret)) },
            search: secret), Types);

        Assert.DoesNotContain("O'Connor", result.WhereSql);
        Assert.DoesNotContain("O'Connor", result.OrderBySql);
        // Toutes les valeurs sont des paramètres.
        Assert.Contains(result.Parameters, p => Equals(p.Value, "%O'Connor'; DROP TABLE CustomRecords;--%"));
    }

    [Fact]
    public void Sort_supports_persisted_and_json_keys_and_keeps_the_id_tiebreaker()
    {
        var result = RecordQuerySql.Build(Spec(sort: new[]
        {
            new RecordViewSort("montant", Descending: true),
            new RecordViewSort("createdAt"),
            new RecordViewSort("updatedAt", Descending: true)
        }), Types);

        Assert.Contains("TRY_CONVERT(decimal(18,6), JSON_VALUE(r.[DataJson], '$.montant')) DESC", result.OrderBySql);
        Assert.Contains("r.[CreatedAt] ASC", result.OrderBySql);
        Assert.Contains("r.[UpdatedAt] DESC", result.OrderBySql);
        Assert.EndsWith("r.[Id] ASC", result.OrderBySql);
    }

    [Fact]
    public void Search_targets_searchable_keys_or_falls_back_to_datajson()
    {
        var onKeys = RecordQuerySql.Build(Spec(search: "dupont", searchable: new List<string> { "nom" }), Types);
        Assert.Contains("JSON_VALUE(r.[DataJson], '$.nom') LIKE @p0 ESCAPE '\\'", onKeys.WhereSql);

        var fallback = RecordQuerySql.Build(Spec(search: "dupont", searchable: new List<string>()), Types);
        Assert.Contains("r.[DataJson] LIKE @p0 ESCAPE '\\'", fallback.WhereSql);
    }

    [Fact]
    public void Take_must_be_within_bounds()
    {
        var zero = new RecordQuerySpec(Tid, Eid, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
            null, new List<string>(), 0, 0, new HashSet<string>());
        Assert.Throws<ArgumentException>(() => RecordQuerySql.Build(zero, Types));

        var tooBig = new RecordQuerySpec(Tid, Eid, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
            null, new List<string>(), 0, 10_001, new HashSet<string>());
        Assert.Throws<ArgumentException>(() => RecordQuerySql.Build(tooBig, Types));
    }
}
