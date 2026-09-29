using FactuTrust.Application.DTOs;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Ce que le formulaire officiel tamponne pour une déclaration : le détail des rubriques projeté
/// sur les cases, et — seulement quand ce détail ne ventile pas la retenue à la source — la
/// ventilation historique (factures, salaires, loyers).
/// </summary>
/// <remarks>
/// Point de décision <b>unique</b>, partagé par l'export du formulaire et par le rapport de
/// parité : le rapport compare ainsi exactement ce qui serait tamponné, et non une approximation
/// qui divergerait au premier changement de l'export.
/// </remarks>
public static class MonthlyDeclarationOfficialFormInputs
{
    /// <summary>Détail des rubriques projeté sur les cases du millésime en cours.</summary>
    public static IReadOnlyDictionary<string, decimal> ConfiguredBoxes(VatDeclarationDto declaration) =>
        MonthlyDeclarationLineFormBinder.Project(
            declaration.Lines,
            MonthlyDeclarationLineFormBinder.DeclaredFamilyTotals(declaration),
            MonthlyDeclarationFormBinder.FormVersion);

    /// <summary>
    /// Vrai quand le détail configuré ventile déjà la retenue à la source. Les deux ventilations
    /// sont exclusives par construction : les faire cohabiter compterait deux fois les mêmes
    /// montants sur les mêmes cases.
    /// </summary>
    public static bool IsWithholdingConfigured(IReadOnlyDictionary<string, decimal> configuredBoxes) =>
        configuredBoxes.Keys.Any(k => k.StartsWith("Withholding.", StringComparison.Ordinal));

    /// <summary>
    /// Ventilation historique de la retenue à la source sur les lignes réglementaires : factures
    /// du rapport RS, puis salaires, puis loyers, sous le garde-fou du total déclaré.
    /// </summary>
    /// <param name="invoiceWithholding">
    /// Lignes du rapport RS ; <c>null</c> quand il est indisponible — la RS salariale et celle des
    /// loyers sont alors tout de même reportées.
    /// </param>
    public static IReadOnlyDictionary<string, decimal> HistoricWithholdingLines(
        VatDeclarationDto declaration,
        IReadOnlyList<WithholdingReportByCategoryDto>? invoiceWithholding)
    {
        var invoiceLines = WithholdingFormLineMapper.Accumulate(invoiceWithholding);

        var withPayroll = PayrollWithholdingFormLines.Merge(
            invoiceLines,
            declaration.WithholdingTax,
            declaration.PayrollSalariesNetTaxableBase,
            declaration.PayrollWithholdingIrpp,
            declaration.PayrollWithholdingCss);

        return RentWithholdingFormLines.Merge(
            withPayroll,
            declaration.WithholdingTax,
            declaration.RentWithholdingBase,
            declaration.RentWithholdingAmount);
    }

    /// <summary>Valeurs du formulaire, case par case, telles qu'elles seraient tamponnées.</summary>
    public static IReadOnlyDictionary<string, string?> Values(
        VatDeclarationDto declaration,
        IReadOnlyList<WithholdingReportByCategoryDto>? invoiceWithholding)
    {
        var configuredBoxes = ConfiguredBoxes(declaration);
        var withholdingLines = IsWithholdingConfigured(configuredBoxes)
            ? WithholdingFormLineMapper.Empty
            : HistoricWithholdingLines(declaration, invoiceWithholding);

        return MonthlyDeclarationFormBinder.Bind(declaration, withholdingLines, configuredBoxes);
    }
}
