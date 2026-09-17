using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Garde-fou de cohérence entre le détail par rubrique et le total d'une famille.
/// </summary>
/// <remarks>
/// <para>
/// Reprend la règle de sûreté déjà appliquée à la ventilation de la retenue à la source : le total
/// de la famille fait foi, le détail n'est qu'informatif, et une ventilation qui dépasse ce total
/// est abandonnée plutôt que reportée — mieux vaut une déclaration moins détaillée qu'une
/// déclaration fausse.
/// </para>
/// <para>
/// La vérification est faite <b>par famille</b>, et non globalement. C'est exactement la correction
/// qu'a demandée la ventilation existante : un dépassement sur les factures ne doit pas emporter au
/// passage la retenue salariale, qui n'y est pour rien.
/// </para>
/// <para>
/// Les lignes écartées ne disparaissent pas de l'écran : elles sont marquées
/// <see cref="RubricDiagnosticKind.SuppressedFromForm"/>, pour que l'utilisateur voie à la fois le
/// détail qu'il a paramétré et la raison pour laquelle il n'est pas tamponné.
/// </para>
/// </remarks>
public static class MonthlyDeclarationLineGuard
{
    /// <summary>Tolérance d'arrondi au millime, identique à celle de la ventilation existante.</summary>
    public const decimal Epsilon = 0.001m;

    /// <summary>
    /// Marque les lignes d'une famille dont la somme des retenues excède le total déclaré pour
    /// cette famille.
    /// </summary>
    /// <param name="lines">Lignes évaluées, toutes familles confondues.</param>
    /// <param name="family">Famille contrôlée.</param>
    /// <param name="declaredFamilyTotal">Montant que la déclaration porte pour cette famille.</param>
    /// <returns>
    /// La même liste, les lignes de la famille en dépassement portant un signalement
    /// supplémentaire. Les autres familles ressortent inchangées, y compris par référence.
    /// </returns>
    public static IReadOnlyList<RubricEvaluation> EnsureWithinFamilyTotal(
        IReadOnlyList<RubricEvaluation> lines,
        MonthlyDeclarationFamily family,
        decimal declaredFamilyTotal)
    {
        ArgumentNullException.ThrowIfNull(lines);

        var ofFamily = lines.Where(l => l.Family == family).ToList();
        if (ofFamily.Count == 0)
            return lines;

        var ventilated = ofFamily.Sum(l => l.Withheld);
        if (ventilated <= declaredFamilyTotal + Epsilon)
            return lines;

        return lines
            .Select(line => line.Family == family ? Suppress(line, ventilated, declaredFamilyTotal) : line)
            .ToList();
    }

    /// <summary>Vrai si la ligne a été écartée du formulaire par le garde-fou.</summary>
    public static bool IsSuppressed(RubricEvaluation line) =>
        line.Diagnostics.Any(d => d.Kind == RubricDiagnosticKind.SuppressedFromForm);

    private static RubricEvaluation Suppress(
        RubricEvaluation line, decimal ventilated, decimal declaredFamilyTotal)
    {
        var detail =
            $"détail {ventilated:0.000} > total déclaré {declaredFamilyTotal:0.000} pour la famille "
            + $"{line.Family}";

        return line with
        {
            Diagnostics = line.Diagnostics
                .Append(new RubricDiagnostic(RubricDiagnosticKind.SuppressedFromForm, detail))
                .ToList()
        };
    }
}
