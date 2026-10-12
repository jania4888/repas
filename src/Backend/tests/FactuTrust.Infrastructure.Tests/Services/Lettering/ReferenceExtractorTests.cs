using System.Diagnostics;
using FactuTrust.Infrastructure.Services.Lettering;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-3) : extraction des références de pièce pour la règle R2. Couvre la
/// normalisation, les filtres de longueur, le déterminisme et la résistance aux entrées
/// pathologiques (aucun ReDoS : motif NonBacktracking + troncature).
/// </summary>
public sealed class ReferenceExtractorTests
{
    [Theory]
    [InlineData("fac 2026/001", "FAC-2026-001")]
    [InlineData("FAC-2026-001", "FAC-2026-001")]
    [InlineData("fac_2026.001", "FAC-2026-001")]
    [InlineData(@"fac\2026\001", "FAC-2026-001")]
    [InlineData("fac  --  2026 / 001", "FAC-2026-001")]
    [InlineData("REG2026-005", "REG2026-005")]
    [InlineData("Règlement réf. rég2026-005", "REG2026-005")]
    public void Extract_NormalizesSeparatorsCaseAndDiacritics(string input, string expected)
    {
        Assert.Contains(expected, ReferenceExtractor.Extract(input, null, null));
    }

    [Fact]
    public void Extract_MergesAllFields_DistinctAndOrdinallySorted()
    {
        var tokens = ReferenceExtractor.Extract("REG-2026-005", "Facture FAC-2026-001", "fac 2026/001 et reg 2026 005");

        Assert.Equal(new[] { "FAC-2026-001", "REG-2026-005" }, tokens);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Règlement client")]
    [InlineData("2026-05-10")]          // date seule : pas de préfixe alphabétique
    [InlineData("10/05/2026")]
    [InlineData("AB12")]                // trop court
    [InlineData("AB-12")]               // moins de 3 chiffres
    [InlineData("A-12345")]             // une seule lettre
    public void Extract_ReturnsNothing_ForNonReferences(string? input)
    {
        Assert.Empty(ReferenceExtractor.Extract(input, input, input));
    }

    [Fact]
    public void Extract_IgnoresArabicText_WithoutException()
    {
        Assert.Empty(ReferenceExtractor.Extract("فاتورة رقم", "تسوية العميل", null));
        Assert.Equal(new[] { "FAC-2026-001" }, ReferenceExtractor.Extract("فاتورة FAC-2026-001", null, null));
    }

    [Fact]
    public void Extract_IsDeterministic()
    {
        const string label = "Lettrage FAC-2026-010, FAC-2026-002 et AV-2026-001";
        var first = ReferenceExtractor.Extract(label, null, null);
        var second = ReferenceExtractor.Extract(label, null, null);

        Assert.Equal(first, second);
        Assert.Equal(new[] { "AV-2026-001", "FAC-2026-002", "FAC-2026-010" }, first);
    }

    [Fact]
    public void Normalize_TruncatesBeforeProcessing()
    {
        var input = new string('A', 1000);
        Assert.Equal(ReferenceExtractor.MaxInputLength, ReferenceExtractor.Normalize(input).Length);
    }

    [Fact]
    public void Extract_IgnoresReferenceBeyondTruncation()
    {
        var input = new string('x', ReferenceExtractor.MaxInputLength) + " FAC-2026-001";
        Assert.Empty(ReferenceExtractor.Extract(input, null, null));
    }

    public static TheoryData<string> PathologicalInputs() => new()
    {
        string.Concat(Enumerable.Repeat("FAC-", 125)),
        new string('1', 500),
        string.Concat(Enumerable.Repeat("A-1-", 125)),
        string.Concat(Enumerable.Repeat("AB12-", 100)),
        string.Concat(Enumerable.Repeat("é ", 250)),
        new string('-', 500),
        string.Concat(Enumerable.Repeat("ABCDEFGHIJ", 50)),
    };

    [Theory]
    [MemberData(nameof(PathologicalInputs))]
    public void Extract_PathologicalInput_FinishesQuickly(string input)
    {
        ReferenceExtractor.Extract(input, input, input); // échauffement (compilation du motif)

        var sw = Stopwatch.StartNew();
        ReferenceExtractor.Extract(input, input, input);
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 50, $"Extraction trop lente : {sw.ElapsedMilliseconds} ms");
    }
}
