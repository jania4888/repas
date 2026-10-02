using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Relevé mensuel BIAT (gabarit bilingue « RELEVÉ DE COMPTE MENSUEL ») et fichiers qui assemblent
/// plusieurs relevés : lecture déterministe, découpage par période, ordre chronologique, continuité.
/// Données fictives ; la recette sur le vrai relevé est privée (hors dépôt).
/// </summary>
public sealed class BankStatementLayoutExtractorBiatMonthlyTests
{
    private static readonly BankStatementLayoutExtractor Extractor = new();

    private static Monthly July(decimal opening = 6_000.000m) => new(new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 31), new Spec("08", opening, new[]
    {
        new Op("02/07/2026", "01/07/2026", new[] { "COM TVA VIREMENT REF : 00070000000001" }, 2.380m, null),
        new Op("02/07/2026", "03/07/2026", new[] { "VIREMENT TUNISIE AUTRE BANQUE 00070000000001" }, null, 345.678m),
        new Op("07/07/2026", "07/07/2026", new[] { "BLOCAGE RESERVATION CHEQUE 0000101" }, 2_199.000m, null),
        new Op("14/07/2026", "07/07/2026", new[] { "DEBLOCAGE RESERVATION CHEQUE 0000101" }, null, 2_199.000m),
        new Op("14/07/2026", "13/07/2026", new[] { "REGLEMENT CHEQUE NO 0000101 F/ STE EXEMPLE" }, 2_199.000m, null)
    }));

    private static Monthly August(decimal opening) => new(new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31), new Spec("08", opening, new[]
    {
        new Op("03/08/2026", "31/07/2026", new[] { "REGLEMENT CHEQUE NO 0000102 F/ STE EXEMPLE" }, 120.250m, null),
        new Op("04/08/2026", "05/08/2026", new[] { "VIREMENT TUNISIE AUTRE BANQUE 00080000000001" }, null, 1_400.900m)
    }));

    [Fact]
    public void Monthly_template_is_read_without_ai_and_reconciles()
    {
        var july = July();

        var result = Extractor.Extract(BiatMonthlyLike(july));

        Assert.Equal("biat-releve-mensuel", result.ProfileId);
        Assert.Empty(result.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).Select(i => i.Message));
        Assert.Equal(new DateOnly(2026, 7, 1), result.Header.PeriodStart);
        Assert.Equal(new DateOnly(2026, 7, 31), result.Header.PeriodEnd);
        Assert.Equal(july.Spec.Opening, result.Header.OpeningBalance!.Value);
        Assert.Equal(july.Spec.Closing, result.Header.ClosingBalance!.Value);
        Assert.Equal(5, result.Lines.Count);
        Assert.True(result.Lines[0].IsDebit, "commission au débit");
        Assert.False(result.Lines[3].IsDebit, "déblocage au crédit");
        Assert.True(BankStatementBalanceCheck.Evaluate(result.Header, result.Lines).IsBalanced);
    }

    [Fact]
    public void File_with_two_months_in_reverse_order_is_split_chronologically()
    {
        var july = July();
        var august = August(opening: july.Spec.Closing);
        var pdf = BiatMonthlyLike(august, july);

        var results = Extractor.ExtractAll(pdf);

        Assert.Equal(2, results.Count);
        Assert.Equal(new DateOnly(2026, 7, 1), results[0].Header.PeriodStart);
        Assert.Equal(new DateOnly(2026, 8, 1), results[1].Header.PeriodStart);
        Assert.All(results, r => Assert.Empty(r.Issues.Where(i => i.Severity != StatementIssueSeverity.Info).Select(i => i.Message)));
        Assert.Equal(5, results[0].Lines.Count);
        Assert.Equal(2, results[1].Lines.Count);
        Assert.All(results, r => Assert.Equal(1, r.PageCount));
        Assert.All(results, r => Assert.True(BankStatementBalanceCheck.Evaluate(r.Header, r.Lines).IsBalanced));
    }

    [Fact]
    public void Reading_such_a_file_as_one_statement_is_refused_never_mixed()
    {
        var july = July();

        var result = Extractor.Extract(BiatMonthlyLike(August(july.Spec.Closing), july));

        var issue = Assert.Single(result.Issues, i => i.Code == StatementIssueCodes.MultipleStatements);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.Contains("01/07/2026–31/07/2026", issue.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_month_between_two_statements_is_reported_without_blocking()
    {
        var july = July();
        var august = August(opening: july.Spec.Closing + 100m);

        var results = Extractor.ExtractAll(BiatMonthlyLike(july, august));

        var warning = Assert.Single(results[1].Issues, i => i.Code == StatementIssueCodes.Discontinuity);
        Assert.Equal(StatementIssueSeverity.Warning, warning.Severity);
        Assert.DoesNotContain(results[0].Issues, i => i.Code == StatementIssueCodes.Discontinuity);
    }

    [Fact]
    public void Overlapping_periods_block_the_later_statement()
    {
        var july = July();
        var overlapping = new Monthly(new DateOnly(2026, 7, 15), new DateOnly(2026, 8, 14), August(july.Spec.Closing).Spec);

        var results = Extractor.ExtractAll(BiatMonthlyLike(july, overlapping));

        Assert.Contains(results[1].Issues, i => i.Code == StatementIssueCodes.PeriodsOverlap && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void More_statements_than_allowed_are_refused()
    {
        var months = Enumerable.Range(0, BankStatementLayoutExtractor.MaxStatementsPerFile + 1)
            .Select(i =>
            {
                var from = new DateOnly(2025, 1, 1).AddMonths(i);
                return new Monthly(from, from.AddMonths(1).AddDays(-1), new Spec("08", 100m, new[]
                {
                    new Op(from.AddDays(2).ToString("dd/MM/yyyy"), from.AddDays(2).ToString("dd/MM/yyyy"), new[] { "COM TVA VIREMENT" }, 2.380m, null)
                }));
            })
            .ToArray();

        var results = Extractor.ExtractAll(BiatMonthlyLike(months));

        var only = Assert.Single(results);
        Assert.Contains(only.Issues, i => i.Code == StatementIssueCodes.TooManyStatements && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Single_statement_files_read_exactly_as_before()
    {
        var stb = new Spec("10", 1_000.000m, new[]
        {
            new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
            new Op("05/01/2026", "02/01/2026", new[] { "AGIOS DU 01/01/2026 AU 05/01/2026" }, 12.500m, null)
        });
        var pdf = StbLike(stb);

        var single = Extractor.Extract(pdf);
        var all = Extractor.ExtractAll(pdf);

        var only = Assert.Single(all);
        Assert.Equal(single.Header, only.Header);
        Assert.Equal(single.Lines.Select(Shape), only.Lines.Select(Shape));
        Assert.Equal(single.Issues, only.Issues);
        Assert.Equal(single.PageCount, only.PageCount);
        Assert.DoesNotContain(single.Issues, i => i.Code == StatementIssueCodes.MultipleStatements);
    }

    private static string Shape(ExtractedStatementLine l) =>
        $"{l.Index}|{l.PageNumber}|{l.TransactionDate}|{l.ValueDate}|{l.Label}|{string.Join('/', l.LabelLines)}|{l.Amount}|{l.IsDebit}|{l.Source}";

    // ── Choix du profil BIAT ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("RELEVE DE COMPTE MENSUEL COMPTE COURANT EN TND", "biat-releve-mensuel")]
    [InlineData("DINAR TUNISIEN SOLDE AU", "biat-releve")]
    [InlineData("AUCUN MARQUEUR CONNU", "biat-releve")]
    public void Bank_code_08_picks_the_template_named_in_the_document(string text, string expectedProfile) =>
        Assert.Equal(expectedProfile, BankStatementProfileRegistry.Default.Resolve("08", text).Id);

    [Fact]
    public void Banks_with_a_single_template_are_unaffected()
    {
        Assert.Equal("stb-historique", BankStatementProfileRegistry.Default.Resolve("10", "RELEVE DE COMPTE MENSUEL").Id);
        Assert.Equal("generic", BankStatementProfileRegistry.Default.Resolve(null, "RIEN").Id);
    }
}
