using FactuTrust.Application.Common.Barcodes;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

/// <summary>
/// Le drapeau des symbologies étendues ne garde que le chemin d'ÉCRITURE.
///
/// <para>
/// Éteint, le catalogue n'accepte que ce qu'il acceptait avant l'extension : EAN-8 et EAN-13.
/// La lecture, elle, reste tolérante — ce qui est sans effet tant qu'aucune valeur étendue
/// n'existe en base, et qui évite surtout de laisser des codes déjà enregistrés devenir
/// illisibles si le drapeau est éteint après coup.
/// </para>
/// </summary>
public sealed class BarcodePolicyTests
{
    private static readonly BarcodeOptions Off = new() { ExtendedSymbologiesEnabled = false };
    private static readonly BarcodeOptions On = new() { ExtendedSymbologiesEnabled = true };

    private static Barcode Parse(string value) => Barcode.Create(value).Value;

    [Theory]
    [InlineData("4006381333931")] // EAN-13
    [InlineData("96385074")]      // EAN-8
    public void LegacySymbologiesAreWritableEvenWhenTheFlagIsOff(string value)
    {
        Assert.True(BarcodePolicy.EnsureWritable(Parse(value), Off).IsSuccess);
    }

    [Theory]
    [InlineData("036000291452")]   // UPC-A
    [InlineData("40063813339314")] // GTIN-14
    [InlineData("REF-2024-A")]     // Code 128
    public void ExtendedSymbologiesAreRefusedWhenTheFlagIsOff(string value)
    {
        var result = BarcodePolicy.EnsureWritable(Parse(value), Off);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Barcode", result.Error.Code);
        Assert.Contains("EAN-8 et EAN-13", result.Error.Description);
    }

    [Theory]
    [InlineData("036000291452")]
    [InlineData("40063813339314")]
    [InlineData("REF-2024-A")]
    [InlineData("4006381333931")]
    public void EverythingIsWritableWhenTheFlagIsOn(string value)
    {
        Assert.True(BarcodePolicy.EnsureWritable(Parse(value), On).IsSuccess);
    }

    [Fact]
    public void TheRefusalNamesTheSymbologyItRefused()
    {
        var result = BarcodePolicy.EnsureWritable(Parse("036000291452"), Off);

        Assert.Contains("UPC-A", result.Error.Description);
    }

    [Theory]
    [InlineData(BarcodeSymbology.Ean8, "EAN-8")]
    [InlineData(BarcodeSymbology.UpcA, "UPC-A")]
    [InlineData(BarcodeSymbology.Ean13, "EAN-13")]
    [InlineData(BarcodeSymbology.Gtin14, "GTIN-14")]
    [InlineData(BarcodeSymbology.Code128, "Code 128")]
    public void EverySymbologyHasAReadableLabel(BarcodeSymbology symbology, string expected)
    {
        Assert.Equal(expected, BarcodePolicy.Describe(symbology));
    }

    [Fact]
    public void DefaultOptionsAreOff()
    {
        // Le drapeau doit être éteint par défaut : une installation qui ne configure rien ne
        // doit pas se mettre silencieusement à accepter des symbologies nouvelles.
        var defaults = new BarcodeOptions();

        Assert.False(defaults.ExtendedSymbologiesEnabled);
        Assert.False(defaults.LabelPrintingEnabled);
    }
}
