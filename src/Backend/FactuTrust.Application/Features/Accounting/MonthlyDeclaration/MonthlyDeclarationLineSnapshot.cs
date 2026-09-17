using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Fige le détail calculé d'une période en lignes de déclaration déposées, et le relit dans l'autre
/// sens pour l'affichage.
/// </summary>
/// <remarks>
/// Fonction pure des deux côtés : c'est la frontière entre « ce que les modules produisent
/// aujourd'hui » et « ce que le document porte », et elle doit rester vérifiable sans base.
/// </remarks>
public static class MonthlyDeclarationLineSnapshot
{
    /// <summary>
    /// Construit les lignes à déposer à partir du détail calculé.
    /// </summary>
    /// <remarks>
    /// Le montant déclaré est, à ce stade, celui du calcul : l'écran de saisie ligne à ligne
    /// viendra plus tard. Le couple <c>Computed*</c> est renseigné à l'identique, de sorte qu'une
    /// correction manuelle ultérieure se lise comme un écart par rapport à une valeur connue, et
    /// non par rapport à zéro.
    /// </remarks>
    public static IReadOnlyList<VatDeclarationLine> Freeze(IReadOnlyList<MonthlyDeclarationLineDto>? lines)
    {
        var frozen = new List<VatDeclarationLine>();
        if (lines is null || lines.Count == 0)
            return frozen;

        var order = 0;
        foreach (var line in lines)
        {
            var created = VatDeclarationLine.Create(
                line.RubricId == Guid.Empty ? null : line.RubricId,
                line.Code,
                line.Label,
                (MonthlyDeclarationFamily)line.Family,
                line.ReportCode,
                grossAmount: line.Gross,
                withheldAmount: line.Withheld,
                ratePercentApplied: line.RatePercentApplied,
                computedGrossAmount: line.Gross,
                computedWithheldAmount: line.Withheld,
                origin: line.RequiresManualInput
                    ? VatDeclarationLineOrigin.Manual
                    : VatDeclarationLineOrigin.Computed,
                displayOrder: order++);

            // Une ligne mal formée est écartée sans faire échouer le dépôt : le détail est
            // informatif, les scalaires font foi. Refuser la déclaration entière parce qu'un
            // libellé déborde serait hors de proportion.
            if (created.IsSuccess)
                frozen.Add(created.Value);
        }

        return frozen;
    }

    /// <summary>Relit les lignes déposées pour l'affichage, sans passer par le calcul.</summary>
    public static IReadOnlyList<MonthlyDeclarationLineDto> Read(IEnumerable<VatDeclarationLine> lines) =>
        lines
            .OrderBy(l => l.DisplayOrder)
            .Select(l => new MonthlyDeclarationLineDto
            {
                RubricId = l.RubricId ?? Guid.Empty,
                Code = l.RubricCode,
                Label = l.Label,
                Family = (int)l.Family,
                ReportCode = l.ReportCode,
                Gross = l.GrossAmount,
                Withheld = l.WithheldAmount,
                RatePercentApplied = l.RatePercentApplied,
                RequiresManualInput = l.Origin == VatDeclarationLineOrigin.Manual
            })
            .ToList();
}
