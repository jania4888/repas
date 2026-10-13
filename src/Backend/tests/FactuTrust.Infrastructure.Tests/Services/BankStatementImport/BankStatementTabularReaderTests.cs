using System.IO.Compression;
using System.Text;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Lecteur CSV/XLSX (plan §3.5) : détection délimiteur/en-tête, montants tunisiens (séparateur
/// milliers, parenthèses, signe en fin), mappage invalide, bombes zip, pied « TOTAL » lisible,
/// solde progressif, ordre inversé, cellules à formule — sans jamais exposer une exception brute.
/// </summary>
public sealed class BankStatementTabularReaderTests
{
    private static readonly BankStatementImportLimits Limits = new();

    private static BankStatementTabularMappingDto DebitCreditMapping(int header = 0) => new()
    {
        HeaderRowIndex = header,
        DateFormat = "dd/MM/yyyy",
        DecimalSeparator = ",",
        AmountMode = "debitCredit",
        DateColumn = 0,
        LabelColumns = new[] { 1 },
        DebitColumn = 2,
        CreditColumn = 3,
        BalanceColumn = 4
    };

    private static byte[] Csv(string content) => Encoding.UTF8.GetBytes(content);

    // ── Chargement CSV : délimiteur / en-tête ──────────────────────────────────────────────

    [Fact]
    public void Semicolon_delimited_csv_is_detected_and_rows_are_split_accordingly()
    {
        var content = Csv("Date;Libelle;Debit;Credit;Solde\n01/01/2026;VIREMENT;;100,000;1100,000\n");

        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits);

        Assert.True(table.IsSuccess);
        Assert.Equal(";", table.Value.Delimiter);
        Assert.Equal(0, table.Value.HeaderRowIndex);
        Assert.Equal(2, table.Value.TotalRowCount);
    }

    [Fact]
    public void Comma_delimited_csv_is_detected_when_it_dominates_the_sample()
    {
        var content = Csv("Date,Libelle,Debit,Credit,Solde\n01/01/2026,VIREMENT,,100.000,1100.000\n");

        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits);

        Assert.True(table.IsSuccess);
        Assert.Equal(",", table.Value.Delimiter);
    }

    [Fact]
    public void Empty_csv_is_rejected_as_no_lines()
    {
        var table = BankStatementTabularReader.LoadRawTable(Csv(""), ".csv", Limits);

        Assert.True(table.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularNoLines, table.Error.Code);
    }

    // ── Bombe zip XLSX ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Xlsx_with_too_many_zip_entries_is_rejected_before_closedxml_opens_it()
    {
        using var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            for (var i = 0; i < 5; i++)
            {
                var entry = archive.CreateEntry($"part{i}.xml");
                using var writer = new StreamWriter(entry.Open());
                writer.Write("<x/>");
            }
        }

        var limits = new BankStatementImportLimits { XlsxMaxZipEntries = 2 };
        var result = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularRejected, result.Error.Code);
    }

    [Fact]
    public void Xlsx_entry_with_an_extreme_compression_ratio_is_rejected_as_a_zip_bomb()
    {
        using var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("huge.xml", CompressionLevel.SmallestSize);
            using var writer = new StreamWriter(entry.Open());
            writer.Write(new string('A', 2_000_000));
        }

        var limits = new BankStatementImportLimits { XlsxMaxCompressionRatio = 10 };
        var result = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularRejected, result.Error.Code);
    }

    [Fact]
    public void Unreadable_bytes_never_leak_a_raw_exception_message()
    {
        var result = BankStatementTabularReader.LoadRawTable(new byte[] { 0x50, 0x4B, 0x00, 0x00 }, ".xlsx", Limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularUnreadable, result.Error.Code);
    }

    // ── Mappage suggéré / ambigu ───────────────────────────────────────────────────────────

    [Fact]
    public void Suggested_mapping_picks_up_synonym_headers_in_any_case()
    {
        var content = Csv("Date operation;Libellé;Débit;Crédit;Solde\n01/01/2026;VIREMENT;;100,000;1100,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var suggested = BankStatementTabularReader.SuggestMapping(table);

        Assert.Equal("debitCredit", suggested.AmountMode);
        Assert.Equal(2, suggested.DebitColumn);
        Assert.Equal(3, suggested.CreditColumn);
        Assert.Equal(4, suggested.BalanceColumn);
    }

    [Fact]
    public void Ambiguous_date_format_is_flagged_only_when_both_readings_disagree_on_a_sample()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n03/04/2026;A;;10,000\n05/06/2026;B;;10,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        Assert.True(BankStatementTabularReader.DetectAmbiguousDateFormat(table, 0));
    }

    [Fact]
    public void A_day_above_twelve_resolves_the_ambiguity_so_it_is_not_flagged()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n25/04/2026;A;;10,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        Assert.False(BankStatementTabularReader.DetectAmbiguousDateFormat(table, 0));
    }

    // ── Montants tunisiens (ParseLines) ───────────────────────────────────────────────────

    [Theory]
    [InlineData("1 234,500", 1234.500)]
    [InlineData("(150,000)", 150.000)]
    [InlineData("12,5-", 12.5)]
    [InlineData("17.837,479", 17837.479)]
    public void Tunisian_amount_formats_are_all_read_as_positive_debit(string debitText, decimal expected)
    {
        var content = Csv($"Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;{debitText};\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.True(line.IsDebit);
        Assert.Equal(expected, line.Amount);
    }

    [Fact]
    public void Both_debit_and_credit_filled_is_a_blocking_anomaly_not_a_silent_guess()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;ANOMALIE;10,000;5,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        Assert.Equal(StatementIssueCodes.TabularBothSides, Assert.Single(parsed).Error);
    }

    [Fact]
    public void Unreadable_date_is_a_blocking_anomaly_and_falls_back_to_today_or_value_date()
    {
        var content = Csv("Date;Libelle;Debit;Credit\nn-importe-quoi;LIGNE;10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        Assert.Equal(StatementIssueCodes.TabularDateInvalid, Assert.Single(parsed).Error);
    }

    [Fact]
    public void A_readable_total_footer_row_is_set_aside_and_carries_its_printed_totals()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;;100,000\n;TOTAL DES MOUVEMENTS;20,000;100,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        Assert.Equal(2, parsed.Count);
        var footer = parsed[1];
        Assert.True(footer.IsFooter);
        Assert.Equal(20.000m, footer.FooterTotalDebit);
        Assert.Equal(100.000m, footer.FooterTotalCredit);
    }

    // ── Validation du mappage ─────────────────────────────────────────────────────────────

    [Fact]
    public void Mapping_whose_columns_exceed_the_file_is_rejected()
    {
        var mapping = DebitCreditMapping() with { DateColumn = 99 };

        var error = BankStatementTabularReader.ValidateMapping(mapping, columnCount: 5);

        Assert.NotNull(error);
        Assert.Equal(BankStatementTabularErrorCodes.TabularMappingInvalid, error!.Code);
    }

    [Fact]
    public void Signed_amount_mode_without_an_amount_column_is_rejected()
    {
        var mapping = DebitCreditMapping() with { AmountMode = "signed", AmountColumn = null };

        var error = BankStatementTabularReader.ValidateMapping(mapping, columnCount: 5);

        Assert.NotNull(error);
    }

    [Fact]
    public void Valid_mapping_within_the_file_columns_passes()
    {
        var error = BankStatementTabularReader.ValidateMapping(DebitCreditMapping(), columnCount: 5);

        Assert.Null(error);
    }

    // ── Construction de l'extraction (BuildExtraction) ────────────────────────────────────

    [Fact]
    public void Build_extraction_fails_with_too_many_rows_when_the_table_was_truncated_while_loading()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;A;10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value with { Truncated = true };

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularTooManyRows, result.Error.Code);
    }

    [Fact]
    public void Build_extraction_fails_with_no_lines_when_every_row_is_a_footer()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n;TOTAL;10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularNoLines, result.Error.Code);
    }

    [Fact]
    public void Lines_listed_most_recent_first_are_reordered_and_flagged_as_an_info_issue()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n05/01/2026;B;10,000;\n02/01/2026;A;5,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        var extraction = result.Value;
        Assert.Equal("A", extraction.Lines[0].Label);
        Assert.Equal("B", extraction.Lines[1].Label);
        Assert.Contains(extraction.Issues, i => i.Code == StatementIssueCodes.TabularReversedOrder);
    }

    [Fact]
    public void Formula_cells_in_the_source_workbook_are_surfaced_as_an_info_issue()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;A;10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value with { HasFormulaCells = true };

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        Assert.Contains(result.Value.Issues, i => i.Code == StatementIssueCodes.TabularFormulaCells);
    }

    [Fact]
    public void A_running_balance_that_does_not_follow_the_printed_balance_is_a_warning_not_a_block()
    {
        // Solde imprimé incohérent avec le débit annoncé (devrait être 990,000, pas 500,000).
        var content = Csv("Date;Libelle;Debit;Credit;Solde\n01/01/2026;A;10,000;;500,000\n");
        var mapping = DebitCreditMapping() with { OpeningBalance = 1000.000m };
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, mapping, Limits, rib: null);

        Assert.True(result.IsSuccess);
        Assert.Contains(result.Value.Issues, i => i.Code == StatementIssueCodes.TabularRunningBalanceMismatch
            && i.Severity == StatementIssueSeverity.Warning);
    }

    [Fact]
    public void Readable_total_footer_feeds_header_totals_and_marks_them_as_labelled()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;A;;100,000\n;TOTAL DES MOUVEMENTS;0,000;100,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        var header = result.Value.Header;
        Assert.True(header.TotalsLabelled);
        Assert.Equal(100.000m, header.TotalCredits!.Value);
    }

    [Fact]
    public void Opening_balance_is_deduced_from_the_first_line_printed_balance_when_not_given()
    {
        var content = Csv("Date;Libelle;Debit;Credit;Solde\n01/01/2026;A;;100,000;1100,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        Assert.Equal(1000.000m, result.Value.Header.OpeningBalance!.Value);
    }
}
