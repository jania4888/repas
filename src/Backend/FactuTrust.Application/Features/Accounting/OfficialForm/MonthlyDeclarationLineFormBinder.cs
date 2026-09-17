using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Projette le détail par rubrique d'une déclaration sur les cases du formulaire officiel.
/// </summary>
/// <remarks>
/// Fonction pure : aucune dépendance sur le PDF ni sur l'infrastructure, comme le binder principal
/// dont elle complète le travail.
/// </remarks>
public static class MonthlyDeclarationLineFormBinder
{
    /// <summary>Tolérance d'arrondi au millime, identique au reste de la chaîne.</summary>
    public const decimal Epsilon = 0.001m;

    /// <summary>
    /// Construit le dictionnaire « clé de case → montant » issu des rubriques.
    /// </summary>
    /// <param name="lines">Détail par rubrique de la période.</param>
    /// <param name="declaredFamilyTotals">
    /// Montant que la déclaration porte pour chaque famille. Sert de plafond : une famille dont le
    /// détail dépasse le total déclaré est abandonnée en entier.
    /// </param>
    /// <param name="formVersion">Millésime du formulaire (ex. <c>mensuelle-2026</c>).</param>
    /// <remarks>
    /// <para>
    /// <b>Règle de sûreté, par famille.</b> Le total déclaré fait foi ; le détail n'est
    /// qu'informatif. Si la ventilation d'une famille excède son total, elle est abandonnée plutôt
    /// que reportée — mieux vaut une déclaration moins détaillée qu'une déclaration fausse. Le
    /// cloisonnement par famille est délibéré : c'est la correction qu'a demandée la ventilation
    /// historique de la retenue à la source, où un dépassement sur les factures emportait au passage
    /// la retenue salariale.
    /// </para>
    /// <para>
    /// La famille « autres informations » ne produit aucune case : elle est déclarative, ne porte
    /// aucun montant à payer, et le millésime 2026 ne lui a pas calibré de cellule.
    /// </para>
    /// </remarks>
    public static IReadOnlyDictionary<string, decimal> Project(
        IReadOnlyList<MonthlyDeclarationLineDto>? lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> declaredFamilyTotals,
        string formVersion)
    {
        var boxes = new Dictionary<string, decimal>(StringComparer.Ordinal);
        if (lines is null || lines.Count == 0)
            return boxes;

        foreach (var group in lines.GroupBy(l => (MonthlyDeclarationFamily)l.Family))
        {
            var family = group.Key;
            if (family == MonthlyDeclarationFamily.OtherInformation)
                continue;

            var ventilated = group.Sum(l => l.Withheld);
            var declared = declaredFamilyTotals.TryGetValue(family, out var total) ? total : 0m;
            if (ventilated > declared + Epsilon)
                continue;

            foreach (var line in group)
            {
                var target = MonthlyDeclarationReportCodeMap.Resolve(formVersion, family, line.ReportCode);
                if (target is null)
                    continue;

                // Plusieurs rubriques peuvent viser la même case — commissions et loyers relèvent
                // tous deux de l'article 4 : on cumule, on n'écrase pas.
                Accumulate(boxes, target.BaseKey, line.Gross);
                Accumulate(boxes, target.AmountKey, line.Withheld);
            }
        }

        return boxes;
    }

    /// <summary>
    /// Totaux déclarés par famille, tels que la déclaration les porte. Sert de plafond au
    /// garde-fou ci-dessus.
    /// </summary>
    public static IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> DeclaredFamilyTotals(
        VatDeclarationDto declaration) =>
        new Dictionary<MonthlyDeclarationFamily, decimal>
        {
            [MonthlyDeclarationFamily.Withholding] = declaration.WithholdingTax,
            [MonthlyDeclarationFamily.Tfp] = declaration.Tfp,
            [MonthlyDeclarationFamily.Foprolos] = declaration.Foprolos,
            [MonthlyDeclarationFamily.ConsumptionDuty] = declaration.ConsumptionDuty,
            // La TVA n'est pas remontée depuis les rubriques : son plafond est la TVA collectée,
            // seule grandeur que le détail par taux peut totaliser.
            [MonthlyDeclarationFamily.Vat] =
                declaration.CollectedVat19 + declaration.CollectedVat13 + declaration.CollectedVat7
                + declaration.DeductibleVatGoods + declaration.DeductibleVatAssets,
            [MonthlyDeclarationFamily.OtherTurnoverTaxes] = declaration.Fodec,
            [MonthlyDeclarationFamily.StampDuty] = declaration.DroitTimbre,
            [MonthlyDeclarationFamily.HotelTax] = declaration.HotelTax,
            [MonthlyDeclarationFamily.Tcl] = declaration.Tcl,
            [MonthlyDeclarationFamily.LicenceFee] = declaration.LicenceFee
        };

    private static void Accumulate(Dictionary<string, decimal> boxes, string? key, decimal amount)
    {
        if (string.IsNullOrEmpty(key))
            return;

        boxes[key] = boxes.TryGetValue(key, out var existing) ? existing + amount : amount;
    }
}
