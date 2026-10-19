using FactuTrust.Application.Features.Accounting.DocumentImport;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Accounting;

/// <summary>
/// <see cref="ThirdPartyMatricule.SameMatricule"/> a été extrait d'une méthode privée de
/// <c>AccountingEntryProposalService</c> pour être partagé avec <c>SupplierDocumentMatcher</c>.
/// Cette table de cas fige le comportement d'origine : l'extraction doit être sans effet de bord.
/// </summary>
public sealed class ThirdPartyMatriculeTests
{
    [Theory]
    [InlineData("1772793W/A/M/000", "1772793W/A/M/000", true)] // identiques, forme officielle
    [InlineData("1772793W/A/M/000", "1772793/W/A/M/000", true)] // forme officielle vs forme historique
    [InlineData("1772793/W/A/M/000", "1772793/W/A/M/000", true)] // identiques, forme historique
    [InlineData("1772793w/a/m/000", "1772793W/A/M/000", true)] // casse différente
    [InlineData(" 1772793W/A/M/000 ", "1772793W/A/M/000", true)] // espaces superflus
    [InlineData("1772793W/A/M/000", "9999999X/A/M/000", false)] // deux matricules valides mais différents
    [InlineData(null, "1772793W/A/M/000", false)]
    [InlineData("1772793W/A/M/000", null, false)]
    [InlineData(null, null, false)]
    [InlineData("", "", false)]
    public void SameMatricule_canonicalizable_inputs(string? left, string? right, bool expected)
    {
        Assert.Equal(expected, ThirdPartyMatricule.SameMatricule(left, right));
    }

    [Theory]
    [InlineData("ABC-123!!", "ABC123", true)] // non canonisable, mais même normalisation alphanumérique
    [InlineData("abc 123", "ABC123", true)] // casse et espaces, non canonisable
    [InlineData("ABC-123", "XYZ-999", false)] // deux chaînes invalides mais différentes après normalisation
    [InlineData("???", "???", false)] // normalisation vide des deux côtés : jamais une égalité positive
    public void SameMatricule_falls_back_to_normalized_comparison_when_not_canonicalizable(
        string? left, string? right, bool expected)
    {
        Assert.Equal(expected, ThirdPartyMatricule.SameMatricule(left, right));
    }
}
