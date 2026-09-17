using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Évalue les rubriques paramétrées d'une déclaration mensuelle pour une période.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fonction pure.</b> Aucune dépendance sur EF, sur un dépôt ou sur le contexte du dossier :
/// tout ce dont elle a besoin est résolu en amont dans <see cref="RubricPeriodData"/>. C'est ce qui
/// rend chaque combinaison de types de calcul testable sans base de données.
/// </para>
/// <para>
/// <b>Aucun écrêtage.</b> Les montants rendus sont signés. L'écrêtage à zéro appartient à
/// l'enregistrement de la déclaration (<c>VatDeclaration.SetAdditionalTaxes</c>) et à l'édition du
/// formulaire (« un montant nul ne produit aucune valeur ») ; l'appliquer ici casserait ce que les
/// mouvements signés ont été introduits pour réparer — une période d'extourne.
/// </para>
/// </remarks>
public static class MonthlyDeclarationRubricEvaluator
{
    /// <summary>
    /// Évalue les rubriques fournies. L'appelant a déjà filtré sur l'activité, la fenêtre
    /// d'application et l'inclusion de la famille.
    /// </summary>
    public static IReadOnlyList<RubricEvaluation> Evaluate(
        IReadOnlyList<MonthlyDeclarationRubric> rubrics, RubricPeriodData data)
    {
        ArgumentNullException.ThrowIfNull(rubrics);
        ArgumentNullException.ThrowIfNull(data);

        return rubrics.Select(rubric => EvaluateOne(rubric, data)).ToList();
    }

    /// <summary>Évalue une rubrique isolée.</summary>
    public static RubricEvaluation EvaluateOne(MonthlyDeclarationRubric rubric, RubricPeriodData data)
    {
        ArgumentNullException.ThrowIfNull(rubric);
        ArgumentNullException.ThrowIfNull(data);

        var diagnostics = new List<RubricDiagnostic>();
        ReportUnknownAccounts(rubric, data, diagnostics);

        decimal gross;
        decimal withheld;

        // L'ordre est résolu statiquement, sans graphe : le seul enchaînement possible est « la
        // retenue d'abord » lorsque le brut en dérive. Le cycle inverse est refusé à l'écriture.
        if (rubric.GrossKind == RubricGrossKind.WithheldOverRate)
        {
            withheld = ComputeWithheld(rubric, data, gross: 0m, diagnostics);
            gross = rubric.RatePercent > 0m
                ? withheld / (rubric.RatePercent / 100m)
                : Report(diagnostics, RubricDiagnosticKind.RateRequired, rubric.Code, 0m);
        }
        else
        {
            gross = ComputeGross(rubric, data, diagnostics);
            withheld = ComputeWithheld(rubric, data, gross, diagnostics);
        }

        return new RubricEvaluation
        {
            RubricId = rubric.Id,
            Code = rubric.Code,
            Label = rubric.Label,
            Family = rubric.Family,
            ReportCode = rubric.ReportCode,
            // Arrondi une seule fois, en sortie de colonne : arrondir les intermédiaires ferait
            // dériver « brut × taux » d'un millime sur les grandes assiettes.
            Gross = MillimeRounding.Round(gross),
            Withheld = MillimeRounding.Round(withheld),
            RatePercentApplied = rubric.RatePercent,
            RequiresManualInput = RequiresManualInput(rubric),
            Diagnostics = diagnostics
        };
    }

    // ── Colonne « Montant brut » ──────────────────────────────────────────────

    private static decimal ComputeGross(
        MonthlyDeclarationRubric rubric, RubricPeriodData data, List<RubricDiagnostic> diagnostics)
        => rubric.GrossKind switch
        {
            RubricGrossKind.Fixed => rubric.FixedGrossAmount ?? 0m,
            RubricGrossKind.Payroll => PayrollValue(rubric.PayrollComponent, data, diagnostics),
            RubricGrossKind.Account => data.SumFor(Accounts(rubric, RubricAccountRole.Gross), rubric.GrossSide),
            // Traité en amont dans EvaluateOne : la retenue doit être calculée d'abord.
            _ => 0m
        };

    /// <summary>
    /// Projette l'apport du cycle de paie du mois sur la valeur désignée par la rubrique.
    /// </summary>
    /// <remarks>
    /// Un cycle non validé rend zéro et un signalement. Ce n'est pas une précaution de confort : le
    /// chemin de calcul historique refuse déjà un cycle en brouillon, et une rubrique paramétrée ne
    /// doit pas servir de porte dérobée pour faire entrer une paie non arrêtée dans une sortie
    /// légale.
    /// </remarks>
    private static decimal PayrollValue(
        PayrollContributionComponent? component, RubricPeriodData data, List<RubricDiagnostic> diagnostics)
    {
        if (!data.Payroll.IsUsable)
        {
            return Report(
                diagnostics, RubricDiagnosticKind.PayrollRunNotUsable,
                data.Payroll.Status?.ToString() ?? "aucun cycle", 0m);
        }

        return component switch
        {
            PayrollContributionComponent.SalariesGrossBase => data.Payroll.SalariesGrossBase,
            PayrollContributionComponent.SalariesNetTaxableBase => data.Payroll.SalariesNetTaxableBase,
            PayrollContributionComponent.PayrollTaxBase => data.Payroll.TaxBase,
            PayrollContributionComponent.WithholdingIrpp => data.Payroll.WithholdingIrpp,
            PayrollContributionComponent.WithholdingCss => data.Payroll.WithholdingCss,
            PayrollContributionComponent.WithholdingTotal => data.Payroll.WithholdingTotal,
            PayrollContributionComponent.Tfp => data.Payroll.Tfp,
            PayrollContributionComponent.Foprolos => data.Payroll.Foprolos,
            _ => 0m
        };
    }

    // ── Colonne « Retenue » ───────────────────────────────────────────────────

    private static decimal ComputeWithheld(
        MonthlyDeclarationRubric rubric,
        RubricPeriodData data,
        decimal gross,
        List<RubricDiagnostic> diagnostics)
        => rubric.WithheldKind switch
        {
            RubricWithheldKind.Fixed => rubric.FixedWithheldAmount ?? 0m,
            RubricWithheldKind.Payroll =>
                PayrollValue(rubric.WithheldPayrollComponent, data, diagnostics),
            RubricWithheldKind.Account =>
                data.SumFor(Accounts(rubric, RubricAccountRole.Withheld), rubric.WithheldSide),
            RubricWithheldKind.GrossTimesRate => rubric.RatePercent > 0m
                ? gross * rubric.RatePercent / 100m
                : Report(diagnostics, RubricDiagnosticKind.RateRequired, rubric.Code, 0m),

            // « Retenu/taux » sur l'axe retenue définirait la retenue à partir d'elle-même. Aucune
            // lecture fiscale ne s'en dégage sans ambiguïté, et en inventer une produirait un
            // montant faux d'apparence plausible — le pire des résultats sur une déclaration. La
            // valeur reste offerte à l'écran ; la ligne demeure saisissable, et le signalement dit
            // pourquoi. À activer après validation par un fiscaliste.
            _ => Report(diagnostics, RubricDiagnosticKind.UnsupportedCombination, rubric.Code, 0m)
        };

    // ── Aides ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Une rubrique « Fixe » sans constante enregistrée attend une saisie ; c'est le sens porté par
    /// l'absence de valeur, et il ne doit pas se confondre avec un montant nul.
    /// </summary>
    private static bool RequiresManualInput(MonthlyDeclarationRubric rubric) =>
        (rubric.GrossKind == RubricGrossKind.Fixed && rubric.FixedGrossAmount is null)
        || (rubric.WithheldKind == RubricWithheldKind.Fixed && rubric.FixedWithheldAmount is null);

    private static IEnumerable<(string AccountNumber, RubricAccountMatchMode MatchMode)> Accounts(
        MonthlyDeclarationRubric rubric, RubricAccountRole role) =>
        rubric.Accounts
            .Where(a => a.Role == role)
            .Select(a => (a.AccountNumber, a.MatchMode));

    /// <summary>
    /// Signale les comptes sélectionnés qui n'existent plus au plan. Ils contribuent zéro — mais en
    /// silence, ce zéro serait exactement le symptôme d'une renumérotation de plan mal propagée.
    /// </summary>
    private static void ReportUnknownAccounts(
        MonthlyDeclarationRubric rubric, RubricPeriodData data, List<RubricDiagnostic> diagnostics)
    {
        foreach (var account in rubric.Accounts)
        {
            // Une racine ne désigne pas un compte : elle est réputée connue dès qu'au moins un
            // compte du plan en descend.
            var known = account.MatchMode == RubricAccountMatchMode.Exact
                ? data.KnownAccounts.Contains(account.AccountNumber)
                : data.KnownAccounts.Any(k => k.StartsWith(account.AccountNumber, StringComparison.Ordinal));

            if (!known)
                diagnostics.Add(new RubricDiagnostic(RubricDiagnosticKind.UnknownAccount, account.AccountNumber));
        }
    }

    private static decimal Report(
        List<RubricDiagnostic> diagnostics, RubricDiagnosticKind kind, string? detail, decimal value)
    {
        diagnostics.Add(new RubricDiagnostic(kind, detail));
        return value;
    }
}
