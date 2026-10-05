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

    public static Outcome Evaluate(ExtractedStatementHeader header, IReadOnlyList<ExtractedStatementLine> lines) =>
        Evaluate(header, lines, aiOnly: false);

    /// <summary>
    /// Suffixe ajouté aux messages de solde rétrogradés en avertissement (D4).
    /// </summary>
    public const string AiOnlyAdvice = " Vérifiez les opérations avant de confirmer.";

    /// <param name="aiOnly">
    /// D4 : toutes les lignes viennent de l'IA (aucune lecture directe, aucune page en échec) et le drapeau
    /// <c>AiBalanceMismatchAsWarning</c> est actif. Les codes <c>OpeningNotFound</c>, <c>ClosingNotFound</c>,
    /// <c>BalanceMismatch</c>, <c>TotalDebitsMismatch</c>, <c>TotalCreditsMismatch</c> deviennent des
    /// avertissements à reconnaître explicitement à la confirmation ; <c>IsBalanced</c> et <c>Difference</c>
    /// sont calculés à l'identique. Faux = chemin historique, strictement inchangé.
    /// </param>
    public static Outcome Evaluate(ExtractedStatementHeader header, IReadOnlyList<ExtractedStatementLine> lines, bool aiOnly)
    {
        ArgumentNullException.ThrowIfNull(header);
        ArgumentNullException.ThrowIfNull(lines);

        var issues = new List<StatementExtractionIssue>();
        var sumDebits = lines.Where(l => l.IsDebit).Sum(l => l.Amount);
        var sumCredits = lines.Where(l => !l.IsDebit).Sum(l => l.Amount);
        var blocking = aiOnly ? StatementIssueSeverity.Warning : StatementIssueSeverity.Blocking;
        var advice = aiOnly ? AiOnlyAdvice : string.Empty;

        if (header.OpeningBalance is null)
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.OpeningNotFound, blocking,
                "Solde initial introuvable : la complétude du relevé ne peut pas être vérifiée." + advice));
        if (header.ClosingBalance is null)
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.ClosingNotFound, blocking,
                "Solde final introuvable : la complétude du relevé ne peut pas être vérifiée." + advice));

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
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.BalanceMismatch, blocking,
                    string.Create(CultureInfo.InvariantCulture,
                        $"Contrôle de solde en échec : {Format(header.OpeningBalance.Value)} + {Format(sumCredits)} − {Format(sumDebits)} = {Format(computed.Value)}, le relevé indique {Format(header.ClosingBalance.Value)} (écart {Format(difference.Value)}).") + advice));
            }
        }

        // Totaux : bloquants s'ils sont lus sous un libellé explicite, simple avertissement sinon
        // (lecture heuristique d'une ligne de totaux sans libellé).
        var totalsSeverity = header.TotalsLabelled ? blocking : StatementIssueSeverity.Warning;
        if (header.TotalDebits is not null &&
            Math.Abs(sumDebits - header.TotalDebits.Value) > RoundingTolerance(header.TotalDebits.PrintedDecimals))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.TotalDebitsMismatch, totalsSeverity,
                string.Create(CultureInfo.InvariantCulture,
                    $"Total des débits lus {Format(sumDebits)} ≠ total imprimé {Format(header.TotalDebits.Value)}.") + advice));
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
                    $"Total des crédits lus {Format(comparableCredits)} ≠ total imprimé {Format(header.TotalCredits.Value)}.") + advice));
        }

        return new Outcome(sumDebits, sumCredits, computed, difference, tolerance, balanced, issues);
    }

    /// <summary>
    /// D4 — le relevé est-il « tout IA » ? Vrai quand il a des lignes, qu'aucune ne vient de la lecture
    /// directe (<see cref="StatementLineSource.Layout"/>), qu'aucune page n'est restée illisible et
    /// qu'aucune page IA n'a échoué. Le chemin historique (lignes <c>Layout</c>) est exclu de lui-même.
    /// </summary>
    public static bool IsAiOnlyStatement(ExtractedBankStatement statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        return statement.Lines.Count > 0
            && statement.Lines.All(l => l.Source != StatementLineSource.Layout)
            && statement.UnresolvedPages.Count == 0
            && !statement.Issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed);
    }

    /// <summary>
    /// Un avertissement de solde (D4) subsiste-t-il ? Sert au serveur pour exiger l'accusé explicite
    /// (<c>RequiresBalanceAcknowledgement</c>) ; le front ne dérive rien.
    /// </summary>
    public static bool HasBalanceWarning(ExtractedBankStatement statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        return statement.Issues.Any(i =>
            i.Severity == StatementIssueSeverity.Warning
            && StatementIssueCodes.BalanceCodes.Contains(i.Code)
            && i.Code != StatementIssueCodes.AssumedBalanceSign);
    }

    /// <summary>
    /// Recalcule les signalements arithmétiques d'un relevé (après fusion des pages lues par l'IA
    /// ou une correction manuelle) : les autres signalements sont conservés tels quels. Tant que
    /// des pages restent illisibles, le contrôle n'est pas évalué (il échouerait par construction).
    /// </summary>
    public static ExtractedBankStatement Reevaluate(ExtractedBankStatement statement) =>
        Reevaluate(statement, aiBalanceMismatchAsWarning: false);

    /// <param name="aiBalanceMismatchAsWarning">
    /// Drapeau <c>AiBalanceMismatchAsWarning</c> effectif pour le dossier (D4). La rétrogradation ne
    /// s'applique que si, en plus, <see cref="IsAiOnlyStatement"/> est vrai.
    /// </param>
    public static ExtractedBankStatement Reevaluate(ExtractedBankStatement statement, bool aiBalanceMismatchAsWarning)
    {
        ArgumentNullException.ThrowIfNull(statement);
        var kept = statement.Issues.Where(i => !StatementIssueCodes.BalanceCodes.Contains(i.Code)).ToList();
        if (statement.UnresolvedPages.Count == 0 && statement.Lines.Count > 0)
        {
            var aiOnly = aiBalanceMismatchAsWarning && IsAiOnlyStatement(statement);
            kept.AddRange(Evaluate(statement.Header, statement.Lines, aiOnly).Issues);
        }
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
