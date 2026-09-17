using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Inclusion d'une famille d'impôts dans la déclaration mensuelle du dossier — la case
/// « Inclure cette famille dans déclaration mensuelle ? » de l'écran de configuration.
/// </summary>
/// <remarks>
/// Une ligne par famille plutôt qu'un drapeau sur chaque rubrique : la case doit survivre à la
/// suppression de toutes les rubriques de la famille, et basculer une famille doit rester une
/// écriture, pas N.
/// </remarks>
public sealed class MonthlyDeclarationFamilySetting : Entity
{
    public MonthlyDeclarationFamily Family { get; private set; }

    /// <summary>
    /// Faux par défaut. C'est la seconde moitié de la garantie de non-régression : même drapeau
    /// allumé, un dossier qui n'a jamais ouvert l'écran ne voit aucune famille prise en charge par
    /// le moteur paramétré.
    /// </summary>
    public bool IsIncluded { get; private set; }

    private MonthlyDeclarationFamilySetting() { }

    public static Result<MonthlyDeclarationFamilySetting> Create(
        MonthlyDeclarationFamily family, bool isIncluded = false)
    {
        if (!Enum.IsDefined(family))
            return Result.Failure<MonthlyDeclarationFamilySetting>(
                Error.Validation("Family", "Famille de déclaration inconnue."));

        return Result.Success(new MonthlyDeclarationFamilySetting
        {
            Family = family,
            IsIncluded = isIncluded
        });
    }

    public void SetIncluded(bool isIncluded) => IsIncluded = isIncluded;
}
