using System.Reflection;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Infrastructure.Services;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Couverture des constantes <c>Source*</c> d'<see cref="AccountingService"/> (plan §6/§11) :
/// chaque type de source d'écriture déclaré doit être explicitement classé — soit vers une
/// catégorie métier, soit vers « other »/« manual » — pour que le filtre « Type de pièce » de
/// l'écran de lettrage ne perde jamais silencieusement un type nouveau.
/// </summary>
public sealed class LetteringSourceCategoriesCoverageTests
{
    private static readonly string[] SourceConstants = typeof(AccountingService)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(f => f.IsLiteral && f.FieldType == typeof(string) && f.Name.StartsWith("Source", StringComparison.Ordinal))
        .Select(f => (string)f.GetRawConstantValue()!)
        .OrderBy(v => v, StringComparer.Ordinal)
        .ToArray();

    [Fact]
    public void Every_SourceConstant_Is_Known_Or_Explicitly_Other()
    {
        Assert.NotEmpty(SourceConstants);

        var unknown = SourceConstants
            .Where(c => !LetteringSourceCategories.KnownSourceEntityTypes.Contains(c))
            .ToArray();

        // Types volontairement hors catégories métier (immobilisations, annulations, avances/prêts,
        // fiscalité…) : ils tombent dans « other » par le comportement voulu de Resolve.
        var expectedOther = new[]
        {
            "CnssContributionPaymentCancelled",
            "EmployeeAdvance", "EmployeeAdvanceCancelled",
            "EmployeeLoan", "EmployeeLoanCancelled",
            "FiscalTaxDeclaration",
            "FixedAssetAcquisition", "FixedAssetDepreciation", "FixedAssetDisposal",
            "OpeningBalanceReversal",
            "PayrollPaymentCancelled", "PayrollRunCancelled",
            "PayrollReclassificationCancelled",
        };

        var unexpected = unknown.Except(expectedOther).ToArray();
        Assert.True(unexpected.Length == 0,
            $"Constantes Source* non couvertes par LetteringSourceCategories et non listées en « other » : {string.Join(", ", unexpected)}");

        var staleExpectedOther = expectedOther.Except(SourceConstants).ToArray();
        Assert.True(staleExpectedOther.Length == 0,
            $"Entrées « other » attendues sans constante correspondante : {string.Join(", ", staleExpectedOther)}");
    }

    [Fact]
    public void Every_KnownSourceEntityType_Resolves_To_A_NonOther_Category()
    {
        foreach (var known in LetteringSourceCategories.KnownSourceEntityTypes)
        {
            var category = LetteringSourceCategories.Resolve(known);
            Assert.NotEqual(LetteringSourceCategories.Other, category);
            Assert.Contains(category, LetteringSourceCategories.All);
        }
    }
}
