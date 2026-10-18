using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Infrastructure.Services.DocumentImport;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

/// <summary>
/// Tests « golden » sur de vraies factures produites par InstaFact. Les valeurs attendues sont
/// celles imprimées sur les PDF : toute dérive du parseur ou du gabarit est détectée ici.
/// </summary>
public sealed class InstaFactInvoicePdfParserTests
{
    private static string FixturePath(string fileName) =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "accounting-documents", fileName);

    private static AccountingDocumentExtractionDto Parse(string fileName)
    {
        var parser = new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance);
        var bytes = File.ReadAllBytes(FixturePath(fileName));
        var result = parser.TryParse(bytes, fileName);
        Assert.NotNull(result);
        return result!;
    }

    [Fact]
    public void TryParse_Invoice000012_ReadsHeaderAndParties()
    {
        var doc = Parse("Facture_FAC-2026-000012.pdf");

        Assert.Equal(DocumentTypes.Invoice, doc.DocumentType);
        Assert.Equal("FAC-2026-000012", doc.DocumentNumber);
        Assert.Equal(new DateOnly(2026, 7, 12), doc.IssueDate);
        Assert.Equal(new DateOnly(2026, 8, 11), doc.DueDate);
        Assert.Equal("TND", doc.Currency);
        Assert.Equal(AccountingDocumentExtractionMethods.NativePdf, doc.ExtractionMethod);
        Assert.False(doc.OcrApplied);

        Assert.Equal("9545455/D/F/F/555", doc.Seller?.Nif);
        Assert.Equal("Ste Bouzgarou", doc.Seller?.Name);

        Assert.Equal("9545555/E/E/E/525", doc.Buyer?.Nif);
        Assert.Equal("Ste Slimen", doc.Buyer?.Name);
    }

    [Fact]
    public void TryParse_Invoice000012_ReadsTwoVatRatesAndTotals()
    {
        var doc = Parse("Facture_FAC-2026-000012.pdf");

        Assert.Equal(3700.000m, doc.TotalHt);
        Assert.Equal(553.000m, doc.TotalVat);
        Assert.Equal(1.000m, doc.FiscalStampAmount);
        Assert.Equal(4254.000m, doc.TotalTtc);

        Assert.Collection(
            doc.VatBreakdown,
            b =>
            {
                Assert.Equal(13, b.RatePercent);
                Assert.Equal(2500.000m, b.BaseAmount);
                Assert.Equal(325.000m, b.VatAmount);
            },
            b =>
            {
                Assert.Equal(19, b.RatePercent);
                Assert.Equal(1200.000m, b.BaseAmount);
                Assert.Equal(228.000m, b.VatAmount);
            });
    }

    [Fact]
    public void TryParse_Invoice000014_ReadsTotals()
    {
        var doc = Parse("Facture_FAC-2026-000014.pdf");

        Assert.Equal("FAC-2026-000014", doc.DocumentNumber);
        Assert.Equal(new DateOnly(2026, 7, 13), doc.IssueDate);
        Assert.Equal(5550.000m, doc.TotalHt);
        Assert.Equal(829.500m, doc.TotalVat);
        Assert.Equal(1.000m, doc.FiscalStampAmount);
        Assert.Equal(6380.500m, doc.TotalTtc);

        Assert.Collection(
            doc.VatBreakdown,
            b => Assert.Equal((13, 3750.000m, 487.500m), (b.RatePercent, b.BaseAmount, b.VatAmount)),
            b => Assert.Equal((19, 1800.000m, 342.000m), (b.RatePercent, b.BaseAmount, b.VatAmount)));
    }

    [Fact]
    public void TryParse_Invoice000026_ReadsSingleVatRate()
    {
        var doc = Parse("Facture_FAC-2026-000026.pdf");

        Assert.Equal("FAC-2026-000026", doc.DocumentNumber);
        Assert.Equal(new DateOnly(2026, 8, 1), doc.IssueDate);
        Assert.Equal("Ste Lamine", doc.Buyer?.Name);
        Assert.Equal("8652225/F/F/G/441", doc.Buyer?.Nif);

        Assert.Equal(1250.000m, doc.TotalHt);
        Assert.Equal(162.500m, doc.TotalVat);
        Assert.Equal(1.000m, doc.FiscalStampAmount);
        Assert.Equal(1413.500m, doc.TotalTtc);

        var bucket = Assert.Single(doc.VatBreakdown);
        Assert.Equal((13, 1250.000m, 162.500m), (bucket.RatePercent, bucket.BaseAmount, bucket.VatAmount));
    }

    [Fact]
    public void TryParse_DraftInvoice_WarnsAboutTheStatus()
    {
        // FAC-2026-000026 porte « Statut : Brouillon » : la comptabiliser est probablement une erreur.
        var doc = Parse("Facture_FAC-2026-000026.pdf");

        Assert.Equal("Brouillon", doc.DocumentStatus);
        Assert.Contains(doc.Warnings, w => w.Contains("Brouillon", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void TryParse_ReadsItemLinesWithTheirReferenceAndVatRate()
    {
        var doc = Parse("Facture_FAC-2026-000012.pdf");

        Assert.Equal(2, doc.Lines.Count);

        var first = doc.Lines[0];
        Assert.Equal("CUIS003", first.Reference);
        Assert.Equal("cuisinière moderne", first.Designation);
        Assert.Equal(2m, first.Quantity);
        Assert.Equal(1250.000m, first.UnitPriceHt);
        Assert.Equal(13, first.VatRatePercent);
        Assert.Equal(2500.000m, first.LineTotalHt);

        var second = doc.Lines[1];
        Assert.Equal("TELV002", second.Reference);
        Assert.Equal(19, second.VatRatePercent);
        Assert.Equal(1200.000m, second.LineTotalHt);
    }

    [Fact]
    public void TryParse_CanonicalNifSpelling_ReadsSellerAndBuyerNifs()
    {
        // Les pièces récentes impriment le matricule tel que stocké (« 1525071P/B/M/000 »),
        // sans séparateur après le numéro — le parseur doit lire les deux orthographes.
        var doc = Parse("Facture_FAC-COM-2026-000004_CanonicalNif.pdf");

        Assert.Equal("1525071P/B/M/000", doc.Seller?.Nif);
        Assert.Equal("STE SANITAIRE PLUS", doc.Seller?.Name);
        Assert.Equal("6655443D/A/M/000", doc.Buyer?.Nif);
        Assert.Equal("Dossier Démo Compta", doc.Buyer?.Name);

        Assert.Equal(200.000m, doc.TotalHt);
        Assert.Equal(38.000m, doc.TotalVat);
        Assert.Null(doc.FiscalStampAmount);
        Assert.Equal(238.000m, doc.TotalTtc);
    }

    [Theory]
    [InlineData("Facture_FAC-2026-000012.pdf")]
    [InlineData("Facture_FAC-2026-000014.pdf")]
    [InlineData("Facture_FAC-2026-000026.pdf")]
    [InlineData("Facture_FAC-COM-2026-000004_CanonicalNif.pdf")]
    public void TryParse_EveryFixture_IsFullyReconciled(string fileName)
    {
        var doc = Parse(fileName);
        var report = AccountingDocumentReconciliation.Check(doc);

        Assert.True(report.VatBaseMatchesTotalHt);
        Assert.True(report.VatAmountMatchesTotalVat);
        Assert.True(report.GrandTotalMatches);
        Assert.Equal(0m, report.GrandTotalDelta);
    }

    [Fact]
    public void TryParse_NonInstaFactPdf_ReturnsNullSoTheCallerFallsBackToAi()
    {
        var parser = new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance);
        var bankStatement = Path.Combine(
            AppContext.BaseDirectory, "Fixtures", "bank-statements", "biat-janvier-2026.pdf");

        Assert.Null(parser.TryParse(File.ReadAllBytes(bankStatement), "biat-janvier-2026.pdf"));
    }

    [Fact]
    public void TryParse_CorruptedBytes_ReturnsNullInsteadOfThrowing()
    {
        var parser = new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance);
        Assert.Null(parser.TryParse(new byte[] { 1, 2, 3, 4 }, "broken.pdf"));
    }

    [Theory]
    [InlineData("1,250.000", 1250.000)]
    [InlineData("+3700.000", 3700.000)]
    [InlineData("-1.000", -1.000)]
    [InlineData("650,000", 650.000)]
    [InlineData("1 250,500", 1250.500)]
    [InlineData("2,500.000", 2500.000)]
    public void ParseAmount_HandlesTunisianAndFrenchNumberFormats(string raw, double expected)
    {
        Assert.Equal((decimal)expected, InstaFactInvoicePdfParser.ParseAmount(raw));
    }
}
