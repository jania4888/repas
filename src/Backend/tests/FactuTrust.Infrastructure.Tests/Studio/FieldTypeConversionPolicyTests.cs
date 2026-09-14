using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 3.1 — Verrouille la matrice D4 (<see cref="FieldTypeConversionPolicy.Classify"/>), évaluée dans
/// l'ordre 1→7 du plan (deny-by-default en dernier recours) : aucune paire ne doit jamais lever
/// d'exception, et chaque règle explicite du plan est couverte par au moins un cas représentatif.
/// </summary>
public sealed class FieldTypeConversionPolicyTests
{
    private static readonly CustomFieldType[] AllTypes = Enum.GetValues<CustomFieldType>();

    // ---- Règle 1 : même type ----

    [Theory]
    [InlineData(CustomFieldType.Text)]
    [InlineData(CustomFieldType.Number)]
    [InlineData(CustomFieldType.RelationCustom)]
    [InlineData(CustomFieldType.Formula)]
    public void Same_type_is_always_forbidden(CustomFieldType type)
    {
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(type, type));
        Assert.Equal("Le champ est déjà de ce type.", FieldTypeConversionPolicy.Describe(type, type));
    }

    // ---- Règle 2 : la cible se crée comme un nouveau champ ----

    [Theory]
    [InlineData(CustomFieldType.Formula)]
    [InlineData(CustomFieldType.Lookup)]
    [InlineData(CustomFieldType.Rollup)]
    [InlineData(CustomFieldType.Attachment)]
    [InlineData(CustomFieldType.Signature)]
    [InlineData(CustomFieldType.AutoNumber)]
    public void Create_only_target_types_are_always_forbidden(CustomFieldType to)
    {
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(CustomFieldType.Text, to));
    }

    // ---- Règle 3 : la source est immuable ----

    [Theory]
    [InlineData(CustomFieldType.Attachment)]
    [InlineData(CustomFieldType.Signature)]
    [InlineData(CustomFieldType.Formula)]
    [InlineData(CustomFieldType.Lookup)]
    [InlineData(CustomFieldType.Rollup)]
    public void Immutable_source_types_can_never_change(CustomFieldType from)
    {
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(from, CustomFieldType.Text));
        Assert.Contains("ne peut pas changer de type", FieldTypeConversionPolicy.Describe(from, CustomFieldType.Text));
    }

    // ---- Règle 4 : relations ----

    [Fact]
    public void Relation_to_scalar_is_forbidden()
    {
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(CustomFieldType.RelationCustom, CustomFieldType.Text));
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(CustomFieldType.RelationExisting, CustomFieldType.Number));
    }

    [Fact]
    public void Relation_custom_and_relation_existing_require_an_empty_table()
    {
        Assert.Equal(FieldTypeConversion.RequiresEmptyTable, FieldTypeConversionPolicy.Classify(CustomFieldType.RelationCustom, CustomFieldType.RelationExisting));
        Assert.Equal(FieldTypeConversion.RequiresEmptyTable, FieldTypeConversionPolicy.Classify(CustomFieldType.RelationExisting, CustomFieldType.RelationCustom));
    }

    // ---- Règle 5 : sans perte (incl. R11) ----

    [Theory]
    [InlineData(CustomFieldType.Date, CustomFieldType.Text)]
    [InlineData(CustomFieldType.Select, CustomFieldType.Text)]
    [InlineData(CustomFieldType.DateTime, CustomFieldType.MultilineText)]
    [InlineData(CustomFieldType.MultiSelect, CustomFieldType.Text)]
    [InlineData(CustomFieldType.Boolean, CustomFieldType.Text)]
    [InlineData(CustomFieldType.AutoNumber, CustomFieldType.Text)]
    public void R11_typed_to_text_is_lossless_and_mentions_the_lost_display(CustomFieldType from, CustomFieldType to)
    {
        Assert.Equal(FieldTypeConversion.Lossless, FieldTypeConversionPolicy.Classify(from, to));
        Assert.Contains("perd son affichage", FieldTypeConversionPolicy.Describe(from, to));
    }

    [Theory]
    [InlineData(CustomFieldType.Number, CustomFieldType.Decimal)]
    [InlineData(CustomFieldType.Number, CustomFieldType.Money)]
    [InlineData(CustomFieldType.Number, CustomFieldType.Percentage)]
    [InlineData(CustomFieldType.Decimal, CustomFieldType.Money)]
    [InlineData(CustomFieldType.Money, CustomFieldType.Percentage)]
    [InlineData(CustomFieldType.Percentage, CustomFieldType.Decimal)]
    [InlineData(CustomFieldType.Date, CustomFieldType.DateTime)]
    [InlineData(CustomFieldType.Select, CustomFieldType.MultiSelect)]
    [InlineData(CustomFieldType.Text, CustomFieldType.MultilineText)]
    [InlineData(CustomFieldType.MultilineText, CustomFieldType.QrCode)]
    [InlineData(CustomFieldType.QrCode, CustomFieldType.Barcode)]
    [InlineData(CustomFieldType.Barcode, CustomFieldType.Text)]
    [InlineData(CustomFieldType.Rating, CustomFieldType.Number)]
    [InlineData(CustomFieldType.Rating, CustomFieldType.Decimal)]
    public void Other_lossless_pairs_are_classified_lossless(CustomFieldType from, CustomFieldType to)
    {
        Assert.Equal(FieldTypeConversion.Lossless, FieldTypeConversionPolicy.Classify(from, to));
    }

    // ---- Règle 6 : exige une table vide ----

    [Theory]
    [InlineData(CustomFieldType.Text, CustomFieldType.Number)]
    [InlineData(CustomFieldType.Text, CustomFieldType.Boolean)]
    [InlineData(CustomFieldType.MultilineText, CustomFieldType.Date)]
    [InlineData(CustomFieldType.Text, CustomFieldType.RelationCustom)]
    [InlineData(CustomFieldType.DateTime, CustomFieldType.Date)]
    [InlineData(CustomFieldType.Decimal, CustomFieldType.Number)]
    [InlineData(CustomFieldType.Money, CustomFieldType.Rating)]
    [InlineData(CustomFieldType.MultiSelect, CustomFieldType.Select)]
    [InlineData(CustomFieldType.Number, CustomFieldType.Boolean)]
    [InlineData(CustomFieldType.Boolean, CustomFieldType.Number)]
    public void Requires_empty_table_pairs_are_classified_as_such(CustomFieldType from, CustomFieldType to)
    {
        Assert.Equal(FieldTypeConversion.RequiresEmptyTable, FieldTypeConversionPolicy.Classify(from, to));
    }

    [Fact]
    public void Describe_mentions_the_record_count_when_the_table_must_be_empty()
    {
        var message = FieldTypeConversionPolicy.Describe(CustomFieldType.Text, CustomFieldType.Number, recordCount: 12);
        Assert.Contains("12", message);
        Assert.Contains("table vide", message);
    }

    // ---- Règle 7 : deny-by-default ----

    [Theory]
    [InlineData(CustomFieldType.Money, CustomFieldType.Boolean)]
    [InlineData(CustomFieldType.Percentage, CustomFieldType.Boolean)]
    [InlineData(CustomFieldType.Rating, CustomFieldType.Boolean)]
    [InlineData(CustomFieldType.Boolean, CustomFieldType.Date)]
    public void Unlisted_pairs_default_to_forbidden(CustomFieldType from, CustomFieldType to)
    {
        Assert.Equal(FieldTypeConversion.Forbidden, FieldTypeConversionPolicy.Classify(from, to));
        Assert.Contains("non prise en charge", FieldTypeConversionPolicy.Describe(from, to));
    }

    // ---- Robustesse : toute la table 22×22 est classée sans exception ----

    [Fact]
    public void Every_pair_of_the_full_matrix_is_classified_without_throwing()
    {
        foreach (var from in AllTypes)
        foreach (var to in AllTypes)
        {
            var policy = FieldTypeConversionPolicy.Classify(from, to);
            Assert.True(Enum.IsDefined(policy));
            var message = FieldTypeConversionPolicy.Describe(from, to, recordCount: 3);
            Assert.False(string.IsNullOrWhiteSpace(message));
        }
    }

    [Fact]
    public void PolicyCode_returns_the_three_snake_case_strings()
    {
        Assert.Equal("lossless", FieldTypeConversionPolicy.PolicyCode(FieldTypeConversion.Lossless));
        Assert.Equal("requires_empty_table", FieldTypeConversionPolicy.PolicyCode(FieldTypeConversion.RequiresEmptyTable));
        Assert.Equal("forbidden", FieldTypeConversionPolicy.PolicyCode(FieldTypeConversion.Forbidden));
    }

    [Fact]
    public void UniqueCapable_matches_the_documented_set()
    {
        var expected = new[]
        {
            CustomFieldType.Text, CustomFieldType.Number, CustomFieldType.Decimal, CustomFieldType.Money,
            CustomFieldType.Date, CustomFieldType.DateTime, CustomFieldType.Select, CustomFieldType.QrCode,
            CustomFieldType.Barcode, CustomFieldType.AutoNumber, CustomFieldType.RelationCustom, CustomFieldType.RelationExisting
        };
        Assert.Equal(expected.Length, FieldTypeConversionPolicy.UniqueCapable.Count);
        foreach (var type in expected)
            Assert.Contains(type, FieldTypeConversionPolicy.UniqueCapable);
    }
}
