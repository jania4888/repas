using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Double lecture d'une même source : deux rubriques actives qui reprennent, en retenue, le même
/// montant de paie ou de documents sur des périodes communes.
/// </summary>
/// <param name="Code">Rubrique contrôlée.</param>
/// <param name="OtherCode">Rubrique qui lit déjà la même source.</param>
/// <param name="Source">Libellé de la source lue deux fois.</param>
public sealed record RubricSourceConflict(string Code, string OtherCode, string Source);

/// <summary>
/// Même assiette multipliée par un taux dans deux rubriques d'une même famille : le piège de la TFP
/// à 1 % et à 2 % sur la même masse salariale, qui fait 3 %.
/// </summary>
public sealed record RubricSharedBaseWarning(MonthlyDeclarationFamily Family, string Code, string OtherCode);

/// <summary>
/// Contrôle croisé des rubriques : une même source ne doit être lue qu'une fois.
/// </summary>
/// <remarks>
/// <para>
/// Le moteur additionne les retenues de toutes les rubriques. Deux rubriques qui reprennent l'IRPP du
/// cycle de paie, ou la retenue « honoraires » du rapport RS, le déclareraient deux fois — sans que
/// rien ne le signale, chaque ligne étant juste prise isolément.
/// </para>
/// <para>
/// La comparaison se fait par <b>atomes</b> : l'IRPP + CSS recouvre l'IRPP seul, la TFP du cycle
/// recouvre la TFP « industries manufacturières ». Les périodes se comparent au <b>mois</b>, la maille
/// de <see cref="MonthlyDeclarationRubric.IsApplicableTo"/> : une rubrique close le 15 juin et une
/// autre ouverte le 16 s'appliquent toutes deux à juin.
/// </para>
/// <para>
/// Fonction pure : la même règle sert à l'écriture (création, mise à jour, réactivation, import,
/// duplication) et à l'enregistrement de la déclaration.
/// </para>
/// </remarks>
public static class MonthlyDeclarationSourceOverlap
{
    /// <summary>
    /// Conflits entre <paramref name="candidate"/> et les autres rubriques actives. Une rubrique
    /// inactive ne produit rien, elle ne peut pas entrer en conflit.
    /// </summary>
    public static IReadOnlyList<RubricSourceConflict> ConflictsOf(
        MonthlyDeclarationRubric candidate, IEnumerable<MonthlyDeclarationRubric> others)
    {
        if (!candidate.IsActive)
            return Array.Empty<RubricSourceConflict>();

        var atoms = WithheldAtoms(candidate);
        if (atoms.Count == 0)
            return Array.Empty<RubricSourceConflict>();

        return others
            .Where(o => o.IsActive
                        && !ReferenceEquals(o, candidate)
                        && !string.Equals(o.Code, candidate.Code, StringComparison.Ordinal)
                        && WindowsOverlap(candidate, o))
            .SelectMany(o => WithheldAtoms(o)
                .Where(atoms.Contains)
                .Take(1)
                .Select(atom => new RubricSourceConflict(candidate.Code, o.Code, atom)))
            .ToList();
    }

    /// <summary>Tous les conflits d'un ensemble de rubriques, chaque paire une seule fois.</summary>
    public static IReadOnlyList<RubricSourceConflict> AllConflicts(IReadOnlyList<MonthlyDeclarationRubric> rubrics)
    {
        var conflicts = new List<RubricSourceConflict>();
        for (var i = 0; i < rubrics.Count; i++)
            conflicts.AddRange(ConflictsOf(rubrics[i], rubrics.Skip(i + 1)));
        return conflicts;
    }

    /// <summary>Refus à l'écriture, ou <c>null</c> si la rubrique ne lit aucune source déjà lue.</summary>
    public static Error? RefusalFor(MonthlyDeclarationRubric candidate, IEnumerable<MonthlyDeclarationRubric> others)
    {
        var conflict = ConflictsOf(candidate, others).FirstOrDefault();
        return conflict is null ? null : Refusal(conflict);
    }

    public static Error Refusal(RubricSourceConflict conflict) => Error.Validation(
        "WithheldSource",
        $"La rubrique {conflict.Code} reprendrait « {conflict.Source} », déjà reprise par la rubrique "
        + $"{conflict.OtherCode} sur une période commune : le montant serait déclaré deux fois. "
        + "Désactivez l'une des deux, ou fermez sa période d'application.");

    /// <summary>
    /// Avertissements : dans une famille, deux « brut × taux » sur la même assiette. Ce n'est pas
    /// toujours une erreur — mais c'est exactement la forme du piège TFP 1 % + 2 %.
    /// </summary>
    public static IReadOnlyList<RubricSharedBaseWarning> SharedBaseWarnings(IReadOnlyList<MonthlyDeclarationRubric> rubrics)
    {
        var rated = rubrics
            .Where(r => r.IsActive && r.WithheldKind == RubricWithheldKind.GrossTimesRate)
            .Select(r => (Rubric: r, Atoms: GrossAtoms(r)))
            .Where(x => x.Atoms.Count > 0)
            .ToList();

        var warnings = new List<RubricSharedBaseWarning>();
        for (var i = 0; i < rated.Count; i++)
        {
            for (var j = i + 1; j < rated.Count; j++)
            {
                var (a, aAtoms) = rated[i];
                var (b, bAtoms) = rated[j];
                if (a.Family == b.Family && WindowsOverlap(a, b) && aAtoms.Overlaps(bAtoms))
                    warnings.Add(new RubricSharedBaseWarning(a.Family, a.Code, b.Code));
            }
        }

        return warnings;
    }

    // ── Atomes ────────────────────────────────────────────────────────────────

    /// <summary>Montants de paie ou de documents que la colonne retenue reprend tels quels.</summary>
    private static HashSet<string> WithheldAtoms(MonthlyDeclarationRubric rubric) => rubric.WithheldKind switch
    {
        RubricWithheldKind.Payroll when rubric.WithheldPayrollComponent is { } c => PayrollAmountAtoms(c),
        RubricWithheldKind.Document when rubric.WithheldDocumentSource is { } s => [DocumentLabel(s)],
        _ => []
    };

    /// <summary>Assiette que la colonne brut reprend telle quelle.</summary>
    private static HashSet<string> GrossAtoms(MonthlyDeclarationRubric rubric) => rubric.GrossKind switch
    {
        RubricGrossKind.Payroll when rubric.PayrollComponent is { } c => PayrollBaseAtoms(c),
        RubricGrossKind.Document when rubric.GrossDocumentSource is { } s => [DocumentLabel(s)],
        RubricGrossKind.Account => rubric.AccountsFor(RubricAccountRole.Gross) is { Count: > 0 } accounts
            ? [$"comptes {string.Join(", ", accounts.Select(a => a.AccountNumber).Order(StringComparer.Ordinal))}"]
            : [],
        _ => []
    };

    private const string Irpp = "IRPP retenu par la paie";
    private const string Css = "CSS retenue par la paie";
    private const string TfpManufacturing = "TFP de la paie (industries manufacturières)";
    private const string TfpOther = "TFP de la paie (autres activités)";
    private const string Foprolos = "FOPROLOS de la paie";

    private static HashSet<string> PayrollAmountAtoms(PayrollContributionComponent component) => component switch
    {
        PayrollContributionComponent.WithholdingIrpp => [Irpp],
        PayrollContributionComponent.WithholdingCss => [Css],
        PayrollContributionComponent.WithholdingTotal => [Irpp, Css],
        PayrollContributionComponent.Tfp => [TfpManufacturing, TfpOther],
        PayrollContributionComponent.TfpManufacturing => [TfpManufacturing],
        PayrollContributionComponent.TfpOtherActivities => [TfpOther],
        PayrollContributionComponent.Foprolos => [Foprolos],
        // Une assiette lue en retenue n'est pas un montant d'impôt : rien à dédoublonner.
        _ => []
    };

    private const string TaxBaseManufacturing = "assiette des taxes sur salaires (industries manufacturières)";
    private const string TaxBaseOther = "assiette des taxes sur salaires (autres activités)";

    private static HashSet<string> PayrollBaseAtoms(PayrollContributionComponent component) => component switch
    {
        PayrollContributionComponent.PayrollTaxBase => [TaxBaseManufacturing, TaxBaseOther],
        PayrollContributionComponent.PayrollTaxBaseManufacturing => [TaxBaseManufacturing],
        PayrollContributionComponent.PayrollTaxBaseOtherActivities => [TaxBaseOther],
        PayrollContributionComponent.SalariesGrossBase => ["masse salariale brute"],
        PayrollContributionComponent.SalariesNetTaxableBase => ["net imposable"],
        _ => []
    };

    private static string DocumentLabel(DeclarationDocumentSource source) => DeclarationDocumentSources.Label(source);

    // ── Périodes ──────────────────────────────────────────────────────────────

    private static bool WindowsOverlap(MonthlyDeclarationRubric a, MonthlyDeclarationRubric b) =>
        FirstMonth(a) <= LastMonth(b) && FirstMonth(b) <= LastMonth(a);

    private static int FirstMonth(MonthlyDeclarationRubric r) =>
        r.EffectiveFrom is { } from ? from.Year * 12 + from.Month : int.MinValue;

    private static int LastMonth(MonthlyDeclarationRubric r) =>
        r.EffectiveTo is { } to ? to.Year * 12 + to.Month : int.MaxValue;
}
