using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Extraction sur relevés synthétiques (CI) : mêmes pièges que les vrais relevés STB / BH /
/// Zitouna, sans aucune donnée personnelle.
/// </summary>
public sealed class BankStatementLayoutExtractorSyntheticTests
{
    private static readonly BankStatementLayoutExtractor Extractor = new();

    private static Spec StbSpec() => new("10", 12_345.678m, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("02/01/2026", "31/12/2025", new[] { "COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE" }, 1.500m, null),
        new Op("02/01/2026", "31/12/2025", new[] { "TVA SUR COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE" }, 0.285m, null),
        new Op("06/01/2026", "31/12/2025", new[] { "VIREMENTS EMIS SUR L'ÉTRANGER" }, 1_111_111.111m, null),
        new Op("13/01/2026", "09/01/2026", new[] { "TVA SUR COMM CERTIF CHEQUE CLIENTELE N°0001240 RECEVEUR", "DE" }, 1.520m, null),
        new Op("13/01/2026", "09/01/2026", new[] { "COMMISSION DE DOMICILIATION" }, 10.000m, null),
        new Op("13/01/2026", "09/01/2026", new[] { "COMMISSION DE DOMICILIATION" }, 10.000m, null),
        new Op("16/01/2026", "19/01/2026", new[] { "ENCAISSEMENT CHÈQUE N°0004321" }, null, 1_000_000.500m)
    });

    private static Spec BhSpec() => new("14", 1234.567m, new[]
    {
        new Op("05-01", "2026-01-04", new[] { "TBIA0000000000000001 000000000001C" }, 56.090m, null),
        new Op("09-01", "2026-01-10", new[] { "VRST. 1000001" }, null, 2_500.000m),
        new Op("12-01", "2026-01-15", new[] { "FOULEN FALTEN B AMOR IB AUTRES" }, null, 10_000.000m),
        new Op("12-01", "2026-01-15", new[] { "COMMISSION IB AUTRES" }, 3.000m, null),
        new Op("22-01", "2026-01-19", new[] { "PAIEMENT CHQ 0000777" }, 9_999.000m, null)
    });

    private static Spec ZitounaSpec() => new("25", 50.250m, new[]
    {
        new Op("09/01/2026", "11/01/2026", new[] { "PAIEMENT PRINCIPAL" }, 2_222.111m, null),
        new Op("09/01/2026", "09/01/2026", new[] { "VERSEMENT ESPECES" }, null, 7_500.000m),
        new Op("20/01/2026", "20/01/2026", new[] { "COM VIR TN AUTRE BQ AC-TND100000001" }, 1.904m, null),
        new Op("30/01/2026", "01/02/2026", new[] { "TVA 0012345678" }, 11.875m, null)
    });

    [Fact]
    public void Stb_like_grid_statement_reconciles_and_ignores_the_available_balance()
    {
        var spec = StbSpec();
        var result = Extractor.Extract(StbLike(spec));

        AssertReconciled(result, spec, "stb-historique");
        Assert.Equal(new DateOnly(2026, 1, 1), result.Header.PeriodStart);
        Assert.Equal(new DateOnly(2026, 1, 31), result.Header.PeriodEnd);
        Assert.True(result.Header.TotalsLabelled);

        var twoLines = Assert.Single(result.Lines, l => l.Label.StartsWith("TVA SUR COMM CERTIF", StringComparison.Ordinal));
        Assert.Equal(1.520m, twoLines.Amount);
        Assert.EndsWith(" DE", twoLines.Label, StringComparison.Ordinal);

        // Deux opérations strictement identiques le même jour : toutes deux conservées.
        Assert.Equal(2, result.Lines.Count(l => l.Label == "COMMISSION DE DOMICILIATION"));
    }

    [Fact]
    public void Bh_like_statement_without_header_text_reads_sides_from_amount_columns()
    {
        var spec = BhSpec();
        var result = Extractor.Extract(BhLike(spec));

        AssertReconciled(result, spec, "bh-releve");
        Assert.False(result.Header.TotalsLabelled);
        Assert.Equal(new DateOnly(2026, 1, 1), result.Header.PeriodStart);
        Assert.Equal(new DateOnly(2026, 1, 31), result.Header.PeriodEnd);

        var foulen = Assert.Single(result.Lines, l => l.Label.Contains("FOULEN", StringComparison.Ordinal));
        Assert.False(foulen.IsDebit);
        Assert.Equal(new DateOnly(2026, 1, 12), foulen.TransactionDate);
        Assert.Equal(new DateOnly(2026, 1, 15), foulen.ValueDate);
    }

    [Fact]
    public void Zitouna_like_statement_with_negative_debits_reconciles()
    {
        var spec = ZitounaSpec();
        var result = Extractor.Extract(ZitounaLike(spec));

        AssertReconciled(result, spec, "zitouna-releve");
        Assert.True(result.Lines[0].IsDebit);
        Assert.Equal(2_222.111m, result.Lines[0].Amount);
    }

    [Fact]
    public void A_falsified_closing_balance_blocks()
    {
        var spec = StbSpec() with { ClosingOverride = 21_111.222m };
        var result = Extractor.Extract(StbLike(spec));

        Assert.Contains(result.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.True(result.HasBlockingIssue);
    }

    [Fact]
    public void A_scanned_page_is_reported_unresolved_instead_of_being_guessed()
    {
        var result = Extractor.Extract(ImageOnly());

        Assert.Equal(new[] { 1 }, result.UnresolvedPages);
        Assert.Contains(result.Issues, i => i.Code == StatementIssueCodes.NoTextLayer && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Empty(result.Lines);
    }

    [Fact]
    public void Too_many_pages_are_refused_before_reading()
    {
        var result = Extractor.Extract(ManyPages(BankStatementLayoutExtractor.MaxPages + 1));

        Assert.Contains(result.Issues, i => i.Code == StatementIssueCodes.TooManyPages && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Empty(result.Lines);
    }

    [Fact]
    public void Garbage_bytes_are_reported_unreadable()
    {
        var result = Extractor.Extract(new byte[] { 0x4D, 0x5A, 0x90, 0x00, 0x03 });

        Assert.Contains(result.Issues, i => i.Code == StatementIssueCodes.Unreadable && i.Severity == StatementIssueSeverity.Blocking);
    }

    private static void AssertReconciled(ExtractedBankStatement result, Spec spec, string profile)
    {
        Assert.Empty(result.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).Select(i => i.Message));
        Assert.Equal(profile, result.ProfileId);
        Assert.Equal(spec.Rib, result.Header.Rib);
        Assert.Equal("TND", result.Header.Currency);
        Assert.Equal(spec.Ops.Count, result.Lines.Count);
        Assert.Equal(spec.Opening, result.Header.OpeningBalance!.Value);
        Assert.Equal(spec.Closing, result.Header.ClosingBalance!.Value);
        Assert.Equal(spec.TotalDebits, result.Lines.Where(l => l.IsDebit).Sum(l => l.Amount));
        Assert.Equal(spec.TotalCredits, result.Lines.Where(l => !l.IsDebit).Sum(l => l.Amount));

        for (var i = 0; i < spec.Ops.Count; i++)
        {
            var expected = spec.Ops[i];
            var actual = result.Lines[i];
            Assert.Equal(expected.Debit ?? expected.Credit, actual.Amount);
            Assert.Equal(expected.Debit is not null, actual.IsDebit);
        }
    }
}
