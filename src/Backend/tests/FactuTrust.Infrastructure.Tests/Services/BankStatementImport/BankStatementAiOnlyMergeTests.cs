using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;
using static FactuTrust.Application.Features.Accounting.BankStatementImport.BankStatementAiPageReader;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Fusion « 100 % IA » (décision D1) : les lignes viennent uniquement des pages lues par l'IA ;
/// la couche texte ne fournit que les métadonnées ; aucune ligne IA n'est abandonnée (une ligne de
/// solde/total n'est écartée que si son montant égale un solde ou une somme de page ; un doublon de
/// report est signalé, jamais supprimé).
/// RIB de test à clé valide : voir <see cref="FactuTrust.Domain.Banking.TunisianIban.HasValidRibKey"/>.
/// </summary>
public sealed class BankStatementAiOnlyMergeTests
{
    private const string RibVision = "12345678901234567887";   // clé valide, banque 12
    private const string RibLayout = "10987654321098765430";   // clé valide, banque 10

    private static readonly DateOnly Jan5 = new(2026, 1, 5);

    private static ExtractedStatementLine Line(int index, decimal amount, bool debit, string label, int page = 1,
        DateOnly? date = null) => new()
    {
        Index = index,
        PageNumber = page,
        TransactionDate = date ?? Jan5,
        Label = label,
        LabelLines = new[] { label },
        Amount = amount,
        IsDebit = debit,
        Source = StatementLineSource.Ai
    };

    private static ExtractedBankStatement Layout(string? rib = null, int pageCount = 2,
        params StatementExtractionIssue[] issues) => new()
    {
        Header = new ExtractedStatementHeader
        {
            Rib = rib,
            PeriodStart = new DateOnly(2026, 1, 1),
            PeriodEnd = new DateOnly(2026, 1, 31),
            PeriodPrinted = true
        },
        Lines = Array.Empty<ExtractedStatementLine>(),
        Issues = issues.ToList(),
        ProfileId = "generic",
        PageCount = pageCount,
        UnresolvedPages = new[] { 1, 2 }
    };

    private static PageReading Reading(params ExtractedStatementLine[] lines) =>
        new(lines.ToList(), null, null, new List<StatementExtractionIssue>());

    private static BankStatementPageReading Trace(int page, string engine, int lineCount, string? failure = null) =>
        new(page, engine, "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0", 1, 1200, lineCount, failure);

    [Fact]
    public void Lines_come_only_from_the_ai_reindexed_and_marked_ai()
    {
        var layout = Layout(issues: new StatementExtractionIssue(StatementIssueCodes.NoTransactions, StatementIssueSeverity.Blocking, "rien"));
        var readings = new Dictionary<int, PageReading>
        {
            [1] = Reading(Line(0, 100m, false, "VIREMENT RECU", page: 1)),
            [2] = Reading(Line(0, 40m, true, "FRAIS", page: 2), Line(1, 60m, true, "CHEQUE", page: 2))
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 2) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(3, merged.Lines.Count);
        Assert.All(merged.Lines, l => Assert.Equal(StatementLineSource.Ai, l.Source));
        Assert.Equal(new[] { 0, 1, 2 }, merged.Lines.Select(l => l.Index).ToArray());
        Assert.Equal(new[] { 1, 2, 2 }, merged.Lines.Select(l => l.PageNumber).ToArray());
        Assert.Empty(merged.UnresolvedPages);
        // Le blocage « aucune opération » de la couche texte ne survit pas à une lecture IA qui trouve des lignes.
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.NoTransactions);
    }

    [Fact]
    public void A_failed_page_stays_unresolved_and_blocking()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading> { [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)) };
        var traces = new[]
        {
            Trace(1, BankStatementPageReadingEngines.GlmOcr, 1),
            Trace(2, BankStatementPageReadingEngines.Failed, 0, "ai_timeout")
        };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(new[] { 2 }, merged.UnresolvedPages);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiPageFailed && i.Severity == StatementIssueSeverity.Blocking && i.PageNumber == 2);
        Assert.True(merged.HasBlockingIssue);
    }

    [Fact]
    public void A_text_fallback_page_is_flagged_per_page()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading>
        {
            [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)),
            [2] = Reading(Line(0, 20m, false, "VIREMENT", page: 2))
        };
        var traces = new[]
        {
            Trace(1, BankStatementPageReadingEngines.GlmOcr, 1),
            Trace(2, BankStatementPageReadingEngines.TextModel, 1, "circuit_open")
        };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiTextFallback && i.Severity == StatementIssueSeverity.Warning && i.PageNumber == 2);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.AiTextFallback && i.PageNumber == 1);
    }

    [Fact]
    public void A_confirmed_empty_page_is_a_warning_not_a_blocker()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading>
        {
            [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)),
            [2] = Reading() // page sans opération (page de garde), confirmée vide
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcrTable, 0) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiPageEmpty && i.Severity == StatementIssueSeverity.Warning && i.PageNumber == 2);
        Assert.False(merged.Issues.Any(i => i.Severity == StatementIssueSeverity.Blocking));
    }

    [Fact]
    public void Vision_rib_fills_a_missing_layout_rib_and_sets_the_bank_code()
    {
        var layout = Layout(rib: null,
            issues: new StatementExtractionIssue(StatementIssueCodes.RibNotFound, StatementIssueSeverity.Warning, "RIB introuvable"));
        var readings = new Dictionary<int, PageReading>
        {
            [1] = new PageReading(new[] { Line(0, 10m, true, "FRAIS", page: 1) }, null, null, new List<StatementExtractionIssue>(), Rib: RibVision),
            [2] = Reading(Line(0, 5m, true, "COMMISSION", page: 2))
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(RibVision, merged.Header.Rib);
        Assert.Equal("12", merged.Header.BankCode);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.RibNotFound);
    }

    [Fact]
    public void The_text_layer_rib_wins_on_conflict_with_a_warning()
    {
        var layout = Layout(rib: RibLayout,
            issues: new StatementExtractionIssue(StatementIssueCodes.RibMismatch, StatementIssueSeverity.Blocking, "RIB différent"));
        var readings = new Dictionary<int, PageReading>
        {
            [1] = new PageReading(new[] { Line(0, 10m, true, "FRAIS", page: 1) }, null, null, new List<StatementExtractionIssue>(), Rib: RibVision),
            [2] = Reading(Line(0, 5m, true, "COMMISSION", page: 2))
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(RibLayout, merged.Header.Rib);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiRibMismatch && i.Severity == StatementIssueSeverity.Warning);
        // Le blocage « RIB différent » de la lecture texte est retiré : le contrôle par compte a lieu plus tard.
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.RibMismatch);
    }

    [Fact]
    public void A_missing_rib_everywhere_adds_a_warning_not_a_blocker()
    {
        var layout = Layout(rib: null);
        var readings = new Dictionary<int, PageReading> { [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)), [2] = Reading(Line(0, 5m, true, "X", page: 2)) };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Null(merged.Header.Rib);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.RibNotFound && i.Severity == StatementIssueSeverity.Warning);
    }

    [Fact]
    public void A_summary_line_is_dropped_only_when_its_amount_matches_a_page_balance()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading>
        {
            [1] = new PageReading(
                new[]
                {
                    Line(0, 1_000m, true, "SOLDE AU 01/01", page: 1), // = solde d'ouverture → écartée
                    Line(1, 200m, false, "VIREMENT RECU", page: 1),
                    Line(2, 999m, true, "TOTAL GENERAL", page: 1)     // montant non prouvé → conservée
                },
                OpeningBalance: 1_000m, ClosingBalance: 1_160m, Issues: new List<StatementExtractionIssue>()),
            [2] = Reading(Line(0, 40m, true, "FRAIS", page: 2))
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 3), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(3, merged.Lines.Count);
        Assert.DoesNotContain(merged.Lines, l => l.Label.StartsWith("SOLDE", StringComparison.Ordinal));
        Assert.Contains(merged.Lines, l => l.Label.StartsWith("TOTAL", StringComparison.Ordinal));
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiSummaryLineDropped && i.Severity == StatementIssueSeverity.Info);
    }

    [Fact]
    public void A_carried_over_duplicate_is_flagged_but_kept()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading>
        {
            [1] = Reading(Line(0, 100m, true, "CHEQUE 123", page: 1)),
            [2] = Reading(Line(0, 100m, true, "CHEQUE 123", page: 2)) // même opération répétée en haut de page 2
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(2, merged.Lines.Count);
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.AiPossibleDuplicate && i.Severity == StatementIssueSeverity.Warning);
    }

    [Fact]
    public void Balances_come_from_the_first_and_last_page_readings_without_printed_flag()
    {
        var layout = Layout();
        var readings = new Dictionary<int, PageReading>
        {
            [1] = new PageReading(new[] { Line(0, 100m, false, "VIR", page: 1) }, OpeningBalance: 1_000m, ClosingBalance: null,
                Issues: new List<StatementExtractionIssue>(), PrintedDecimals: 3, OpeningBalanceSigned: true),
            [2] = new PageReading(new[] { Line(0, 60m, true, "CHQ", page: 2) }, OpeningBalance: null, ClosingBalance: 1_040m,
                Issues: new List<StatementExtractionIssue>(), PrintedDecimals: 3)
        };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(1_000m, merged.Header.OpeningBalance?.Value);
        Assert.Equal(1_040m, merged.Header.ClosingBalance?.Value);
        Assert.Equal(3, merged.Header.OpeningBalance?.PrintedDecimals);
        Assert.Equal(StatementSignSource.Keyword, merged.Header.OpeningBalance?.SignSource);
        Assert.Equal(StatementSignSource.Assumed, merged.Header.ClosingBalance?.SignSource);
    }

    [Fact]
    public void Layout_issues_that_no_longer_describe_the_reading_are_dropped()
    {
        var layout = Layout(issues: new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.NoTransactions, StatementIssueSeverity.Blocking, "x"),
            new StatementExtractionIssue(StatementIssueCodes.LineAmbiguousSide, StatementIssueSeverity.Blocking, "colonnes", null),
            new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking, "montant", 1),
            new StatementExtractionIssue(StatementIssueCodes.BalanceMismatch, StatementIssueSeverity.Blocking, "écart", null),
            new StatementExtractionIssue(StatementIssueCodes.AiNotStarted, StatementIssueSeverity.Blocking, "ia", null),
            new StatementExtractionIssue(StatementIssueCodes.CurrencyNotFound, StatementIssueSeverity.Warning, "devise", null)
        });
        var readings = new Dictionary<int, PageReading> { [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)), [2] = Reading(Line(0, 5m, true, "X", page: 2)) };
        var traces = new[] { Trace(1, BankStatementPageReadingEngines.GlmOcr, 1), Trace(2, BankStatementPageReadingEngines.GlmOcr, 1) };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.LineAmbiguousSide);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.OrphanAmount);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch);
        Assert.DoesNotContain(merged.Issues, i => i.Code == StatementIssueCodes.AiNotStarted);
        // Les signalements de métadonnées restent.
        Assert.Contains(merged.Issues, i => i.Code == StatementIssueCodes.CurrencyNotFound);
    }

    [Fact]
    public void Page_readings_and_fallback_pages_are_carried_to_the_plan()
    {
        var layout = Layout();
        layout = layout with { AiPlan = new BankStatementAiPlan { Mode = BankStatementAiReadingModes.AiOnly, TextPages = new[] { 1, 2 } } };
        var readings = new Dictionary<int, PageReading> { [1] = Reading(Line(0, 10m, true, "FRAIS", page: 1)), [2] = Reading(Line(0, 5m, true, "X", page: 2)) };
        var traces = new[]
        {
            Trace(1, BankStatementPageReadingEngines.GlmOcr, 1),
            Trace(2, BankStatementPageReadingEngines.TextModel, 1, "vision_unavailable")
        };

        var merged = BankStatementAiOnlyMerge.Merge(layout, new[] { 1, 2 }, readings, traces);

        Assert.Equal(2, merged.AiPlan?.PageReadings.Count);
        Assert.Equal(new[] { 2 }, merged.AiPlan?.FallbackPages);
    }
}
