using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Valeurs des documents de la période — factures clients, rapport de retenue à la source — telles
/// que les rubriques d'origine « documents » les consomment.
/// </summary>
/// <remarks>
/// <para>
/// Comme l'apport de la paie, ces valeurs ne sont pas chargées par le moteur : l'appelant les réunit
/// une fois, avec les appels qu'il faisait déjà, et les transmet. Le moteur reste pur, et une
/// période ne coûte aucune requête de plus qu'avant.
/// </para>
/// <para>
/// La retenue à la source est répartie <b>ligne de rapport par ligne</b>, par
/// <see cref="WithholdingReportPartition"/> — la ventilation historique vers le formulaire
/// officiel. Le reliquat se calcule <b>par différence</b> avec le total du rapport : il absorbe les
/// lignes sans case (jeux, autres, achats à un autre taux) et celles à retenue nulle ou négative
/// (avoirs), que la ventilation saute. La somme des compartiments égale donc le total, par
/// construction, même sur un rapport dont les lignes ne totalisent pas le total.
/// </para>
/// </remarks>
public sealed record DeclarationDocumentContribution
{
    public decimal SalesTaxableBase { get; init; }
    public decimal SalesGrossBase { get; init; }
    public decimal FodecFormBase { get; init; }
    public decimal FodecAmount { get; init; }
    public decimal FiscalStampAmount { get; init; }

    public IReadOnlyDictionary<WithholdingReportBucket, (decimal Base, decimal Amount)> Withholding { get; init; } =
        new Dictionary<WithholdingReportBucket, (decimal, decimal)>();

    /// <summary>Aucun document : déclaration mensuelle unique éteinte, ou moteur non concerné.</summary>
    public static DeclarationDocumentContribution None { get; } = new();

    /// <param name="fodecTaxableBase">
    /// Assiette des lignes soumises au FODEC ; à défaut (0), l'assiette reportée est le chiffre
    /// d'affaires hors taxes — exactement la règle du formulaire officiel.
    /// </param>
    public static DeclarationDocumentContribution From(
        decimal salesTaxableBase,
        decimal salesGrossBase,
        decimal fodecTaxableBase,
        decimal fodecAmount,
        decimal fiscalStampAmount,
        WithholdingMonthlyReportDto? withholdingReport) => new()
    {
        SalesTaxableBase = salesTaxableBase,
        SalesGrossBase = salesGrossBase,
        FodecFormBase = fodecTaxableBase != 0m ? fodecTaxableBase : salesTaxableBase,
        FodecAmount = fodecAmount,
        FiscalStampAmount = fiscalStampAmount,
        Withholding = Partition(withholdingReport)
    };

    /// <summary>Valeur que désigne une source « documents ».</summary>
    public decimal ValueOf(DeclarationDocumentSource source)
    {
        switch (source)
        {
            case DeclarationDocumentSource.SalesTaxableBase: return SalesTaxableBase;
            case DeclarationDocumentSource.SalesGrossBase: return SalesGrossBase;
            case DeclarationDocumentSource.FodecFormBase: return FodecFormBase;
            case DeclarationDocumentSource.FodecAmount: return FodecAmount;
            case DeclarationDocumentSource.FiscalStampAmount: return FiscalStampAmount;
        }

        if (!BucketOf.TryGetValue(source, out var entry))
            return 0m;

        return Withholding.TryGetValue(entry.Bucket, out var value)
            ? (entry.IsBase ? value.Base : value.Amount)
            : 0m;
    }

    /// <summary>Compartiment RS désigné par chaque paire de sources (assiette, montant).</summary>
    private static readonly IReadOnlyDictionary<DeclarationDocumentSource, (WithholdingReportBucket Bucket, bool IsBase)> BucketOf =
        new Dictionary<DeclarationDocumentSource, (WithholdingReportBucket, bool)>
        {
            [DeclarationDocumentSource.WithholdingSalariesBase] = (WithholdingReportBucket.Salaries, true),
            [DeclarationDocumentSource.WithholdingSalariesAmount] = (WithholdingReportBucket.Salaries, false),
            [DeclarationDocumentSource.WithholdingFeesRealRegimeBase] = (WithholdingReportBucket.FeesRealRegime, true),
            [DeclarationDocumentSource.WithholdingFeesRealRegimeAmount] = (WithholdingReportBucket.FeesRealRegime, false),
            [DeclarationDocumentSource.WithholdingFeesOtherBase] = (WithholdingReportBucket.FeesOther, true),
            [DeclarationDocumentSource.WithholdingFeesOtherAmount] = (WithholdingReportBucket.FeesOther, false),
            [DeclarationDocumentSource.WithholdingCommissionsAndRentsBase] = (WithholdingReportBucket.CommissionsAndRents, true),
            [DeclarationDocumentSource.WithholdingCommissionsAndRentsAmount] = (WithholdingReportBucket.CommissionsAndRents, false),
            [DeclarationDocumentSource.WithholdingPurchasesRate1Base] = (WithholdingReportBucket.PurchasesRate1, true),
            [DeclarationDocumentSource.WithholdingPurchasesRate1Amount] = (WithholdingReportBucket.PurchasesRate1, false),
            [DeclarationDocumentSource.WithholdingPurchasesRate05Base] = (WithholdingReportBucket.PurchasesRate05, true),
            [DeclarationDocumentSource.WithholdingPurchasesRate05Amount] = (WithholdingReportBucket.PurchasesRate05, false),
            [DeclarationDocumentSource.WithholdingPurchasesRate15Base] = (WithholdingReportBucket.PurchasesRate15, true),
            [DeclarationDocumentSource.WithholdingPurchasesRate15Amount] = (WithholdingReportBucket.PurchasesRate15, false),
            [DeclarationDocumentSource.WithholdingCapitalIncomeBase] = (WithholdingReportBucket.CapitalIncome, true),
            [DeclarationDocumentSource.WithholdingCapitalIncomeAmount] = (WithholdingReportBucket.CapitalIncome, false),
            [DeclarationDocumentSource.WithholdingDividendsBase] = (WithholdingReportBucket.Dividends, true),
            [DeclarationDocumentSource.WithholdingDividendsAmount] = (WithholdingReportBucket.Dividends, false),
            [DeclarationDocumentSource.WithholdingRealEstateBase] = (WithholdingReportBucket.RealEstate, true),
            [DeclarationDocumentSource.WithholdingRealEstateAmount] = (WithholdingReportBucket.RealEstate, false),
            [DeclarationDocumentSource.WithholdingVatFullBase] = (WithholdingReportBucket.VatFull, true),
            [DeclarationDocumentSource.WithholdingVatFullAmount] = (WithholdingReportBucket.VatFull, false),
            [DeclarationDocumentSource.WithholdingVatOtherBase] = (WithholdingReportBucket.VatOther, true),
            [DeclarationDocumentSource.WithholdingVatOtherAmount] = (WithholdingReportBucket.VatOther, false),
            [DeclarationDocumentSource.WithholdingCapitalGainsBase] = (WithholdingReportBucket.CapitalGains, true),
            [DeclarationDocumentSource.WithholdingCapitalGainsAmount] = (WithholdingReportBucket.CapitalGains, false),
            [DeclarationDocumentSource.WithholdingNonResidentsBase] = (WithholdingReportBucket.NonResidents, true),
            [DeclarationDocumentSource.WithholdingNonResidentsAmount] = (WithholdingReportBucket.NonResidents, false),
            [DeclarationDocumentSource.WithholdingRemainderBase] = (WithholdingReportBucket.Remainder, true),
            [DeclarationDocumentSource.WithholdingRemainderAmount] = (WithholdingReportBucket.Remainder, false)
        };

    /// <summary>
    /// Répartit le rapport comme <see cref="WithholdingFormLineMapper.Accumulate"/> : une ligne à
    /// retenue positive rejoint son compartiment, avec son assiette si elle est positive ; tout le
    /// reste tombe dans le reliquat, calculé par différence.
    /// </summary>
    private static IReadOnlyDictionary<WithholdingReportBucket, (decimal Base, decimal Amount)> Partition(
        WithholdingMonthlyReportDto? report)
    {
        var buckets = new Dictionary<WithholdingReportBucket, (decimal Base, decimal Amount)>();
        if (report is null)
            return buckets;

        var ventilatedBase = 0m;
        var ventilatedAmount = 0m;

        foreach (var row in report.ByCategory ?? [])
        {
            if (row.TotalWithheld <= 0m)
                continue;

            var bucket = WithholdingReportPartition.Bucket(row);
            if (bucket == WithholdingReportBucket.Remainder)
                continue;

            var rowBase = row.TotalHT > 0m ? row.TotalHT : 0m;
            var current = buckets.GetValueOrDefault(bucket);
            buckets[bucket] = (current.Base + rowBase, current.Amount + row.TotalWithheld);
            ventilatedBase += rowBase;
            ventilatedAmount += row.TotalWithheld;
        }

        buckets[WithholdingReportBucket.Remainder] = (
            report.GrandTotalHT - ventilatedBase,
            report.GrandTotalWithheld - ventilatedAmount);

        return buckets;
    }
}
