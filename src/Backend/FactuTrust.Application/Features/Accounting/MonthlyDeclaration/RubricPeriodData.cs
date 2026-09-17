using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Nature d'un signalement émis pendant l'évaluation d'une rubrique.
/// </summary>
/// <remarks>
/// Un diagnostic n'interrompt jamais le calcul : il l'accompagne. Le principe est celui déjà retenu
/// pour la ventilation de la retenue à la source — mieux vaut une déclaration moins détaillée,
/// mais dont on sait pourquoi, qu'une déclaration fausse qui se tait.
/// </remarks>
public enum RubricDiagnosticKind
{
    /// <summary>Un compte sélectionné n'existe pas (ou plus) au plan comptable du dossier.</summary>
    UnknownAccount = 0,

    /// <summary>Un calcul dépendant du taux a rencontré un taux nul.</summary>
    RateRequired = 1,

    /// <summary>Le cycle de paie du mois n'est ni validé ni clôturé : ses montants sont ignorés.</summary>
    PayrollRunNotUsable = 2,

    /// <summary>Combinaison de types de calcul sans sémantique fiscale établie.</summary>
    UnsupportedCombination = 3,

    /// <summary>Le code rapport ne correspond à aucune case du millésime de formulaire en cours.</summary>
    UnmappedReportCode = 4,

    /// <summary>Ligne écartée du formulaire par le garde-fou de total de famille.</summary>
    SuppressedFromForm = 5,

    /// <summary>Famille incluse dans la déclaration sans aucune rubrique applicable à la période.</summary>
    MissingRubricForFamily = 6
}

/// <summary>Signalement attaché à une rubrique évaluée.</summary>
/// <param name="Kind">Nature du signalement.</param>
/// <param name="Detail">Précision affichable (numéro de compte fautif, code de famille…).</param>
public sealed record RubricDiagnostic(RubricDiagnosticKind Kind, string? Detail = null);

/// <summary>
/// Données de période <b>déjà résolues</b>, telles que le moteur les consomme.
/// </summary>
/// <remarks>
/// C'est l'abstraction qui garde le moteur pur : il ne connaît ni EF, ni dépôt, ni contexte tenant.
/// Tout ce qu'il lui faut — mouvements des comptes, apport de la paie, liste des comptes existants —
/// est résolu en amont, en une seule interrogation de la base.
/// </remarks>
public sealed record RubricPeriodData
{
    public required int Year { get; init; }

    public required int Month { get; init; }

    /// <summary>
    /// Mouvements par numéro de compte <b>réellement rencontré</b> sur la période. Un compte absent
    /// n'a simplement pas bougé ; c'est <see cref="KnownAccounts"/> qui dit s'il existe.
    /// </summary>
    public required IReadOnlyDictionary<string, AccountPeriodMovement> MovementsByAccount { get; init; }

    /// <summary>Apport du cycle de paie du mois, tel que le fournit le module paie.</summary>
    public required PayrollMonthlyContribution Payroll { get; init; }

    /// <summary>
    /// Numéros du plan comptable du dossier. Sert uniquement à distinguer « compte sans mouvement »
    /// de « compte inexistant » : le premier est normal, le second mérite un signalement.
    /// </summary>
    public required IReadOnlySet<string> KnownAccounts { get; init; }

    /// <summary>
    /// Cumul du sens demandé sur un ensemble de comptes, racines comprises.
    /// </summary>
    /// <remarks>
    /// Le recouvrement à l'intérieur d'une même colonne (une racine et l'un de ses sous-comptes)
    /// est refusé à l'écriture : la somme ne peut donc pas compter deux fois le même mouvement.
    /// </remarks>
    public decimal SumFor(
        IEnumerable<(string AccountNumber, RubricAccountMatchMode MatchMode)> accounts,
        AccountBalanceSide side)
    {
        var total = 0m;
        foreach (var (number, mode) in accounts)
        {
            if (mode == RubricAccountMatchMode.Exact)
            {
                if (MovementsByAccount.TryGetValue(number, out var movement))
                    total += movement.For(side);
                continue;
            }

            foreach (var (key, movement) in MovementsByAccount)
            {
                if (key.StartsWith(number, StringComparison.Ordinal))
                    total += movement.For(side);
            }
        }

        return total;
    }
}

/// <summary>Résultat de l'évaluation d'une rubrique pour une période.</summary>
public sealed record RubricEvaluation
{
    /// <summary>
    /// Rubrique d'origine. Reportée telle quelle sur la ligne déposée, à titre de référence : la
    /// ligne ne dépend jamais de la rubrique pour être lisible, elle en garde seulement la trace.
    /// </summary>
    public Guid RubricId { get; init; }

    public required string Code { get; init; }
    public required string Label { get; init; }
    public required MonthlyDeclarationFamily Family { get; init; }
    public required string ReportCode { get; init; }

    /// <summary>Colonne « Montant brut », arrondie au millime. Peut être négative.</summary>
    public required decimal Gross { get; init; }

    /// <summary>Colonne « Retenue », arrondie au millime. Peut être négative.</summary>
    public required decimal Withheld { get; init; }

    /// <summary>Taux effectivement appliqué, reporté tel quel sur l'état détaillé.</summary>
    public required decimal RatePercentApplied { get; init; }

    /// <summary>
    /// Vrai quand la rubrique attend une saisie : type « Fixe » sans constante enregistrée. La
    /// distinction porte le sens que <c>null</c> a sur la configuration — « à saisir », non « zéro ».
    /// </summary>
    public bool RequiresManualInput { get; init; }

    public IReadOnlyList<RubricDiagnostic> Diagnostics { get; init; } = Array.Empty<RubricDiagnostic>();
}
