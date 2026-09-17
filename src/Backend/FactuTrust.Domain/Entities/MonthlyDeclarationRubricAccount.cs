using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Accounting;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Un compte (ou une racine de comptes) sélectionné sur une colonne d'une rubrique de la
/// déclaration mensuelle — le contenu des listes « Comptes Brut » et « Comptes Retenu ».
/// </summary>
/// <remarks>
/// <para>
/// Une ligne par compte, et non une chaîne « 61;62 » à la manière de
/// <see cref="BudgetPost.AccountPrefixes"/>. Deux raisons, dans cet ordre d'importance :
/// </para>
/// <para>
/// 1. <b>Renumérotation du plan comptable.</b> <c>Nct01ChartMigrationService</c> réécrit les
/// colonnes portant un numéro de compte par une boucle générique ; une colonne agrégeant plusieurs
/// numéros dans une seule cellule en sort et exige un découpeur dédié — c'est exactement ce qu'a
/// coûté <c>BudgetPosts.AccountPrefixes</c>. Une colonne « un numéro par ligne » entre dans la
/// boucle générique avec une simple entrée d'allow-list.
/// </para>
/// <para>
/// 2. <b>Interrogation.</b> Le moteur demande les mouvements de l'union des comptes de toutes les
/// rubriques en une requête. Sur une colonne agrégée, cette union redevient un découpage de chaîne
/// sur le chemin du SQL.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationRubricAccount : Entity
{
    /// <summary>
    /// Largeur de stockage du numéro, alignée sur <c>JournalEntryLines.AccountNumber</c>. C'est une
    /// contrainte de stockage : la règle métier vit dans <see cref="AccountNumberRules"/>.
    /// </summary>
    public const int MaxAccountNumberLength = 32;

    public Guid RubricId { get; private set; }

    /// <summary>Colonne de la rubrique que ce compte alimente.</summary>
    public RubricAccountRole Role { get; private set; }

    /// <summary>Numéro tel que saisi, normalisé (sans espaces).</summary>
    public string AccountNumber { get; private set; } = null!;

    /// <summary>Le numéro seul, ou le numéro et toute sa descendance.</summary>
    public RubricAccountMatchMode MatchMode { get; private set; }

    private MonthlyDeclarationRubricAccount() { }

    /// <summary>
    /// Construit un compte de rubrique validé. Interne : un compte ne s'attache qu'au travers de
    /// <see cref="MonthlyDeclarationRubric.ReplaceAccounts"/>, seul garant des plafonds de
    /// cardinalité et de l'absence de doublon.
    /// </summary>
    internal static Result<MonthlyDeclarationRubricAccount> Create(
        RubricAccountRole role, string? accountNumber, RubricAccountMatchMode matchMode)
    {
        var normalized = (accountNumber ?? string.Empty).Trim();

        var validation = matchMode == RubricAccountMatchMode.Prefix
            // Le mode « racine » partage sciemment la règle des préfixes budgétaires : chiffres
            // seuls, 1 à 8. Un préfixe portant un point ne désignerait aucune branche du plan.
            ? ToPrefixResult(BudgetPost.ParsePrefixes(normalized))
            : AccountNumberRules.Validate(normalized);

        if (validation.IsFailure)
            return Result.Failure<MonthlyDeclarationRubricAccount>(validation.Error);

        if (normalized.Length > MaxAccountNumberLength)
        {
            return Result.Failure<MonthlyDeclarationRubricAccount>(Error.Validation(
                "AccountNumber",
                $"Le compte « {normalized} » dépasse {MaxAccountNumberLength} caractères."));
        }

        return Result.Success(new MonthlyDeclarationRubricAccount
        {
            Role = role,
            AccountNumber = normalized,
            MatchMode = matchMode
        });
    }

    /// <summary>Rattache le compte à sa rubrique (appelé par l'agrégat au moment de l'ajout).</summary>
    internal void AttachTo(Guid rubricId) => RubricId = rubricId;

    private static Result ToPrefixResult(Result<IReadOnlyList<string>> parsed) =>
        parsed.IsFailure ? Result.Failure(parsed.Error) : Result.Success();
}
