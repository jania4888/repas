using FactuTrust.Application.Features.Accounting.BankStatementImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Contrôle de solde (décision D4, plan §3.8) : quand TOUTES les pages ont été lues par l'IA
/// (<c>aiOnly</c>), un écart au millime devient un avertissement à accuser au lieu d'un blocage ;
/// sans lecture IA complète, le comportement bloquant historique est inchangé.
/// </summary>
public sealed class BankStatementBalanceCheckTests
{
    private static readonly DateOnly Jan5 = new(2026, 1, 5);

    private static ExtractedStatementLine Line(int index, decimal amount, bool debit,
        StatementLineSource source = StatementLineSource.Ai) => new()
    {
        Index = index,
        PageNumber = 1,
        TransactionDate = Jan5,
        Label = "L" + index,
        LabelLines = new[] { "L" + index },
        Amount = amount,
        IsDebit = debit,
        Source = source
    };

    private static ExtractedStatementHeader Header(decimal opening, decimal closing) => new()
    {
        PeriodStart = new DateOnly(2026, 1, 1),
        PeriodEnd = new DateOnly(2026, 1, 31),
        PeriodPrinted = true,
        OpeningBalance = new StatementAmount(opening, 3),
        ClosingBalance = new StatementAmount(closing, 3)
    };

    private static ExtractedBankStatement Statement(ExtractedStatementHeader header,
        IReadOnlyList<ExtractedStatementLine> lines, params StatementExtractionIssue[] issues) => new()
    {
        Header = header,
        Lines = lines,
        Issues = issues.ToList(),
        ProfileId = "generic",
        PageCount = 1
    };

    [Fact]
    public void Ai_only_evaluation_downgrades_a_millime_mismatch_to_a_warning_with_advice()
    {
        // 1 000 + 200 − 40 = 1 160 lu, mais le relevé imprime 1 160,001 : écart d'un millime.
        var header = Header(1_000m, 1_160.001m);
        var lines = new[] { Line(0, 200m, false), Line(1, 40m, true) };

        var blocking = BankStatementBalanceCheck.Evaluate(header, lines);
        var aiOnly = BankStatementBalanceCheck.Evaluate(header, lines, aiOnly: true);

        Assert.Contains(blocking.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch
            && i.Severity == StatementIssueSeverity.Warning
            && i.Message.Contains(BankStatementBalanceCheck.AiOnlyAdvice.Trim(), StringComparison.Ordinal));
        Assert.False(aiOnly.HasBlockingIssue);
    }

    [Fact]
    public void Ai_only_evaluation_downgrades_missing_balances()
    {
        var header = new ExtractedStatementHeader
        {
            PeriodStart = new DateOnly(2026, 1, 1),
            PeriodEnd = new DateOnly(2026, 1, 31),
            PeriodPrinted = true
        };
        var lines = new[] { Line(0, 200m, false) };

        var aiOnly = BankStatementBalanceCheck.Evaluate(header, lines, aiOnly: true);

        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.OpeningNotFound && i.Severity == StatementIssueSeverity.Warning);
        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.ClosingNotFound && i.Severity == StatementIssueSeverity.Warning);
        Assert.False(aiOnly.HasBlockingIssue);
    }

    [Fact]
    public void Labelled_totals_follow_the_ai_only_downgrade_and_stay_blocking_otherwise()
    {
        // Totaux imprimés sous un libellé explicite : bloquants sur le chemin historique,
        // avertissement à accuser quand toutes les pages ont été lues par l'IA (D4).
        var header = Header(1_000m, 1_160m) with
        {
            TotalDebits = new StatementAmount(41m, 3),
            TotalCredits = new StatementAmount(200m, 3),
            TotalsLabelled = true
        };
        var lines = new[] { Line(0, 200m, false), Line(1, 40m, true) };

        var legacy = BankStatementBalanceCheck.Evaluate(header, lines);
        var aiOnly = BankStatementBalanceCheck.Evaluate(header, lines, aiOnly: true);

        Assert.Contains(legacy.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Severity == StatementIssueSeverity.Warning);
        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Message.Contains(BankStatementBalanceCheck.AiOnlyAdvice.Trim(), StringComparison.Ordinal));
    }

    [Fact]
    public void Unlabelled_totals_are_only_a_warning_in_ai_only()
    {
        var header = Header(1_000m, 1_160m) with { TotalDebits = new StatementAmount(41m, 3), TotalCredits = new StatementAmount(200m, 3), TotalsLabelled = false };
        var lines = new[] { Line(0, 200m, false), Line(1, 40m, true) };

        var aiOnly = BankStatementBalanceCheck.Evaluate(header, lines, aiOnly: true);

        Assert.Contains(aiOnly.Issues, i => i.Code == StatementIssueCodes.TotalDebitsMismatch && i.Severity == StatementIssueSeverity.Warning);
    }

    [Fact]
    public void Reevaluate_applies_the_downgrade_only_with_the_flag_and_an_ai_only_statement()
    {
        var header = Header(1_000m, 1_161m);
        var aiLines = new[] { Line(0, 200m, false), Line(1, 40m, true) };
        var layoutLines = new[] { Line(0, 200m, false, StatementLineSource.Layout), Line(1, 40m, true, StatementLineSource.Layout) };

        var aiStatement = BankStatementBalanceCheck.Reevaluate(Statement(header, aiLines), aiBalanceMismatchAsWarning: true);
        var layoutStatement = BankStatementBalanceCheck.Reevaluate(Statement(header, layoutLines), aiBalanceMismatchAsWarning: true);
        var flagOff = BankStatementBalanceCheck.Reevaluate(Statement(header, aiLines), aiBalanceMismatchAsWarning: false);

        Assert.True(BankStatementBalanceCheck.HasBalanceWarning(aiStatement));
        Assert.False(BankStatementBalanceCheck.HasBalanceWarning(layoutStatement));
        Assert.Contains(layoutStatement.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Contains(flagOff.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void A_failed_page_keeps_the_balance_check_blocking_even_in_ai_only_mode()
    {
        var header = Header(1_000m, 1_161m);
        var statement = Statement(header, new[] { Line(0, 200m, false), Line(1, 40m, true) },
            new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking, "page 2", 2));

        var result = BankStatementBalanceCheck.Reevaluate(statement, aiBalanceMismatchAsWarning: true);

        Assert.False(BankStatementBalanceCheck.IsAiOnlyStatement(statement));
        Assert.Contains(result.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
    }

    [Fact]
    public void HasBalanceWarning_ignores_the_assumed_sign_informational_code()
    {
        var statement = Statement(Header(1_000m, 1_160m), new[] { Line(0, 200m, false), Line(1, 40m, true) },
            new StatementExtractionIssue(StatementIssueCodes.AssumedBalanceSign, StatementIssueSeverity.Warning, "signe supposé"));

        Assert.False(BankStatementBalanceCheck.HasBalanceWarning(statement));
    }
}
