using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;
using static FactuTrust.Application.Features.Accounting.BankStatementImport.BankStatementAiPageReader;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Fusion d'une page TEXTE relue par l'IA avec la lecture directe : les lignes exactes restent, l'IA
/// n'ajoute que des lignes dont le montant est imprimé et la date dans la période, le contrôle de solde
/// au millime reste l'arbitre. Aucune valeur n'est inventée.
/// </summary>
public sealed class BankStatementAiTextMergeTests
{
    private static readonly DateOnly Jan5 = new(2026, 1, 5);

    private static ExtractedStatementLine Line(int index, decimal amount, bool debit, string label, DateOnly? date = null,
        StatementLineSource source = StatementLineSource.Layout, int page = 1) => new()
    {
        Index = index,
        PageNumber = page,
        TransactionDate = date ?? Jan5,
        Label = label,
        LabelLines = new[] { label },
        Amount = amount,
        IsDebit = debit,
        Source = source
    };

    private static ExtractedStatementHeader Header(decimal? opening = 1_000m, decimal? closing = 1_160m) => new()
    {
        PeriodStart = new DateOnly(2026, 1, 1),
        PeriodEnd = new DateOnly(2026, 1, 31),
        PeriodPrinted = true,
        OpeningBalance = opening is { } o ? new StatementAmount(o, 3) : null,
        ClosingBalance = closing is { } c ? new StatementAmount(c, 3) : null
    };

    /// <summary>
    /// Relevé d'une page : +200 (lu), −40 (lu) et un montant de 50 resté orphelin (non lu directement).
    /// 1 000 + 200 − 40 − 50 ≠ 1 160 sans la ligne manquante : 1 000 + 200 − 40 = 1 160.
    /// </summary>
    private static ExtractedBankStatement LayoutWithOrphan(params StatementExtractionIssue[] extra) => new()
    {
        Header = Header(closing: 1_110m),
        Lines = new[] { Line(0, 200m, false, "VIREMENT RECU"), Line(1, 40m, true, "FRAIS") },
        Issues = new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking, "Montant isolé 50.000", 1),
            new StatementExtractionIssue(StatementIssueCodes.BalanceMismatch, StatementIssueSeverity.Blocking, "écart", null)
        }.Concat(extra).ToList(),
        ProfileId = "stb-historique",
        PageCount = 1
    };

    private static TextPageReading Text(IEnumerable<ExtractedStatementLine> aiLines, decimal[] printed, decimal[]? context = null,
        decimal? opening = null, decimal? closing = null, bool failed = false, params StatementExtractionIssue[] issues) =>
        new(new PageReading(aiLines.ToList(), opening, closing, issues.ToList()), printed, context ?? Array.Empty<decimal>(), failed);

    private static ExtractedBankStatement Merge(ExtractedBankStatement layout, TextPageReading page) =>
        BankStatementAiPageReader.Merge(layout, new Dictionary<int, PageReading>(), Array.Empty<int>(),
            new Dictionary<int, TextPageReading> { [1] = page });

    private static ExtractedStatementLine Ai(decimal amount, bool debit, string label, DateOnly? date = null) =>
        Line(0, amount, debit, label, date, StatementLineSource.Ai);

    [Fact]
    public void Ai_completes_the_missing_line_and_the_statement_balances()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(200m, false, "VIREMENT RECU (IA)"), Ai(50m, true, "PRELEVEMENT"), Ai(40m, true, "FRAIS (IA)") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        Assert.Collection(merged.Lines,
            l => { Assert.Equal(200m, l.Amount); Assert.Equal(StatementLineSource.Layout, l.Source); Assert.Equal("VIREMENT RECU", l.Label); },
            l => { Assert.Equal(50m, l.Amount); Assert.Equal(StatementLineSource.Ai, l.Source); },
            l => { Assert.Equal(40m, l.Amount); Assert.Equal(StatementLineSource.Layout, l.Source); Assert.Equal("FRAIS", l.Label); });
        Assert.Equal(new[] { 0, 1, 2 }, merged.Lines.Select(l => l.Index));
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.OrphanAmount);
    }

    [Fact]
    public void Line_missed_by_the_ai_is_kept_from_the_direct_reading()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(50m, true, "PRELEVEMENT") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.Equal(new[] { 200m, 40m, 50m }, merged.Lines.Select(l => l.Amount));
        Assert.False(merged.HasBlockingIssue);
    }

    [Fact]
    public void Ai_amount_not_printed_on_the_page_is_refused_and_blocks()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(55m, true, "PRELEVEMENT") },
            printed: new[] { 200m, 50m, 40m }));

        // Écartée (jamais ajoutée) avec un avertissement ; c'est le solde qui bloque, car la ligne manque.
        Assert.DoesNotContain(merged.Lines, l => l.Amount == 55m);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiAmountNotGrounded && i.Severity == StatementIssueSeverity.Warning);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Printed_amount_already_taken_by_a_direct_line_cannot_be_reused()
    {
        // L'IA propose un 2ᵉ « 40 » : un seul 40 est imprimé, déjà porté par la ligne lue directement.
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(40m, true, "FRAIS"), Ai(40m, true, "FRAIS BIS") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.Single(merged.Lines, l => l.Amount == 40m);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiAmountNotGrounded);
    }

    [Fact]
    public void Ai_rereading_a_line_already_read_does_not_block_a_balanced_statement()
    {
        // L'IA relit le 40 au crédit (mauvais sens) en plus de la ligne manquante : sa lecture du 40 est
        // écartée (montant déjà porté par la ligne exacte), le relevé équilibré reste enregistrable.
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(200m, false, "VIREMENT RECU"), Ai(50m, true, "PRELEVEMENT"), Ai(40m, false, "FRAIS LU AU CREDIT") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        Assert.Equal(new[] { 40m, 50m, 200m }, merged.Lines.Select(l => l.Amount).OrderBy(a => a));
        Assert.True(merged.Lines.Single(l => l.Amount == 40m).IsDebit);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiAmountNotGrounded && i.Severity == StatementIssueSeverity.Warning);
    }

    [Fact]
    public void A_repeated_amount_is_paired_with_the_operation_of_the_same_date()
    {
        // Blocage (07/01, débit), déblocage (14/01, crédit) et règlement (14/01, débit) du même chèque : la
        // lecture directe a manqué le blocage ; l'IA ne relit pas le règlement. Le blocage doit revenir au débit.
        var layout = new ExtractedBankStatement
        {
            Header = Header(opening: 5_000m, closing: 2_801m),
            Lines = new[]
            {
                Line(0, 2_199m, false, "DEBLOCAGE CHEQUE", new DateOnly(2026, 1, 14)),
                Line(1, 2_199m, true, "REGLEMENT CHEQUE", new DateOnly(2026, 1, 14))
            },
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.BalanceMismatch, StatementIssueSeverity.Blocking, "écart") },
            ProfileId = "biat-releve-mensuel",
            PageCount = 1
        };

        var merged = Merge(layout, Text(
            new[] { Ai(2_199m, true, "BLOCAGE CHEQUE", new DateOnly(2026, 1, 7)), Ai(2_199m, false, "DEBLOCAGE CHEQUE", new DateOnly(2026, 1, 14)) },
            printed: new[] { 2_199m, 2_199m, 2_199m }));

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        var restored = Assert.Single(merged.Lines, l => l.Source == StatementLineSource.Ai);
        Assert.True(restored.IsDebit);
        Assert.Equal(new DateOnly(2026, 1, 7), restored.TransactionDate);
    }

    [Fact]
    public void A_line_reread_with_a_misread_date_is_not_added_twice()
    {
        var layout = new ExtractedBankStatement
        {
            Header = Header(opening: 100m, closing: 80m),
            Lines = new[] { Line(0, 10m, true, "COMMISSION", new DateOnly(2026, 1, 5)) },
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking, "isolé", 1) },
            ProfileId = "stb-historique",
            PageCount = 1
        };

        var merged = Merge(layout, Text(
            new[] { Ai(10m, true, "COMMISSION", new DateOnly(2026, 1, 6)), Ai(10m, true, "COMMISSION", new DateOnly(2026, 1, 20)) },
            printed: new[] { 10m, 10m }));

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        Assert.Equal(new[] { new DateOnly(2026, 1, 5), new DateOnly(2026, 1, 20) }, merged.Lines.Select(l => l.TransactionDate).OrderBy(d => d));
        Assert.Equal(StatementLineSource.Ai, merged.Lines.Single(l => l.TransactionDate.Day == 20).Source);
    }

    [Fact]
    public void Text_extract_dates_may_be_copied_day_first_but_scanned_pages_stay_iso()
    {
        const string raw = """{"lines":[{"date":"14/07/2026","valueDate":"13/07/2026","label":"REGLEMENT","debit":2199}]}""";

        var text = BankStatementAiPageReader.Read(raw, 1, null, acceptDayFirstDates: true);
        var scanned = BankStatementAiPageReader.Read(raw, 1, null);

        var line = Assert.Single(text.Lines);
        Assert.Equal(new DateOnly(2026, 7, 14), line.TransactionDate);
        Assert.Equal(new DateOnly(2026, 7, 13), line.ValueDate);
        Assert.Empty(scanned.Lines);
        Assert.Contains(scanned.Issues, i => i.Code == StatementIssueCodes.LineInvalidDate);
    }

    [Fact]
    public void A_thousandfold_slip_of_the_ai_is_brought_back_to_the_printed_amount()
    {
        // « 50.000 » recopié 50000 par le modèle : seul 50,000 est imprimé, la ligne est ramenée à 50.
        var merged = Merge(LayoutWithOrphan(), Text(new[] { Ai(50_000m, true, "PRELEVEMENT") }, printed: new[] { 200m, 50m, 40m }));

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        Assert.Equal(50m, merged.Lines.Single(l => l.Source == StatementLineSource.Ai).Amount);
    }

    [Fact]
    public void A_non_integer_amount_is_never_rescaled()
    {
        var merged = Merge(LayoutWithOrphan(), Text(new[] { Ai(50_000.5m, true, "PRELEVEMENT") }, printed: new[] { 200m, 50m, 40m }));

        Assert.DoesNotContain(merged.Lines, l => l.Source == StatementLineSource.Ai);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void The_printed_column_decides_the_side_of_an_ai_line()
    {
        // Le 50 n'est imprimé qu'au débit : l'IA l'a mis au crédit, la ligne prend le sens de la colonne.
        var page = Text(new[] { Ai(50m, false, "PRELEVEMENT") }, printed: new[] { 200m, 50m, 40m }) with
        {
            OperationSides = new bool?[] { false, true, true }
        };

        var merged = Merge(LayoutWithOrphan(), page);

        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
        Assert.True(merged.Lines.Single(l => l.Source == StatementLineSource.Ai).IsDebit);
    }

    [Fact]
    public void An_amount_printed_on_both_sides_keeps_the_side_read_by_the_ai()
    {
        var layout = LayoutWithOrphan() with { Header = Header(closing: 1_210m) };
        var page = Text(new[] { Ai(50m, false, "REMBOURSEMENT") }, printed: new[] { 200m, 50m, 40m, 50m }) with
        {
            OperationSides = new bool?[] { false, true, true, false }
        };

        var merged = Merge(layout, page);

        Assert.False(merged.Lines.Single(l => l.Source == StatementLineSource.Ai).IsDebit);
    }

    [Fact]
    public void Ai_misreading_cannot_pass_the_balance_check()
    {
        // Montant imprimé, mais mauvais sens : la ligne entre, le solde ne boucle pas, le relevé reste bloqué.
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(50m, false, "PRELEVEMENT LU AU CREDIT") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Ai_date_outside_the_printed_period_is_refused()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(50m, true, "PRELEVEMENT", new DateOnly(2026, 5, 1)) },
            printed: new[] { 200m, 50m, 40m }));

        Assert.DoesNotContain(merged.Lines, l => l.Amount == 50m);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.LineInvalidDate && i.Severity == StatementIssueSeverity.Warning);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Ai_date_a_few_days_outside_the_period_is_tolerated()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(50m, true, "PRELEVEMENT", new DateOnly(2025, 12, 30)) },
            printed: new[] { 200m, 50m, 40m }));

        Assert.Contains(merged.Lines, l => l.Amount == 50m);
        Assert.False(merged.HasBlockingIssue);
    }

    [Fact]
    public void Page_with_ambiguous_sides_keeps_only_grounded_ai_lines()
    {
        var layout = LayoutWithOrphan(new StatementExtractionIssue(StatementIssueCodes.LineAmbiguousSide, StatementIssueSeverity.Blocking, "sens", 1)) with
        {
            // La lecture directe a lu le 40 au crédit (signe douteux) : elle n'est plus de confiance.
            Lines = new[] { Line(0, 200m, false, "VIREMENT RECU"), Line(1, 40m, false, "FRAIS") }
        };

        var merged = Merge(layout, Text(
            new[] { Ai(200m, false, "VIREMENT RECU"), Ai(40m, true, "FRAIS"), Ai(50m, true, "PRELEVEMENT") },
            printed: new[] { 200m, 50m, 40m }));

        Assert.All(merged.Lines, l => Assert.Equal(StatementLineSource.Ai, l.Source));
        Assert.True(merged.Lines.Single(l => l.Amount == 40m).IsDebit);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.LineAmbiguousSide);
        Assert.False(merged.HasBlockingIssue);
    }

    [Fact]
    public void Failed_page_keeps_the_direct_reading_and_its_issues()
    {
        var layout = LayoutWithOrphan();
        var merged = Merge(layout, Text(Array.Empty<ExtractedStatementLine>(), new[] { 200m, 50m, 40m }, failed: true,
            issues: new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking, "échec", 1)));

        Assert.Equal(layout.Lines.Select(l => l.Amount), merged.Lines.Select(l => l.Amount));
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.OrphanAmount);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiPageFailed && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void Line_level_issues_raised_by_the_ai_become_warnings()
    {
        var merged = Merge(LayoutWithOrphan(), Text(
            new[] { Ai(50m, true, "PRELEVEMENT") },
            printed: new[] { 200m, 50m, 40m },
            issues: new StatementExtractionIssue(StatementIssueCodes.LineInvalidDate, StatementIssueSeverity.Blocking, "date illisible", 1)));

        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.LineInvalidDate && i.Severity == StatementIssueSeverity.Warning);
        Assert.False(merged.HasBlockingIssue);
    }

    [Fact]
    public void Unknown_bank_is_read_entirely_by_the_ai_with_printed_balances()
    {
        var layout = new ExtractedBankStatement
        {
            Header = new ExtractedStatementHeader(),
            Lines = Array.Empty<ExtractedStatementLine>(),
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.NoTransactions, StatementIssueSeverity.Blocking, "aucune") },
            ProfileId = "generic",
            PageCount = 1
        };

        var merged = Merge(layout, Text(
            new[] { Ai(200m, false, "VIREMENT"), Ai(40m, true, "FRAIS") },
            printed: new[] { 200m, 40m, 1_160m },
            context: new[] { 1_000m },
            opening: 1_000m, closing: 1_160m));

        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.NoTransactions);
        Assert.Equal(1_000m, merged.Header.OpeningBalance!.Value);
        Assert.Equal(1_160m, merged.Header.ClosingBalance!.Value);
        Assert.False(merged.HasBlockingIssue, string.Join(" | ", merged.Issues.Select(i => i.Message)));
    }

    [Fact]
    public void Balance_proposed_by_the_ai_but_not_printed_is_ignored()
    {
        var layout = LayoutWithOrphan() with { Header = Header(closing: null) };

        var merged = Merge(layout, Text(new[] { Ai(50m, true, "PRELEVEMENT") }, printed: new[] { 200m, 50m, 40m }, closing: 9_999m));

        Assert.Null(merged.Header.ClosingBalance);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.ClosingNotFound);
    }

    [Fact]
    public void Direct_balances_are_never_overwritten_by_the_ai()
    {
        var merged = Merge(LayoutWithOrphan(), Text(new[] { Ai(50m, true, "PRELEVEMENT") },
            printed: new[] { 200m, 50m, 40m, 7_777m }, opening: 7_777m, closing: 7_777m));

        Assert.Equal(1_000m, merged.Header.OpeningBalance!.Value);
        Assert.Equal(1_110m, merged.Header.ClosingBalance!.Value);
    }

    [Fact]
    public void Without_text_pages_the_historical_merge_is_unchanged()
    {
        var layout = LayoutWithOrphan();
        var historical = BankStatementAiPageReader.Merge(layout, new Dictionary<int, PageReading>(), Array.Empty<int>());
        var withEmpty = BankStatementAiPageReader.Merge(layout, new Dictionary<int, PageReading>(), Array.Empty<int>(),
            new Dictionary<int, TextPageReading>());

        Assert.Equal(historical.Lines.Select(l => (l.Index, l.Amount)), withEmpty.Lines.Select(l => (l.Index, l.Amount)));
        Assert.Equal(historical.Issues.Select(i => i.Code), withEmpty.Issues.Select(i => i.Code));
    }

    [Fact]
    public void Chunks_of_a_page_are_combined_in_order()
    {
        var first = new PageReading(new[] { Ai(200m, false, "A") }, 1_000m, null, Array.Empty<StatementExtractionIssue>());
        var second = new PageReading(new[] { Ai(40m, true, "B") }, 999m, 1_160m, Array.Empty<StatementExtractionIssue>());
        var chunk0 = new BankStatementAiTextChunk(1, 0, "x", new[] { 200m }, new[] { 1_000m });
        var chunk1 = new BankStatementAiTextChunk(1, 1, "y", new[] { 40m, 1_160m }, new[] { 1_000m });

        var page = CombineChunks(new[] { (second, chunk1), (first, chunk0) });

        Assert.False(page.Failed);
        Assert.Equal(new[] { 200m, 40m }, page.Reading.Lines.Select(l => l.Amount));
        Assert.Equal(1_000m, page.Reading.OpeningBalance);
        Assert.Equal(1_160m, page.Reading.ClosingBalance);
        Assert.Equal(new[] { 200m, 40m, 1_160m }, page.OperationAmounts);
        Assert.Equal(new[] { 1_000m }, page.ContextAmounts);
    }

    [Fact]
    public void A_failed_chunk_fails_the_whole_page()
    {
        var ok = new PageReading(new[] { Ai(200m, false, "A") }, null, null, Array.Empty<StatementExtractionIssue>());
        var ko = new PageReading(Array.Empty<ExtractedStatementLine>(), null, null,
            new[] { new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking, "échec", 1) });

        var page = CombineChunks(new[]
        {
            (ok, new BankStatementAiTextChunk(1, 0, "x", new[] { 200m }, Array.Empty<decimal>())),
            (ko, new BankStatementAiTextChunk(1, 1, "y", new[] { 40m }, Array.Empty<decimal>()))
        });

        Assert.True(page.Failed);
    }
}
