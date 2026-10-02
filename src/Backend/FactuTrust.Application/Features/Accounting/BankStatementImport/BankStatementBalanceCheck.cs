using System.Globalization;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Contrôle arithmétique d'un relevé extrait : solde initial + Σ crédits − Σ débits = solde final,
/// et Σ lignes = totaux imprimés. C'est la preuve de complétude de l'extraction : une ligne
/// manquante, inventée, mal lue ou mise du mauvais côté fait échouer le contrôle.
///
/// La tolérance n'est PAS un pourcentage : elle vient uniquement de l'arrondi des chiffres
/// imprimés avec moins de 3 décimales. Un relevé imprimé au millime est contrôlé à l'égalité
/// stricte ; un récapitulatif imprimé au centime (Attijari) tolère l'arrondi au centime.
/// </summary>
public static class BankStatementBalanceCheck
{
    public sealed record Outcome(
        decimal SumDebits,
        decimal SumCredits,
        decimal? ComputedClosing,
        decimal? Difference,
        decimal Tolerance,
        bool IsBalanced,
        IReadOnlyList<StatementExtractionIssue> Issues)
    {
        public bool HasBlockingIssue => Issues.Any(i => i.Severity == StatementIssueSeverity.Blocking);
    }

    public static Outcome Evaluate(ExtractedStatementHeader header, IReadOnlyList<ExtractedStatementLine> lines)
    {
        ArgumentNullException.ThrowIfNull(header);
        ArgumentNullException.ThrowIfNull(lines);

        var issues = new List<StatementExtractionIssue>();
        var sumDebits = lines.Where(l => l.IsDebit).Sum(l => l.Amount);
        var sumCredits = lines.Where(l => !l.IsDebit).Sum(l => l.Amount);

        if (header.OpeningBalance is null)
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.OpeningNotFound, StatementIssueSeverity.Blocking,
                "Solde initial introuvable : la complétude du relevé ne peut pas être vérifiée."));
        if (header.ClosingBalance is null)
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.ClosingNotFound, StatementIssueSeverity.Blocking,
                "Solde final introuvable : la complétude du relevé ne peut pas être vérifiée."));

        foreach (var (amount, label) in new[] { (header.OpeningBalance, "initial"), (header.ClosingBalance, "final") })
        {
            if (amount?.SignSource == StatementSignSource.Assumed)
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.AssumedBalanceSign, StatementIssueSeverity.Info,
                    $"Sens du solde {label} non imprimé : supposé créditeur."));
        }

        decimal? computed = null;
        decimal? difference = null;
        var tolerance = 0m;
        var balanced = false;

        if (header.OpeningBalance is not null && header.ClosingBalance is not null)
        {
            computed = header.OpeningBalance.Value + sumCredits - sumDebits;
            difference = computed.Value - header.ClosingBalance.Value;
            tolerance = RoundingTolerance(header.OpeningBalance.PrintedDecimals) + RoundingTolerance(header.ClosingBalance.PrintedDecimals);
            balanced = Math.Abs(difference.Value) <= tolerance;
            if (!balanced)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.BalanceMismatch, StatementIssueSeverity.Blocking,
                    string.Create(CultureInfo.InvariantCulture,
                        $"Contrôle de solde en échec : {Format(header.OpeningBalance.Value)} + {Format(sumCredits)} − {Format(sumDebits)} = {Format(computed.Value)}, le relevé indique {Format(header.ClosingBalance.Value)} (écart {Format(difference.Value)}).")));
            }
        }

        // Totaux : bloquants s'ils sont lus sous un libellé explicite, simple avertissement sinon
        // (lecture heuristique d'une ligne de totaux sans libellé).
        var totalsSeverity = header.TotalsLabelled ? StatementIssueSeverity.Blocking : StatementIssueSeverity.Warning;
        if (header.TotalDebits is not null &&
            Math.Abs(sumDebits - header.TotalDebits.Value) > RoundingTolerance(header.TotalDebits.PrintedDecimals))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.TotalDebitsMismatch, totalsSeverity,
                string.Create(CultureInfo.InvariantCulture,
                    $"Total des débits lus {Format(sumDebits)} ≠ total imprimé {Format(header.TotalDebits.Value)}.")));
        }

        // Convention BIAT : le total crédit imprimé intègre le solde d'ouverture (créditeur).
        var comparableCredits = header.CreditTotalIncludesOpening && header.OpeningBalance is { Value: > 0 } opening
            ? sumCredits + opening.Value
            : sumCredits;
        if (header.TotalCredits is not null &&
            Math.Abs(comparableCredits - header.TotalCredits.Value) > RoundingTolerance(header.TotalCredits.PrintedDecimals))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.TotalCreditsMismatch, totalsSeverity,
                string.Create(CultureInfo.InvariantCulture,
                    $"Total des crédits lus {Format(comparableCredits)} ≠ total imprimé {Format(header.TotalCredits.Value)}.")));
        }

        return new Outcome(sumDebits, sumCredits, computed, difference, tolerance, balanced, issues);
    }

    /// <summary>
    /// Recalcule les signalements arithmétiques d'un relevé (après fusion des pages lues par l'IA
    /// ou une correction manuelle) : les autres signalements sont conservés tels quels. Tant que
    /// des pages restent illisibles, le contrôle n'est pas évalué (il échouerait par construction).
    /// </summary>
    public static ExtractedBankStatement Reevaluate(ExtractedBankStatement statement)
    {
        var kept = statement.Issues.Where(i => !StatementIssueCodes.BalanceCodes.Contains(i.Code)).ToList();
        if (statement.UnresolvedPages.Count == 0 && statement.Lines.Count > 0)
            kept.AddRange(Evaluate(statement.Header, statement.Lines).Issues);
        return statement with { Issues = kept };
    }

    /// <summary>Le dinar se compte au millime : un chiffre imprimé avec 3 décimales est exact.</summary>
    public const int CurrencyDecimals = 3;

    /// <summary>
    /// Erreur d'arrondi d'un chiffre imprimé : nulle s'il l'est au millime, sinon une demi-unité du
    /// dernier chiffre imprimé (0,005 pour un récapitulatif au centime, comme chez Attijari).
    /// </summary>
    public static decimal RoundingTolerance(int printedDecimals)
    {
        if (printedDecimals >= CurrencyDecimals)
            return 0m;

        var unit = 1m;
        for (var i = 0; i < Math.Max(0, printedDecimals); i++)
            unit /= 10m;
        return unit / 2m;
    }

    private static string Format(decimal value) =>
        value.ToString("#,##0.000", CultureInfo.InvariantCulture).Replace(",", " ").Replace('.', ',');
}
