using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.SectorRules;

/// <summary>
/// Plan §3.2 — non-blocking NIF taxpayer-category / segment coherence check. Fail-open: only the
/// clearly-incoherent association cases produce a warning; everything else (unknown segment,
/// unmapped category) must return null.
/// </summary>
public sealed class NifCategorySegmentCoherenceCheckerTests
{
    private static NIF MakeNif(char category)
        => NIF.Create($"1234567/{category}/B/C/000").Value;

    [Fact]
    public void Official_and_historical_spellings_read_the_same_key_letter()
    {
        var historical = NIF.Create("1234567/D/B/C/000").Value;
        var official = NIF.Create("1234567D/B/C/000").Value;

        Assert.Equal(historical, official);
        Assert.Equal(
            NifCategorySegmentCoherenceChecker.CheckCoherence(historical, CompanySegments.Commerce),
            NifCategorySegmentCoherenceChecker.CheckCoherence(official, CompanySegments.Commerce));
        Assert.Null(NifCategorySegmentCoherenceChecker.CheckCoherence(
            NIF.Create("1772793W/A/M/000").Value, CompanySegments.Association));
    }

    [Fact]
    public void Association_category_with_non_association_segment_warns()
    {
        var nif = MakeNif('D');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Commerce);

        Assert.NotNull(warning);
        Assert.Contains("association", warning, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Association_segment_with_non_association_category_warns()
    {
        var nif = MakeNif('A');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Association);

        Assert.NotNull(warning);
        Assert.Contains("Association", warning);
    }

    [Fact]
    public void Association_category_with_association_segment_is_coherent()
    {
        var nif = MakeNif('D');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Association);

        Assert.Null(warning);
    }

    [Fact]
    public void Non_association_category_with_commerce_segment_is_coherent()
    {
        var nif = MakeNif('C');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Commerce);

        Assert.Null(warning);
    }

    [Fact]
    public void Unknown_segment_never_warns_fail_open()
    {
        var nif = MakeNif('D');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, "segment-inexistant");

        Assert.Null(warning);
    }

    [Fact]
    public void Null_segment_never_warns()
    {
        var nif = MakeNif('D');
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, null);

        Assert.Null(warning);
    }

    [Fact]
    public void Null_nif_never_warns()
    {
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(null, CompanySegments.Commerce);

        Assert.Null(warning);
    }

    /// <summary>
    /// Régression observée en production : un NIF réel dont la lettre de catégorie est « P »
    /// (hors table A–G) produisait « votre NIF indique la catégorie P (Inconnu) et non une
    /// association » — une accusation bâtie sur une lettre que le code déclare lui-même ne pas
    /// savoir interpréter. Une catégorie inconnue n'est pas une incohérence.
    /// </summary>
    [Theory]
    [InlineData('P')]
    [InlineData('M')]
    [InlineData('N')]
    [InlineData('Z')]
    public void Unknown_category_letter_never_warns(char category)
    {
        var nif = MakeNif(category);

        Assert.Null(NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Association));
        Assert.Null(NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Commerce));
    }

    /// <summary>Les catégories connues (A–G) restent recoupées : le durcissement n'a rien désactivé.</summary>
    [Theory]
    [InlineData('A')]
    [InlineData('B')]
    [InlineData('C')]
    [InlineData('E')]
    [InlineData('F')]
    [InlineData('G')]
    public void Known_non_association_category_with_association_segment_still_warns(char category)
    {
        var nif = MakeNif(category);
        var warning = NifCategorySegmentCoherenceChecker.CheckCoherence(nif, CompanySegments.Association);

        Assert.NotNull(warning);
        Assert.DoesNotContain("Inconnu", warning);
    }

    [Theory]
    [InlineData('A', true)]
    [InlineData('G', true)]
    [InlineData('P', false)]
    [InlineData('M', false)]
    [InlineData(' ', false)]
    public void IsKnown_matches_the_description_table(char category, bool expected)
    {
        Assert.Equal(expected, TaxpayerCategories.IsKnown(category));
        Assert.Equal(expected, TaxpayerCategories.GetDescription(category) != "Inconnu");
    }
}
