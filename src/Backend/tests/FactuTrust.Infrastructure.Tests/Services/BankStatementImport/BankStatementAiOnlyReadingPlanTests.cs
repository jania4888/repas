using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Plan de lecture « 100 % IA » (décisions D1/D3, plan §3.1) : TOUTES les pages du relevé sont
/// confiées à l'IA, qu'un texte exploitable existe ou non ; le RIB différent ne bloque plus le plan ;
/// seuls les signalements qu'une relecture ne peut pas réparer vident le plan.
/// </summary>
public sealed class BankStatementAiOnlyReadingPlanTests
{
    private static ExtractedBankStatement Statement(
        int pageCount = 4,
        IReadOnlyList<int>? unresolved = null,
        IReadOnlyList<int>? sourcePages = null,
        params StatementExtractionIssue[] issues) => new()
    {
        Header = new ExtractedStatementHeader(),
        Lines = Array.Empty<ExtractedStatementLine>(),
        Issues = issues,
        ProfileId = "generic",
        PageCount = pageCount,
        UnresolvedPages = unresolved ?? Array.Empty<int>(),
        SourcePages = sourcePages
    };

    [Fact]
    public void SelectAiOnly_plans_every_page_scanned_and_text_alike()
    {
        var plan = BankStatementAiReadingPlanner.SelectAiOnly(Statement(pageCount: 4, unresolved: new[] { 3 }));

        Assert.Equal(BankStatementAiReadingModes.AiOnly, plan.Mode);
        Assert.True(plan.IsAiOnly);
        Assert.Equal(BankStatementAiReadingReasons.AllDocuments, plan.Reason);
        Assert.Equal(new[] { 1, 2, 3, 4 }, plan.PlannedPages);
        Assert.Equal(new[] { 3 }, plan.ScannedPages);
        Assert.Equal(new[] { 1, 2, 4 }, plan.TextPages);
    }

    [Fact]
    public void SelectAiOnly_uses_absolute_source_pages_for_a_segment()
    {
        // Segment d'un PDF multi-relevés : les pages absolues (4..6) sont planifiées, pas 1..PageCount.
        var plan = BankStatementAiReadingPlanner.SelectAiOnly(
            Statement(pageCount: 3, sourcePages: new[] { 6, 4, 5, 4 }));

        Assert.Equal(new[] { 4, 5, 6 }, plan.PlannedPages);
    }

    [Fact]
    public void SelectAiOnly_keeps_planning_on_a_rib_mismatch()
    {
        // D3 : un relevé d'un autre compte est quand même lu ; le signalement reste bloquant à la confirmation.
        var plan = BankStatementAiReadingPlanner.SelectAiOnly(Statement(issues:
            new StatementExtractionIssue(StatementIssueCodes.RibMismatch, StatementIssueSeverity.Blocking, "RIB différent")));

        Assert.False(plan.IsEmpty);
        Assert.Equal(new[] { 1, 2, 3, 4 }, plan.PlannedPages);
    }

    [Theory]
    [InlineData(StatementIssueCodes.TooManyPages)]
    [InlineData(StatementIssueCodes.Unreadable)]
    [InlineData(StatementIssueCodes.TooManyStatements)]
    [InlineData(StatementIssueCodes.PeriodsOverlap)]
    [InlineData(StatementIssueCodes.CurrencyNotSupported)]
    public void SelectAiOnly_returns_empty_on_a_blocking_killer(string code)
    {
        var plan = BankStatementAiReadingPlanner.SelectAiOnly(Statement(issues:
            new StatementExtractionIssue(code, StatementIssueSeverity.Blocking, "x")));

        Assert.True(plan.IsEmpty);
    }

    [Fact]
    public void SelectAiOnly_ignores_a_killer_code_at_warning_severity()
    {
        var plan = BankStatementAiReadingPlanner.SelectAiOnly(Statement(issues:
            new StatementExtractionIssue(StatementIssueCodes.PeriodsOverlap, StatementIssueSeverity.Warning, "x")));

        Assert.False(plan.IsEmpty);
    }

    [Fact]
    public void SelectAiOnly_returns_empty_without_pages()
    {
        Assert.True(BankStatementAiReadingPlanner.SelectAiOnly(Statement(pageCount: 0)).IsEmpty);
        // Une liste de pages source vide se comporte comme « inconnu » : pages 1..PageCount.
        Assert.Equal(new[] { 1, 2, 3 },
            BankStatementAiReadingPlanner.SelectAiOnly(Statement(pageCount: 3, sourcePages: Array.Empty<int>())).PlannedPages);
    }

    [Fact]
    public void FallbackPagesOf_lists_text_model_pages_in_order()
    {
        var readings = new[]
        {
            new BankStatementPageReading(1, BankStatementPageReadingEngines.GlmOcr, "glm", 1, 100, 12, null),
            new BankStatementPageReading(2, BankStatementPageReadingEngines.TextModel, "qwen", 1, 100, 9, "circuit_open"),
            new BankStatementPageReading(3, BankStatementPageReadingEngines.Failed, null, 2, 100, 0, "timeout"),
            new BankStatementPageReading(4, BankStatementPageReadingEngines.GlmOcrTable, "glm", 1, 100, 20, null)
        };

        Assert.Equal(new[] { 2 }, BankStatementAiReadingPlanner.FallbackPagesOf(readings));
        Assert.True(readings[1].IsTextFallback);
        Assert.True(readings[2].IsFailed);
        Assert.False(readings[0].IsTextFallback);
    }
}
