using System.IO.Compression;
using System.Text;
using ClosedXML.Excel;
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

    private static BankStatementTabularMappingDto SignedMapping(int header = 0) => new()
    {
        HeaderRowIndex = header,
        DateFormat = "dd/MM/yyyy",
        DecimalSeparator = ",",
        AmountMode = "signed",
        DateColumn = 0,
        LabelColumns = new[] { 1 },
        AmountColumn = 2,
        BalanceColumn = 3
    };

    private static byte[] Csv(string content) => Encoding.UTF8.GetBytes(content);

    private static byte[] Xlsx(Action<IXLWorksheet> build)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("Relevé");
        build(sheet);
        using var ms = new MemoryStream();
        workbook.SaveAs(ms);
        return ms.ToArray();
    }

    // ── Chargement CSV : délimiteur / en-tête ──────────────────────────────────────────────

    [Fact]
    public void Semicolon_delimited_csv_is_detected_and_rows_are_split_accordingly()
    {
        var content = Csv("Date;Libelle;Debit;Credit;Solde\n01/01/2026;VIREMENT;;100,000;1100,000\n");

        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits);

        Assert.True(table.IsSuccess);
        Assert.Equal(";", table.Value.Delimiter);
        Assert.Equal(0, table.Value.HeaderRowIndex);
        Assert.Equal(2, table.Value.Rows.Count);
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

    // ── §1 : cellules de date XLSX / détection du format suggéré ──────────────────────────

    [Fact]
    public void A_real_xlsx_date_cell_is_read_regardless_of_the_mapping_date_format()
    {
        var content = Xlsx(sheet =>
        {
            sheet.Cell(1, 1).Value = "Date";
            sheet.Cell(1, 2).Value = "Libelle";
            sheet.Cell(1, 3).Value = "Debit";
            sheet.Cell(1, 4).Value = "Credit";
            sheet.Cell(2, 1).Value = new DateTime(2026, 3, 25); // 25/03/2026 — invalide en MM/dd/yyyy
            sheet.Cell(2, 2).Value = "VIREMENT";
            sheet.Cell(2, 3).Value = 10.000;
        });
        var table = BankStatementTabularReader.LoadRawTable(content, ".xlsx", Limits).Value;
        // Mappage délibérément incohérent avec le réglage habituel : la cellule réelle est une date
        // ISO sous le capot, indépendamment du dateFormat choisi par l'utilisateur.
        var mapping = DebitCreditMapping() with { DateFormat = "MM/dd/yyyy" };

        var parsed = BankStatementTabularReader.ParseLines(table, mapping);

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.Equal(new DateOnly(2026, 3, 25), line.TransactionDate);
    }

    [Theory]
    [InlineData("2026-03-25", "2026-03-26", "yyyy-MM-dd")]
    [InlineData("25.03.2026", "26.03.2026", "dd.MM.yyyy")]
    public void Suggested_date_format_is_the_one_reading_the_whole_sample(string first, string second, string expectedFormat)
    {
        var content = Csv($"Date;Libelle;Debit;Credit\n{first};A;10,000;\n{second};B;;5,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var suggested = BankStatementTabularReader.SuggestMapping(table);

        Assert.Equal(expectedFormat, suggested.DateFormat);
    }

    [Fact]
    public void Suggested_date_format_defaults_to_ddMMyyyy_when_the_sample_is_ambiguous()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n03/04/2026;A;10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var suggested = BankStatementTabularReader.SuggestMapping(table);

        Assert.Equal("dd/MM/yyyy", suggested.DateFormat);
    }

    // ── §2 : ordre inversé — paires du même jour autorisées ───────────────────────────────

    [Fact]
    public void Same_day_pairs_do_not_prevent_reversed_order_detection()
    {
        // 05/01 puis 05/01 (même jour) puis 02/01 : aucune paire n'avance, au moins une recule.
        var content = Csv("Date;Libelle;Debit;Credit\n05/01/2026;B1;10,000;\n05/01/2026;B2;5,000;\n02/01/2026;A;5,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        Assert.Equal("A", result.Value.Lines[0].Label);
        Assert.Contains(result.Value.Issues, i => i.Code == StatementIssueCodes.TabularReversedOrder);
    }

    [Fact]
    public void A_single_increasing_pair_prevents_reversed_order_detection_even_with_same_day_pairs()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n02/01/2026;A;10,000;\n02/01/2026;A2;5,000;\n05/01/2026;B;5,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);

        Assert.True(result.IsSuccess);
        Assert.Equal("A", result.Value.Lines[0].Label);
        Assert.DoesNotContain(result.Value.Issues, i => i.Code == StatementIssueCodes.TabularReversedOrder);
    }

    // ── §3 : montants selon decimalSeparator ──────────────────────────────────────────────

    [Theory]
    [InlineData(",", "1.190", 1190)] // mode virgule : le point est TOUJOURS un séparateur de milliers
    [InlineData(",", "17.837,479", 17837.479)]
    [InlineData(".", "1,190.500", 1190.500)] // mode point : la virgule est TOUJOURS un séparateur de milliers
    public void Amount_parsing_follows_the_decimal_separator_setting(string decimalSeparator, string amountText, decimal expected)
    {
        var content = Csv($"Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;{amountText};\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;
        var mapping = DebitCreditMapping() with { DecimalSeparator = decimalSeparator };

        var parsed = BankStatementTabularReader.ParseLines(table, mapping);

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.Equal(expected, line.Amount);
    }

    [Fact]
    public void An_amount_with_more_than_three_decimals_is_rounded_and_flagged_as_info()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;10,12345;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.True(line.AmountRounded);
        Assert.Equal(10.123m, line.Amount);

        var result = BankStatementTabularReader.BuildExtraction(table, DebitCreditMapping(), Limits, rib: null);
        Assert.True(result.IsSuccess);
        Assert.Contains(result.Value.Issues, i => i.Code == StatementIssueCodes.TabularAmountRounded
            && i.Severity == StatementIssueSeverity.Info);
    }

    [Fact]
    public void An_implausibly_large_operation_amount_is_a_blocking_anomaly()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;99999999999,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        Assert.NotNull(Assert.Single(parsed).Error);
    }

    // ── §3bis : signe en tête/parenthèses/fin — mode signé et débit négatif ──────────────

    [Theory]
    [InlineData("-125,500")] // signe en tête (export courant)
    [InlineData("125,500-")] // signe en fin
    [InlineData("(125,500)")] // parenthèses
    public void Signed_mode_negative_amount_is_parsed_as_a_plausible_debit_regardless_of_notation(string amountText)
    {
        var content = Csv($"Date;Libelle;Montant;Solde\n01/01/2026;VIREMENT;{amountText};\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, SignedMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.True(line.IsDebit);
        Assert.Equal(125.500m, line.Amount);
    }

    [Fact]
    public void Signed_mode_positive_amount_with_a_leading_plus_sign_is_parsed_as_a_credit()
    {
        var content = Csv("Date;Libelle;Montant;Solde\n01/01/2026;VIREMENT;+125,500;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, SignedMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.False(line.IsDebit);
        Assert.Equal(125.500m, line.Amount);
    }

    [Fact]
    public void Negative_amount_in_the_debit_column_of_a_debitCredit_mapping_is_still_a_plausible_debit()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;-10,000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.True(line.IsDebit);
        Assert.Equal(10.000m, line.Amount);
    }

    [Fact]
    public void CountDecimals_normalization_does_not_flag_trailing_zero_decimals_as_rounded()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;10,0000;\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        var parsed = BankStatementTabularReader.ParseLines(table, DebitCreditMapping());

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.False(line.AmountRounded);
        Assert.Equal(10m, line.Amount);
    }

    // ── §3ter : cellules numériques XLSX lues en invariant, quel que soit decimalSeparator ─

    [Fact]
    public void Xlsx_numeric_amount_cells_are_read_in_invariant_culture_even_when_the_mapping_uses_a_comma_decimal_separator()
    {
        var content = Xlsx(sheet =>
        {
            sheet.Cell("A1").Value = "Date";
            sheet.Cell("B1").Value = "Libelle";
            sheet.Cell("C1").Value = "Debit";
            sheet.Cell("D1").Value = "Credit";
            sheet.Cell("E1").Value = "Solde";
            sheet.Cell("A2").Value = "01/01/2026";
            sheet.Cell("B2").Value = "VIREMENT";
            sheet.Cell("C2").Value = 125.750; // vraie cellule numérique XLSX
            sheet.Cell("E2").Value = 1190.5;
        });
        var table = BankStatementTabularReader.LoadRawTable(content, ".xlsx", Limits).Value;
        var mapping = DebitCreditMapping() with { DecimalSeparator = "," };

        var parsed = BankStatementTabularReader.ParseLines(table, mapping);

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.True(line.IsDebit);
        Assert.Equal(125.75m, line.Amount);
        Assert.Equal(1190.5m, line.Balance);
    }

    [Fact]
    public void Xlsx_numeric_amount_cell_with_one_decimal_is_not_misread_as_a_thousands_separated_integer()
    {
        var content = Xlsx(sheet =>
        {
            sheet.Cell("A1").Value = "Date";
            sheet.Cell("B1").Value = "Libelle";
            sheet.Cell("C1").Value = "Debit";
            sheet.Cell("D1").Value = "Credit";
            sheet.Cell("A2").Value = "01/01/2026";
            sheet.Cell("B2").Value = "VIREMENT";
            sheet.Cell("C2").Value = 1.5;
        });
        var table = BankStatementTabularReader.LoadRawTable(content, ".xlsx", Limits).Value;
        var mapping = DebitCreditMapping() with { DecimalSeparator = "," };

        var parsed = BankStatementTabularReader.ParseLines(table, mapping);

        var line = Assert.Single(parsed);
        Assert.Null(line.Error);
        Assert.Equal(1.5m, line.Amount);
    }

    [Fact]
    public void SuggestMapping_suggests_the_dot_decimal_separator_when_xlsx_amount_columns_are_numeric_cell_dominant()
    {
        var content = Xlsx(sheet =>
        {
            sheet.Cell("A1").Value = "Date";
            sheet.Cell("B1").Value = "Libelle";
            sheet.Cell("C1").Value = "Debit";
            for (var row = 2; row <= 4; row++)
            {
                sheet.Cell($"A{row}").Value = $"0{row - 1}/01/2026";
                sheet.Cell($"B{row}").Value = "VIREMENT";
                sheet.Cell($"C{row}").Value = row * 10.5;
            }
        });
        var table = BankStatementTabularReader.LoadRawTable(content, ".xlsx", Limits).Value;

        var suggested = BankStatementTabularReader.SuggestMapping(table);

        Assert.Equal(2, suggested.DebitColumn);
        Assert.Equal(".", suggested.DecimalSeparator);
    }

    // ── §6 : sécurité XLSX (macros, exceptions) ───────────────────────────────────────────

    [Fact]
    public void A_macro_declared_via_content_types_is_rejected_even_with_an_xlsx_filename_inside()
    {
        using var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var contentTypes = archive.CreateEntry("[Content_Types].xml");
            using (var writer = new StreamWriter(contentTypes.Open()))
                writer.Write("<Types><Override PartName=\"/xl/vbaProject.bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/></Types>");

            var sheet = archive.CreateEntry("xl/worksheets/sheet1.xml");
            using (var writer = new StreamWriter(sheet.Open()))
                writer.Write("<worksheet/>");
        }

        var result = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", Limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularRejected, result.Error.Code);
    }

    [Fact]
    public void Zip_entries_are_bounded_by_actual_streamed_bytes_not_declared_metadata()
    {
        // L'entrée annonce une taille modeste dans ses métadonnées mais le contenu réellement
        // décompressé dépasse la limite — seul le flux réel doit être compté (§6).
        using var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("xl/worksheets/sheet1.xml", CompressionLevel.SmallestSize);
            using var writer = new StreamWriter(entry.Open());
            writer.Write(new string('A', 500_000));
        }

        var limits = new BankStatementImportLimits { XlsxMaxUncompressedBytes = 1_000, XlsxMaxCompressionRatio = 100_000 };
        var result = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularRejected, result.Error.Code);
    }

    [Fact]
    public void A_corrupted_but_zip_valid_xlsx_is_mapped_to_a_stable_unreadable_error()
    {
        using var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("xl/workbook.xml");
            using var writer = new StreamWriter(entry.Open());
            writer.Write("not even close to valid OOXML <<<>>>");
        }

        var result = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", Limits);

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementTabularErrorCodes.TabularUnreadable, result.Error.Code);
    }

    // ── §13 : convention 1-based de IgnoredRows ───────────────────────────────────────────

    [Fact]
    public void IgnoredRows_uses_the_same_one_based_convention_as_rowNumber()
    {
        var content = Csv("Date;Libelle;Debit;Credit\n01/01/2026;A;10,000;\n02/01/2026;B;5,000;\n03/01/2026;C;;5,000\n");
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;
        // En-tête = rowNumber 1, "A" = rowNumber 2, "B" = rowNumber 3, "C" = rowNumber 4 : IgnoredRows=[3]
        // doit ignorer "B", pas une 2e ligne 0-based interne (qui désignerait "C").
        var mapping = DebitCreditMapping() with { IgnoredRows = new[] { 3 } };

        var parsed = BankStatementTabularReader.ParseLines(table, mapping);

        Assert.Equal(2, parsed.Count);
        Assert.DoesNotContain(parsed, p => p.Label == "B");
        Assert.Contains(parsed, p => p.Label == "A");
        Assert.Contains(parsed, p => p.Label == "C");
    }

    // ── §14 : encodage forcé / BOM UTF-16 ──────────────────────────────────────────────────

    [Fact]
    public void A_windows_1252_file_without_bom_is_read_correctly_once_the_client_forces_the_encoding()
    {
        var text = "Date;Libelle;Debit;Credit\n01/01/2026;Dépôt éspèces;10,000;\n";
        // Les caractères utilisés ici occupent les mêmes points de code en Latin-1 et en Windows-1252
        // (0xA0-0xFF) : on évite ainsi de dépendre de CodePagesEncodingProvider côté test, seul le
        // lecteur (via encodingOverride) a besoin de l'enregistrer pour décoder réellement en 1252.
        var content = Encoding.Latin1.GetBytes(text);

        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits, encodingOverride: "windows-1252").Value;

        Assert.Equal("windows-1252", table.Encoding);
        Assert.Contains(table.Rows[1], c => c.Contains("Dépôt éspèces"));
    }

    [Fact]
    public void A_utf16_little_endian_bom_is_detected_automatically_without_an_override()
    {
        var text = "Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT;10,000;\n";
        var bom = new byte[] { 0xFF, 0xFE };
        var content = bom.Concat(Encoding.Unicode.GetBytes(text)).ToArray();

        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", Limits).Value;

        Assert.Equal("utf-16", table.Encoding);
        Assert.Equal(2, table.Rows.Count);
    }

    // ── §5 : SheetIndex forcé par le mappage client ───────────────────────────────────────

    [Fact]
    public void An_explicit_sheet_index_override_wins_over_auto_detection()
    {
        using var workbook = new XLWorkbook();
        var first = workbook.AddWorksheet("Résumé");
        first.Cell(1, 1).Value = "Rien ici";
        var second = workbook.AddWorksheet("Opérations");
        second.Cell(1, 1).Value = "Date";
        second.Cell(1, 2).Value = "Libelle";
        second.Cell(1, 3).Value = "Debit";
        second.Cell(1, 4).Value = "Credit";
        second.Cell(2, 1).Value = new DateTime(2026, 1, 1);
        second.Cell(2, 2).Value = "VIREMENT";
        second.Cell(2, 3).Value = 10.000;
        using var ms = new MemoryStream();
        workbook.SaveAs(ms);

        var table = BankStatementTabularReader.LoadRawTable(ms.ToArray(), ".xlsx", Limits, sheetIndexOverride: 1).Value;

        Assert.Equal(1, table.SheetIndex);
        Assert.Equal("Date", table.Rows[0][0]);
    }
}
