using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

public sealed class BankStatementImportPureFunctionsTests
{
    // ── Clé RIB ────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("10100000000123456792")] // STB
    [InlineData("14100000000765432118")] // BH
    [InlineData("25100000000111222302")] // Zitouna
    [InlineData("04000000000222333441")] // Attijari
    [InlineData("08503000231001399743")] // BIAT
    [InlineData("1010 0000 0001 2345 6792")]
    public void Rib_key_is_valid_for_real_ribs(string rib) => Assert.True(TunisianIban.HasValidRibKey(rib));

    [Theory]
    [InlineData("10100000000123456793")] // clé altérée
    [InlineData("10100000000123456")] // trop court
    [InlineData(null)]
    [InlineData("")]
    public void Rib_key_rejects_altered_or_incomplete_ribs(string? rib) => Assert.False(TunisianIban.HasValidRibKey(rib));

    [Fact]
    public void Iban_derivation_matches_the_iban_registry_example() =>
        Assert.Equal("TN5910006035183598478831", TunisianIban.FromRib("10006035183598478831"));

    // ── Montants ───────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("1 234 567.891", "1234567.891", 3)] // STB, fragments regroupés
    [InlineData("12 345.678", "12345.678", 3)]
    [InlineData("1.500", "1.500", 3)] // STB : point décimal
    [InlineData("2 500,000", "2500.000", 3)] // BH
    [InlineData("-2222,111", "-2222.111", 3)] // Zitouna
    [InlineData("61000,00", "61000.00", 2)] // Attijari, récapitulatif
    [InlineData("17.837,479", "17837.479", 3)] // BIAT
    public void Amounts_are_read_whatever_the_bank_format(string text, string expected, int decimals)
    {
        Assert.True(BankStatementLayoutExtractor.TryParseAmount(text, out var value, out var d));
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), value);
        Assert.Equal(decimals, d);
    }

    [Theory]
    [InlineData("776.875.000")] // capital social STB : trois points, aucune décimale crédible
    [InlineData("02/01/2026")]
    [InlineData("0001234")]
    [InlineData("12 34,567")]
    [InlineData("1,500.000,000")]
    public void Non_amounts_are_rejected(string text) =>
        Assert.False(BankStatementLayoutExtractor.TryParseAmount(text, out _, out _));

    // ── Contrôle de soldes ─────────────────────────────────────────────────────────────────

    private static ExtractedStatementLine Line(decimal amount, bool isDebit) => new()
    {
        Index = 0, PageNumber = 1, TransactionDate = new DateOnly(2026, 1, 2), Label = "X", Amount = amount, IsDebit = isDebit
    };

    private static ExtractedStatementHeader Header(decimal opening, decimal closing, int decimals = 3) => new()
    {
        OpeningBalance = new StatementAmount(opening, decimals),
        ClosingBalance = new StatementAmount(closing, decimals)
    };

    [Fact]
    public void Balance_check_passes_at_the_millime()
    {
        // Zitouna : 50,250 + 18 100,000 − 17 000,000 = 1150,250
        var outcome = BankStatementBalanceCheck.Evaluate(Header(50.250m, 1150.250m),
            new[] { Line(18_100m, false), Line(17_000.000m, true) });
        Assert.True(outcome.IsBalanced);
        Assert.False(outcome.HasBlockingIssue);
    }

    [Fact]
    public void Balance_check_blocks_a_one_millime_gap()
    {
        var outcome = BankStatementBalanceCheck.Evaluate(Header(50.250m, 1150.250m),
            new[] { Line(18_100m, false), Line(17_000.001m, true) });
        Assert.False(outcome.IsBalanced);
        Assert.Contains(outcome.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Balance_check_detects_a_line_put_on_the_wrong_side()
    {
        var outcome = BankStatementBalanceCheck.Evaluate(Header(100m, 90m),
            new[] { Line(10m, false) }); // devait être un débit
        Assert.False(outcome.IsBalanced);
    }

    [Fact]
    public void Balance_check_tolerates_only_the_rounding_of_a_two_decimal_summary()
    {
        // Attijari : récapitulatif au centime, lignes au millime.
        var header = Header(400.00m, 9400.00m, decimals: 2);
        Assert.True(BankStatementBalanceCheck.Evaluate(header, new[] { Line(61_000.00m, false), Line(52_000.004m, true) }).IsBalanced);
        Assert.False(BankStatementBalanceCheck.Evaluate(header, new[] { Line(61_000.00m, false), Line(52_000.02m, true) }).IsBalanced);
    }

    [Fact]
    public void Balance_check_handles_an_overdrawn_account()
    {
        // Solde débiteur : −500 + 200 − 50 = −350.
        var outcome = BankStatementBalanceCheck.Evaluate(Header(-500m, -350m), new[] { Line(200m, false), Line(50m, true) });
        Assert.True(outcome.IsBalanced);
    }

    [Fact]
    public void Missing_balances_block_because_completeness_cannot_be_proven()
    {
        var outcome = BankStatementBalanceCheck.Evaluate(new ExtractedStatementHeader(), new[] { Line(10m, true) });
        Assert.Contains(outcome.Issues, i => i.Code == StatementIssueCodes.OpeningNotFound && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Contains(outcome.Issues, i => i.Code == StatementIssueCodes.ClosingNotFound && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Unlabelled_totals_mismatch_is_only_a_warning()
    {
        var header = Header(0m, -10m) with { TotalDebits = new StatementAmount(11m, 3), TotalsLabelled = false };
        var outcome = BankStatementBalanceCheck.Evaluate(header, new[] { Line(10m, true) });
        Assert.Contains(outcome.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Severity == StatementIssueSeverity.Warning);

        var labelled = BankStatementBalanceCheck.Evaluate(header with { TotalsLabelled = true }, new[] { Line(10m, true) });
        Assert.Contains(labelled.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    // ── Libellés et TVA incluse ─────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("VIREMENT REÇU  Les Ateliers du Littoral-", "VIREMENT RECU LES ATELIERS DU LITTORAL")]
    [InlineData("PRÉLÈVEMENT OLS", "PRELEVEMENT OLS")]
    [InlineData("  RÈG CHÈQUE N° 0001234 ", "REG CHEQUE N° 0001234")]
    public void Labels_are_normalized(string raw, string expected) => Assert.Equal(expected, BankLabelNormalizer.Normalize(raw));

    [Theory]
    [InlineData("RÈG CHÈQUE N° 0001234", "REG CHEQUE N°")]
    [InlineData("ENCAISSEMENT EFFET EFF N° 011220000001", "ENCAISSEMENT EFFET EFF N°")]
    [InlineData("COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE", "COMMISSION VIREMENT RECU EN DINARS AUTRE BANQUE")]
    public void Label_core_drops_variable_numbers(string raw, string expected) => Assert.Equal(expected, BankLabelNormalizer.Core(raw));

    [Fact]
    public void Embedded_vat_is_split_when_consistent_with_19_percent()
    {
        var split = BankStatementEmbeddedVat.TryRead("VIR IBQ A DISTANCE COMMISSION VIR AUT BQ 004242 DONT TVA: 0,285", 1.785m);
        Assert.NotNull(split);
        Assert.Equal(1.500m, split!.NetAmount);
        Assert.Equal(0.285m, split.VatAmount);
        Assert.True(split.RateConsistent);
    }

    [Theory]
    [InlineData("COMMISSION SANS TVA", 1.5)]
    [InlineData("DONT TVA: 2,000", 1.785)] // TVA ≥ montant
    [InlineData("DONT TVA: 0,285 DONT TVA: 0,190", 1.785)] // deux mentions : libellé mal découpé
    public void Embedded_vat_is_not_invented(string label, double amount) =>
        Assert.Null(BankStatementEmbeddedVat.TryRead(label, (decimal)amount));

    [Fact]
    public void Embedded_vat_inconsistent_with_the_rate_is_flagged()
    {
        var split = BankStatementEmbeddedVat.TryRead("COM ET TVA DONT TVA: 0,900", 3.570m);
        Assert.NotNull(split);
        Assert.False(split!.RateConsistent);
    }

    // ── Profils ────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("10", "stb-historique")]
    [InlineData("14", "bh-releve")]
    [InlineData("25", "zitouna-releve")]
    [InlineData("04", "attijari-extrait")]
    [InlineData("99", "generic")]
    [InlineData(null, "generic")]
    public void Profile_is_chosen_by_the_rib_bank_code(string? code, string expected) =>
        Assert.Equal(expected, BankStatementProfileRegistry.Default.Resolve(code, string.Empty).Id);

    [Fact]
    public void Profiles_inherit_the_generic_exclusions()
    {
        var bh = BankStatementProfileRegistry.Default.Profiles.Single(p => p.Id == "bh-releve");
        Assert.Contains("SOLDE DISPONIBLE", bh.ExcludedSummaryLabels);
        Assert.Equal(new[] { "dd-MM" }, bh.OperationDateFormats);
    }
}
