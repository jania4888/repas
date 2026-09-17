using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Ligne d'une déclaration mensuelle déposée : ce que la rubrique a effectivement porté, figé au
/// moment du dépôt.
/// </summary>
/// <remarks>
/// <para>
/// <b>Le code, le libellé, la famille et le code rapport sont dénormalisés à dessein.</b> C'est la
/// doctrine « le dépôt fait foi » appliquée à la maille ligne : une rubrique renommée en mars, dont
/// le taux change en juin, ne doit pas modifier d'un caractère le document déposé en janvier.
/// Conserver seulement un identifiant de rubrique ferait dépendre l'édition d'une déclaration
/// passée de l'état présent de la configuration.
/// </para>
/// <para>
/// <see cref="RubricId"/> est une <b>référence sans contrainte</b>, pour la même raison : supprimer
/// une rubrique de la configuration ne doit pas emporter — ni bloquer — les déclarations qu'elle a
/// servi à produire.
/// </para>
/// <para>
/// Le couple <c>Computed*</c> vit à côté du couple déclaré : il reproduit à la maille ligne ce que
/// la section « suggéré » fait à la maille déclaration, de sorte qu'une correction manuelle reste
/// lisible comme un écart, et non comme une valeur venue de nulle part.
/// </para>
/// </remarks>
public sealed class VatDeclarationLine : Entity
{
    public const int MaxCodeLength = 20;
    public const int MaxLabelLength = 200;
    public const int MaxReportCodeLength = 16;

    public Guid VatDeclarationId { get; private set; }

    /// <summary>Rubrique d'origine, sans contrainte d'intégrité (elle peut avoir été supprimée).</summary>
    public Guid? RubricId { get; private set; }

    public string RubricCode { get; private set; } = null!;
    public string Label { get; private set; } = null!;
    public MonthlyDeclarationFamily Family { get; private set; }
    public string ReportCode { get; private set; } = null!;

    /// <summary>Montant brut déclaré.</summary>
    public decimal GrossAmount { get; private set; }

    /// <summary>Retenue déclarée.</summary>
    public decimal WithheldAmount { get; private set; }

    public decimal RatePercentApplied { get; private set; }

    /// <summary>Montant brut tel que le moteur l'avait calculé au moment du dépôt.</summary>
    public decimal ComputedGrossAmount { get; private set; }

    /// <summary>Retenue telle que le moteur l'avait calculée au moment du dépôt.</summary>
    public decimal ComputedWithheldAmount { get; private set; }

    public VatDeclarationLineOrigin Origin { get; private set; }

    public int DisplayOrder { get; private set; }

    private VatDeclarationLine() { }

    public static Result<VatDeclarationLine> Create(
        Guid? rubricId,
        string? rubricCode,
        string? label,
        MonthlyDeclarationFamily family,
        string? reportCode,
        decimal grossAmount,
        decimal withheldAmount,
        decimal ratePercentApplied,
        decimal computedGrossAmount,
        decimal computedWithheldAmount,
        VatDeclarationLineOrigin origin,
        int displayOrder)
    {
        var code = (rubricCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(code) || code.Length > MaxCodeLength)
        {
            return Result.Failure<VatDeclarationLine>(Error.Validation(
                "RubricCode", "Le code de rubrique de la ligne est obligatoire et limité à 20 caractères."));
        }

        var normalizedLabel = (label ?? string.Empty).Trim();
        if (normalizedLabel.Length > MaxLabelLength)
            normalizedLabel = normalizedLabel[..MaxLabelLength];

        var normalizedReportCode = (reportCode ?? string.Empty).Trim();
        if (normalizedReportCode.Length > MaxReportCodeLength)
            normalizedReportCode = normalizedReportCode[..MaxReportCodeLength];

        return Result.Success(new VatDeclarationLine
        {
            RubricId = rubricId,
            RubricCode = code,
            Label = normalizedLabel,
            Family = family,
            ReportCode = normalizedReportCode,
            // Aucun écrêtage : une ligne peut être négative sur une période d'extourne, exactement
            // comme les mouvements dont elle dérive. Le plancher à zéro n'existe qu'au niveau des
            // scalaires déposés.
            GrossAmount = grossAmount,
            WithheldAmount = withheldAmount,
            RatePercentApplied = ratePercentApplied,
            ComputedGrossAmount = computedGrossAmount,
            ComputedWithheldAmount = computedWithheldAmount,
            Origin = origin,
            DisplayOrder = displayOrder
        });
    }

    /// <summary>Rattache la ligne à sa déclaration (appelé par l'agrégat).</summary>
    internal void AttachTo(Guid declarationId) => VatDeclarationId = declarationId;

    /// <summary>Vrai si le montant déclaré s'écarte de ce que le moteur avait calculé.</summary>
    public bool DivergesFromComputed =>
        GrossAmount != ComputedGrossAmount || WithheldAmount != ComputedWithheldAmount;
}
