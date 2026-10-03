using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Plan de lecture IA (« tout document par l'IA ») : l'IA relit toute page non lue avec certitude,
/// jamais une lecture prouvée ; un avertissement ne la déclenche jamais ; un blocage qu'une relecture
/// ne peut pas lever (RIB d'un autre compte, devise…) ne la déclenche pas non plus.
/// </summary>
public sealed class BankStatementAiReadingPlanTests
{
    private static StatementExtractionIssue Blocking(string code, int? page = null) =>
        new(code, StatementIssueSeverity.Blocking, code, page);

    private static StatementExtractionIssue Warning(string code, int? page = null) =>
        new(code, StatementIssueSeverity.Warning, code, page);

    private static ExtractedBankStatement Statement(int pageCount, int[]? scanned = null, params StatementExtractionIssue[] issues) => new()
    {
        Header = new ExtractedStatementHeader(),
        Lines = Array.Empty<ExtractedStatementLine>(),
        Issues = issues,
        ProfileId = "generic",
        PageCount = pageCount,
        UnresolvedPages = scanned ?? Array.Empty<int>()
    };

    [Fact]
    public void Proven_reading_gives_an_empty_plan()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, null, Warning(StatementIssueCodes.RibNotFound)));

        Assert.True(plan.IsEmpty);
        Assert.Null(plan.Reason);
    }

    [Fact]
    public void Image_or_scanned_pages_are_read_as_before()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, new[] { 2, 3 },
            Blocking(StatementIssueCodes.NoTextLayer, 2), Blocking(StatementIssueCodes.NoTextLayer, 3)));

        Assert.Equal(new[] { 2, 3 }, plan.ScannedPages);
        Assert.Empty(plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Scanned, plan.Reason);
    }

    [Theory]
    [InlineData(StatementIssueCodes.OrphanAmount)]
    [InlineData(StatementIssueCodes.LineNoAmount)]
    [InlineData(StatementIssueCodes.LineSeveralAmounts)]
    [InlineData(StatementIssueCodes.LineInvalidDate)]
    [InlineData(StatementIssueCodes.LineAmbiguousSide)]
    public void Line_issue_sends_only_its_page(string code)
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(4, null, Blocking(code, 2), Blocking(code, 2)));

        Assert.Equal(new[] { 2 }, plan.TextPages);
        Assert.Empty(plan.ScannedPages);
        Assert.Equal(BankStatementAiReadingReasons.LineIssues, plan.Reason);
    }

    [Fact]
    public void Line_issues_on_a_scanned_page_do_not_add_text_pages()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, new[] { 2 },
            Blocking(StatementIssueCodes.NoTextLayer, 2), Blocking(StatementIssueCodes.OrphanAmount, 2)));

        Assert.Equal(new[] { 2 }, plan.ScannedPages);
        Assert.Empty(plan.TextPages);
    }

    [Theory]
    [InlineData(StatementIssueCodes.BalanceMismatch)]
    [InlineData(StatementIssueCodes.OpeningNotFound)]
    [InlineData(StatementIssueCodes.ClosingNotFound)]
    [InlineData(StatementIssueCodes.TotalDebitsMismatch)]
    [InlineData(StatementIssueCodes.TotalCreditsMismatch)]
    public void Unverified_statement_sends_every_text_page(string code)
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, null, Blocking(code), Blocking(StatementIssueCodes.OrphanAmount, 2)));

        Assert.Equal(new[] { 1, 2, 3 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Unverified, plan.Reason);
    }

    [Fact]
    public void Totals_mismatch_as_a_warning_does_not_trigger_the_ai()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(2, null,
            Warning(StatementIssueCodes.TotalDebitsMismatch), Warning(StatementIssueCodes.AiAmountNotGrounded, 1)));

        Assert.True(plan.IsEmpty);
    }

    [Fact]
    public void Ambiguous_columns_for_the_whole_document_send_every_text_page()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(2, null, Blocking(StatementIssueCodes.LineAmbiguousSide)));

        Assert.Equal(new[] { 1, 2 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Unverified, plan.Reason);
    }

    [Fact]
    public void Unknown_bank_without_any_operation_sends_every_text_page()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(2, null, Blocking(StatementIssueCodes.NoTransactions)));

        Assert.Equal(new[] { 1, 2 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Unverified, plan.Reason);
    }

    [Fact]
    public void No_operation_with_scanned_pages_also_reads_text_pages()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, new[] { 2, 3 },
            Blocking(StatementIssueCodes.NoTransactions), Blocking(StatementIssueCodes.NoTextLayer, 2), Blocking(StatementIssueCodes.NoTextLayer, 3)));

        Assert.Equal(new[] { 2, 3 }, plan.ScannedPages);
        Assert.Equal(new[] { 1 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Unverified, plan.Reason);
    }

    [Theory]
    [InlineData(StatementIssueCodes.RibMismatch)]
    [InlineData(StatementIssueCodes.CurrencyNotSupported)]
    [InlineData(StatementIssueCodes.TooManyPages)]
    [InlineData(StatementIssueCodes.TooManyStatements)]
    [InlineData(StatementIssueCodes.MultipleStatements)]
    [InlineData(StatementIssueCodes.PeriodsOverlap)]
    [InlineData(StatementIssueCodes.Unreadable)]
    public void Blocking_issue_that_a_reading_cannot_fix_never_calls_the_ai(string code)
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(2, new[] { 2 },
            Blocking(code), Blocking(StatementIssueCodes.NoTextLayer, 2), Blocking(StatementIssueCodes.BalanceMismatch)));

        Assert.True(plan.IsEmpty);
    }

    [Fact]
    public void Scanned_and_text_pages_are_combined_with_the_text_reason()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, new[] { 3 },
            Blocking(StatementIssueCodes.NoTextLayer, 3), Blocking(StatementIssueCodes.LineNoAmount, 1)));

        Assert.Equal(new[] { 3 }, plan.ScannedPages);
        Assert.Equal(new[] { 1 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.LineIssues, plan.Reason);
    }

    [Fact]
    public void Estimate_counts_one_call_per_scanned_page_plus_text_extracts()
    {
        var plan = BankStatementAiReadingPlanner.Select(Statement(3, new[] { 3 },
            Blocking(StatementIssueCodes.NoTextLayer, 3), Blocking(StatementIssueCodes.LineNoAmount, 1)));

        var estimated = BankStatementAiReadingPlanner.WithEstimate(plan, textCalls: 4, secondsPerCall: 120);

        Assert.Equal(5, estimated.EstimatedCalls);
        Assert.Equal(600, estimated.EstimatedSeconds);
    }
}
