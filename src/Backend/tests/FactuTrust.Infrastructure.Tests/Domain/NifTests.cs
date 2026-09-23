using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class NifTests
{
    [Fact]
    public void Create_OfficialForm_IsStoredUnchanged()
    {
        var nif = NIF.Create("1772793W/A/M/000").Value;

        Assert.Equal("1772793W/A/M/000", nif.Value);
        Assert.Equal("1772793", nif.IdentificationNumber);
        Assert.Equal('W', nif.TaxpayerCategory);
        Assert.Equal('A', nif.MainActivity);
        Assert.Equal('M', nif.SecondaryEstablishment);
        Assert.Equal("000", nif.OfficeCode);
        Assert.Equal("1772793/W/A/M/000", nif.LegacySpelling);
    }

    [Fact]
    public void Create_HistoricalSpelling_IsCanonicalized_AndEqualsOfficial()
    {
        var historical = NIF.Create("1772793/W/A/M/000").Value;
        var official = NIF.Create("1772793W/A/M/000").Value;

        Assert.Equal("1772793W/A/M/000", historical.Value);
        Assert.Equal(official, historical);
        Assert.Equal('W', historical.TaxpayerCategory);
    }

    [Fact]
    public void TryCanonicalize_IsIdempotent()
    {
        Assert.True(NIF.TryCanonicalize("1772793/w/a/m/000", out var once));
        Assert.True(NIF.TryCanonicalize(once, out var twice));

        Assert.Equal("1772793W/A/M/000", once);
        Assert.Equal(once, twice);
    }

    [Theory]
    [InlineData("  1772793w/a/m/000  ")]
    [InlineData("1772793W\u2044A\u2044M\u2044000")]
    [InlineData("1772793w\u2215a\u2215m\u2215000")]
    public void Create_NormalizesCaseSpacesAndUnicodeSlashes(string input)
    {
        var nif = NIF.Create(input).Value;
        Assert.Equal("1772793W/A/M/000", nif.Value);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("1772793W/A/M/0000")]
    [InlineData("1234567A/M/000")]
    [InlineData("1772793W/A/M/00")]
    [InlineData("1772793WAM000")]
    [InlineData("' OR 1=1")]
    [InlineData("1772793\u0410/A/M/000")]
    public void Create_RejectsAnythingOutsideTheTwoSpellings(string input)
    {
        var result = NIF.Create(input);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Create_RejectsInputLongerThanFortyCharacters()
    {
        var result = NIF.Create(new string('1', 41));
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void HistoricalValue_StillExposesTheKeyLetter()
    {
        Assert.True(NIF.TryGetParts("1234567/D/B/C/000", out var parts));
        Assert.Equal('D', parts.Key);
        Assert.Equal("1234567D/B/C/000", $"{parts.Digits}{parts.Key}/{parts.Second}/{parts.Third}/{parts.Office}");
    }

    [Fact]
    public void DistinctSpellingsOfTheSameMatricule_AreACollision()
    {
        var rows = new[] { "1772793W/A/M/000", "1772793/W/A/M/000", "0000000A/A/M/000" };

        Assert.True(HasDistinctSpellingCollision(rows.Take(2)));
        Assert.False(HasDistinctSpellingCollision(rows.Skip(1)));
        Assert.False(HasDistinctSpellingCollision(new[] { "1772793/W/A/M/000", "1772793/W/A/M/000" }));
    }

    [Fact]
    public void Rewrite_LeavesOfficialUntouched_AndSecondPassIsStable()
    {
        Assert.Equal("1772793W/A/M/000", RewriteStored("1772793/W/A/M/000"));
        Assert.Equal("1772793W/A/M/000", RewriteStored("1772793W/A/M/000"));
        Assert.Equal("1772793W/A/M/000", RewriteStored(RewriteStored("1772793/W/A/M/000")));
        Assert.Equal("not-a-nif", RewriteStored("not-a-nif"));
    }

    /// <summary>
    /// Même règle que le précontrôle SQL : deux chaînes distinctes, une seule forme canonique.
    /// Les doublons déjà identiques ne comptent pas.
    /// </summary>
    private static bool HasDistinctSpellingCollision(IEnumerable<string> rawValues)
    {
        var parsed = new List<(string Raw, string Canonical)>();
        foreach (var value in rawValues)
        {
            if (NIF.TryCanonicalize(value, out var canonical))
                parsed.Add((value, canonical));
        }

        return parsed
            .GroupBy(pair => pair.Canonical, StringComparer.Ordinal)
            .Any(group => group.Select(pair => pair.Raw).Distinct(StringComparer.Ordinal).Count() > 1);
    }

    private static string RewriteStored(string stored) =>
        NIF.TryCanonicalize(stored, out var canonical) ? canonical : stored;
}
