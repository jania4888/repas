using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioFilterEvaluatorTests
{
    private static readonly IReadOnlyDictionary<string, FilterFieldMeta> Meta =
        new Dictionary<string, FilterFieldMeta>(StringComparer.Ordinal)
        {
            ["statut"] = new("statut", Numeric: false, Date: false),
            ["montant"] = new("montant", Numeric: true, Date: false),
            ["date"] = new("date", Numeric: false, Date: true)
        };

    private static IReadOnlyDictionary<string, object?> Row(params (string Key, object? Value)[] cells)
    {
        var row = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in cells) row[key] = value;
        return row;
    }

    private static bool Passes(IReadOnlyDictionary<string, object?> row, StudioFilter filter) =>
        StudioFilterEvaluator.Passes(row, filter, Meta);

    [Fact]
    public void Eq_and_neq_compare_as_strings_when_not_numeric()
    {
        var row = Row(("statut", "Brouillon"));
        Assert.True(Passes(row, new StudioFilter("statut", "eq", "brouillon")));
        Assert.False(Passes(row, new StudioFilter("statut", "eq", "Validée")));
        Assert.True(Passes(row, new StudioFilter("statut", "neq", "Validée")));
        Assert.False(Passes(row, new StudioFilter("statut", "neq", "brouillon")));
    }

    [Fact]
    public void Numeric_comparisons_use_decimal_semantics()
    {
        var row = Row(("montant", 100.5m));
        Assert.True(Passes(row, new StudioFilter("montant", "gt", 100m)));
        Assert.True(Passes(row, new StudioFilter("montant", "gte", 100.5m)));
        Assert.True(Passes(row, new StudioFilter("montant", "lt", 101m)));
        Assert.True(Passes(row, new StudioFilter("montant", "lte", 100.5m)));
        Assert.False(Passes(row, new StudioFilter("montant", "gt", 100.5m)));
        // string filter values are parsed as decimals on numeric fields
        Assert.True(Passes(row, new StudioFilter("montant", "eq", "100.50")));
    }

    [Fact]
    public void Contains_is_case_insensitive()
    {
        var row = Row(("statut", "En cours de validation"));
        Assert.True(Passes(row, new StudioFilter("statut", "contains", "COURS")));
        Assert.False(Passes(row, new StudioFilter("statut", "contains", "clôturée")));
    }

    [Fact]
    public void In_matches_any_listed_value()
    {
        var row = Row(("statut", "Validée"));
        var values = new JsonArray(JsonValue.Create("Brouillon"), JsonValue.Create("Validée"));
        Assert.True(Passes(row, new StudioFilter("statut", "in", values)));
        Assert.False(Passes(row,
            new StudioFilter("statut", "in", new JsonArray(JsonValue.Create("Brouillon")))));
    }

    [Fact]
    public void Between_is_inclusive_on_both_bounds()
    {
        Assert.True(Passes(Row(("montant", 10m)), new StudioFilter("montant", "between", 10m, 20m)));
        Assert.True(Passes(Row(("montant", 20m)), new StudioFilter("montant", "between", 10m, 20m)));
        Assert.True(Passes(Row(("montant", 15m)), new StudioFilter("montant", "between", 10m, 20m)));
        Assert.False(Passes(Row(("montant", 9m)), new StudioFilter("montant", "between", 10m, 20m)));
        Assert.False(Passes(Row(("montant", 21m)), new StudioFilter("montant", "between", 10m, 20m)));
    }

    [Fact]
    public void Is_empty_and_is_not_empty_handle_null_blank_and_empty_array()
    {
        Assert.True(Passes(Row(("statut", null)), new StudioFilter("statut", "is_empty", null)));
        Assert.True(Passes(Row(("statut", "")), new StudioFilter("statut", "is_empty", null)));
        Assert.True(Passes(Row(("statut", "   ")), new StudioFilter("statut", "is_empty", null)));
        Assert.True(Passes(Row(("statut", new JsonArray())), new StudioFilter("statut", "is_empty", null)));
        Assert.False(Passes(Row(("statut", "Brouillon")), new StudioFilter("statut", "is_empty", null)));
        Assert.True(Passes(Row(("statut", "Brouillon")), new StudioFilter("statut", "is_not_empty", null)));
        Assert.False(Passes(Row(("statut", null)), new StudioFilter("statut", "is_not_empty", null)));
    }

    [Fact]
    public void Unknown_field_passes_like_the_report_runner()
    {
        var row = Row(("statut", "Brouillon"));
        Assert.True(Passes(row, new StudioFilter("fantome", "eq", "autre")));
        Assert.True(Passes(row, new StudioFilter("fantome", "is_not_empty", null)));
    }

    [Fact]
    public void Unknown_operator_passes_like_the_report_runner()
    {
        var row = Row(("statut", "Brouillon"));
        Assert.True(Passes(row, new StudioFilter("statut", "like", "autre")));
    }

    [Fact]
    public void Passes_all_requires_every_filter_when_match_is_all()
    {
        var row = Row(("statut", "Brouillon"), ("montant", 150m));
        var allTrue = new List<StudioFilter>
        {
            new("statut", "eq", "brouillon"),
            new("montant", "gt", 100m)
        };
        Assert.True(StudioFilterEvaluator.PassesAll(row, allTrue, Meta, matchAll: true));

        var oneFalse = new List<StudioFilter>
        {
            new("statut", "eq", "brouillon"),
            new("montant", "gt", 999m)
        };
        Assert.False(StudioFilterEvaluator.PassesAll(row, oneFalse, Meta, matchAll: true));
    }

    [Fact]
    public void Passes_all_requires_one_filter_when_match_is_any()
    {
        var row = Row(("statut", "Brouillon"), ("montant", 150m));
        var oneTrue = new List<StudioFilter>
        {
            new("statut", "eq", "brouillon"),
            new("montant", "gt", 999m)
        };
        Assert.True(StudioFilterEvaluator.PassesAll(row, oneTrue, Meta, matchAll: false));

        var allFalse = new List<StudioFilter>
        {
            new("statut", "eq", "Validée"),
            new("montant", "gt", 999m)
        };
        Assert.False(StudioFilterEvaluator.PassesAll(row, allFalse, Meta, matchAll: false));
    }

    [Fact]
    public void Operators_set_equals_record_view_validator_operators()
    {
        Assert.Equal(11, StudioFilterEvaluator.Operators.Count);
        Assert.True(StudioFilterEvaluator.Operators.SetEquals(RecordViewDefinitionValidator.Operators));
    }

    [Fact]
    public void Date_fields_compare_chronologically()
    {
        var row = Row(("date", "2026-02-01"));
        Assert.True(Passes(row, new StudioFilter("date", "gt", "2026-01-15")));
        Assert.False(Passes(row, new StudioFilter("date", "lt", "2026-01-15")));
        Assert.True(Passes(row, new StudioFilter("date", "between", "2026-01-01", "2026-12-31")));
    }
}
