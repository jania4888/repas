using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Ce que le formulaire officiel tamponne pour une déclaration : le détail des rubriques projeté
/// sur les cases, et — pour les seuls dépôts antérieurs au retrait du calcul câblé — la ventilation
/// de la retenue à la source par article, reconstituée à l'impression.
/// </summary>
/// <remarks>
/// Point de décision <b>unique</b>, pour que l'écran, l'export et les tests parlent du même
/// formulaire : une seconde règle d'impression divergerait au premier changement.
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
    /// La déclaration doit-elle voir sa retenue à la source ventilée par le chemin de réimpression ?
    /// </summary>
    /// <remarks>
    /// <para>
    /// Vrai pour un <b>dépôt</b> dont le détail figé ne porte <b>aucune ligne de retenue</b>. C'est
    /// exactement la signature des déclarations enregistrées avant le retrait du calcul câblé : ce
    /// calcul ne produisait pas de lignes, mais le formulaire en ventilait tout de même la retenue
    /// par article. Leur réimpression ne doit pas s'appauvrir.
    /// </para>
    /// <para>
    /// Faux pour une période <b>sans dépôt</b> : on n'imprime pas un détail que le calcul en vigueur
    /// ne produit pas. Faux aussi dès que le dépôt porte des lignes de retenue — fût-ce à zéro :
    /// elles font foi, et les deux ventilations se compteraient deux fois sur les mêmes cases.
    /// </para>
    /// </remarks>
    public static bool NeedsHistoricWithholdingLines(VatDeclarationDto declaration) =>
        declaration.CalculationOrigin is not null
        && !declaration.Lines.Any(l => l.Family == (int)MonthlyDeclarationFamily.Withholding);

    /// <summary>
    /// Ventilation de la retenue à la source sur les lignes réglementaires : factures du rapport RS,
    /// puis salaires, puis loyers, sous le garde-fou du total déclaré. Réimpression seule : elle ne
    /// calcule aucun montant déclaré.
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
        var withholdingLines = NeedsHistoricWithholdingLines(declaration)
            ? HistoricWithholdingLines(declaration, invoiceWithholding)
            : WithholdingFormLineMapper.Empty;

        return MonthlyDeclarationFormBinder.Bind(declaration, withholdingLines, configuredBoxes);
    }
}
