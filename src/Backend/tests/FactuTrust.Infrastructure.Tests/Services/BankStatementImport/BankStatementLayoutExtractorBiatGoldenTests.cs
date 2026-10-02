using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Relevé BIAT de référence (fixture déjà présente) lu par le nouvel extracteur : dates en deux
/// mots, dates valeur compactes, compte devenu débiteur, total crédit incluant l'ouverture.
/// Le parseur historique (<c>TunisianBankStatementTextParser</c>) n'est pas touché et garde son
/// propre test (<c>BankStatementGoldenPdfTests</c>).
/// </summary>
public sealed class BankStatementLayoutExtractorBiatGoldenTests
{
    [Fact]
    public void Biat_golden_statement_reconciles_to_the_millime()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "bank-statements", "biat-janvier-2026.pdf");
        var result = new BankStatementLayoutExtractor().Extract(File.ReadAllBytes(path));

        Assert.Empty(result.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).Select(i => i.Message));
        Assert.Equal("biat-releve", result.ProfileId);
        Assert.Equal("08503000231001399743", result.Header.Rib);
        Assert.Equal("TND", result.Header.Currency);
        Assert.Equal(367, result.Lines.Count);
        Assert.Equal(17_837.479m, result.Header.OpeningBalance!.Value);
        Assert.Equal(-18_732.846m, result.Header.ClosingBalance!.Value); // compte débiteur en fin de mois
        Assert.Equal(199_195.843m, result.Header.TotalDebits!.Value);
        Assert.Equal(180_462.997m, result.Header.TotalCredits!.Value);

        var check = BankStatementBalanceCheck.Evaluate(result.Header, result.Lines);
        Assert.True(check.IsBalanced);
        Assert.Equal(0m, check.Difference);

        var first = result.Lines[0];
        Assert.Equal(new DateOnly(2026, 1, 2), first.TransactionDate);
        Assert.Equal(new DateOnly(2026, 1, 2), first.ValueDate);
        Assert.True(first.IsDebit);
        Assert.Equal(3_000.000m, first.Amount);
        Assert.Equal("VIREMENT TN MEME BQ 0639194", first.Label);
    }
}
