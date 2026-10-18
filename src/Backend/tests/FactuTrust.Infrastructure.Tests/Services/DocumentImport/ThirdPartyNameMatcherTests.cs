using FactuTrust.Application.Features.Accounting.DocumentImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

public sealed class ThirdPartyNameMatcherTests
{
    private sealed record Candidate(string Name, string? FiscalIdNormalized);

    private static NameMatchResult<Candidate> Match(
        string invoiceName, string? invoiceFiscalIdNormalized, params Candidate[] candidates) =>
        ThirdPartyNameMatcher.Match(
            invoiceName, invoiceFiscalIdNormalized, candidates, c => c.Name, c => c.FiscalIdNormalized);

    [Fact]
    public void Match_WithNoCandidateAboveTheThreshold_ReturnsNone()
    {
        var result = Match("Ste Slimen", null, new Candidate("Totalement différent", null));

        Assert.Equal(NameMatchOutcome.None, result.Outcome);
        Assert.Null(result.Match);
    }

    [Fact]
    public void Match_WithExactlyOneCandidateAboveTheThreshold_ReturnsUnique()
    {
        var result = Match("Ste Slimen", null, new Candidate("Ste Slimen", null));

        Assert.Equal(NameMatchOutcome.Unique, result.Outcome);
        Assert.Equal("Ste Slimen", result.Match?.Name);
    }

    [Fact]
    public void Match_WithSeveralCandidatesAboveTheThreshold_ReturnsAmbiguous()
    {
        var result = Match(
            "Ste Slimen", null,
            new Candidate("Ste Slimen", null),
            new Candidate("Ste Slimenn", null));

        Assert.Equal(NameMatchOutcome.Ambiguous, result.Outcome);
        Assert.Equal(2, result.Candidates.Count);
    }

    [Fact]
    public void Match_WhenTheInvoiceHasAFiscalId_DiscardsHomonymsWithADifferentOne()
    {
        var result = Match(
            "Ste Slimen", "1525071PBM000",
            new Candidate("Ste Slimen", "9999999ZZZ000"));

        Assert.Equal(NameMatchOutcome.RejectedByFiscalId, result.Outcome);
        Assert.Single(result.Candidates);
    }

    [Fact]
    public void Match_WhenTheInvoiceHasAFiscalId_KeepsCandidatesWithTheSameOne()
    {
        var result = Match(
            "Ste Slimen", "1525071PBM000",
            new Candidate("Ste Slimen", "1525071PBM000"),
            new Candidate("Ste Slimenn", "9999999ZZZ000"));

        Assert.Equal(NameMatchOutcome.Unique, result.Outcome);
        Assert.Equal("1525071PBM000", result.Match?.FiscalIdNormalized);
    }

    [Fact]
    public void Match_WhenTheInvoiceHasAFiscalId_KeepsCandidatesWithNoFiscalIdOfTheirOwn()
    {
        // Un candidat sans MF connu n'est pas un homonyme écarté : on ne sait simplement rien de lui.
        var result = Match("Ste Slimen", "1525071PBM000", new Candidate("Ste Slimen", null));

        Assert.Equal(NameMatchOutcome.Unique, result.Outcome);
    }

    [Fact]
    public void Match_IsCaseAndAccentInsensitiveViaTheUnderlyingSimilarityScore()
    {
        var result = Match("STE SLIMEN", null, new Candidate("Ste Slimen", null));

        Assert.Equal(NameMatchOutcome.Unique, result.Outcome);
    }
}
