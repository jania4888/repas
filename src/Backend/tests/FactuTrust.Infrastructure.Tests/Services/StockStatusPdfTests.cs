using System.Globalization;
using System.Net.Http;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Infrastructure.Services;
using Moq;
using UglyToad.PdfPig;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class StockStatusPdfTests
{
    [Fact]
    public async Task FrenchPdf_KeepsTheAccountingEnvelopeAndSkipsTheArabicFont()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
        try
        {
            var bytes = await Generate(Sample(rightToLeft: false));
            using var stream = new MemoryStream(bytes);
            using var pdf = PdfDocument.Open(stream);
            var letters = pdf.GetPages().SelectMany(page => page.Letters).ToList();
            var text = string.Concat(letters.Select(letter => letter.Value));

            Assert.Contains("État de stock", text);
            Assert.Contains("Total général", text);
            Assert.Contains("1.500", text);
            Assert.DoesNotContain(letters, letter =>
                (letter.FontName ?? "").Contains("Naskh", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    [Fact]
    public async Task ArabicPdf_UsesNotoNaskhAndKeepsLatinAmounts()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            var bytes = await Generate(Sample(rightToLeft: true));
            using var stream = new MemoryStream(bytes);
            using var pdf = PdfDocument.Open(stream);
            var letters = pdf.GetPages().SelectMany(page => page.Letters).ToList();
            var text = string.Concat(letters.Select(letter => letter.Value));

            Assert.Contains(letters, letter =>
                (letter.FontName ?? "").Contains("Naskh", StringComparison.OrdinalIgnoreCase));
            Assert.Contains("1.500", text);
            Assert.True(text.Count(c => c is >= '\u0600' and <= '\u06FF' or >= '\uFE70' and <= '\uFEFF') >= 8, text);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static Task<byte[]> Generate(StockStatusPdfContext context)
    {
        var pdf = new PdfService(Mock.Of<IHttpClientFactory>(), Mock.Of<IDocumentTemplateRegistry>());
        return pdf.GenerateStockStatusReportPdfAsync(context);
    }

    private static StockStatusPdfContext Sample(bool rightToLeft) => new(
        Title: rightToLeft ? StockStatusLabels.Title() : "État de stock",
        GroupingModeLabel: StockStatusLabels.GroupingWarehouseThenCategory(),
        CompanyName: "Société Test",
        MatriculeFiscal: "1234567A",
        GeneratedAtLocal: new DateTime(2026, 10, 4, 11, 30, 0),
        FiltersSummary: null,
        GroupingMode: StockStatusGroupingMode.WarehouseThenCategory,
        Rows: new[]
        {
            new StockStatusReportRowDto
            {
                ProductId = Guid.NewGuid(),
                ProductCode = "P1",
                ProductName = "Article",
                CategoryName = "Cat",
                WarehouseId = Guid.NewGuid(),
                WarehouseCode = "W1",
                WarehouseName = "Magasin",
                QuantityOnHand = 1.5m,
                UnitCost = 1m,
                StockValue = 1.5m
            }
        },
        GrandTotalQuantity: 1.5m,
        GrandTotalValue: 1.5m,
        Currency: "TND",
        RightToLeft: rightToLeft);
}
