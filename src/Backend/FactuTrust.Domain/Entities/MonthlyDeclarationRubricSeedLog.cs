using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Trace des versions du catalogue standard de rubriques déjà amorcées sur ce dossier.
/// </summary>
/// <remarks>
/// <para>
/// Sans ce journal, l'amorçage ne pourrait pas distinguer deux situations qui se ressemblent en
/// base et n'ont rien à voir : « le dossier a supprimé la rubrique F9_3_1 » et « F9_3_1 n'existait
/// pas encore dans le catalogue ». Dans le premier cas, la réinsérer serait une régression subie à
/// chaque requête ; dans le second, c'est exactement ce qu'il faut faire.
/// </para>
/// <para>
/// Monter <c>catalogVersion</c> dans la ressource n'insère donc que les codes réellement nouveaux,
/// sans jamais ressusciter ce qu'un comptable a retiré.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationRubricSeedLog : Entity
{
    public const int MaxVersionLength = 32;

    public string CatalogVersion { get; private set; } = null!;

    public DateTime AppliedAt { get; private set; }

    private MonthlyDeclarationRubricSeedLog() { }

    public static Result<MonthlyDeclarationRubricSeedLog> Create(string? catalogVersion)
    {
        var version = (catalogVersion ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(version) || version.Length > MaxVersionLength)
        {
            return Result.Failure<MonthlyDeclarationRubricSeedLog>(Error.Validation(
                "CatalogVersion",
                $"La version du catalogue est obligatoire et limitée à {MaxVersionLength} caractères."));
        }

        return Result.Success(new MonthlyDeclarationRubricSeedLog
        {
            CatalogVersion = version,
            AppliedAt = DateTime.UtcNow
        });
    }
}
