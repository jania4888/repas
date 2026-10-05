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

public sealed class PurchasesJournalPdfTests
{
    [Fact]
    public async Task FrenchPdf_ContainsTitleAndThreeDecimalAmount()
    {
        var bytes = await Generate(FrenchContext());
        var text = Extract(bytes);
        Assert.Contains("Journal d'achats", text);
        Assert.Contains("1.500", text);
        Assert.DoesNotContain("يومية", text);
    }

    [Fact]
    public async Task ArabicPdf_UsesArabicFontAndKeepsTheAmount()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("ar-TN");
        try
        {
            var bytes = await Generate(ArabicContext());
            using var stream = new MemoryStream(bytes);
            using var pdf = PdfDocument.Open(stream);
            var letters = pdf.GetPages().SelectMany(page => page.Letters).ToList();
            var text = string.Concat(letters.Select(letter => letter.Value));

            Assert.Contains(letters, letter =>
                letter.FontName?.Contains("Naskh", StringComparison.OrdinalIgnoreCase) == true);
            Assert.Contains("1.500", text);
            Assert.True(text.Count(c => c is >= '\u0600' and <= '\u06FF' or >= '\uFE70' and <= '\uFEFF') >= 8, text);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static async Task<byte[]> Generate(PurchasesJournalPdfContext context)
    {
        var pdf = new PdfService(Mock.Of<IHttpClientFactory>(), Mock.Of<IDocumentTemplateRegistry>());
        return await pdf.GeneratePurchasesJournalReportPdfAsync(context);
    }

    private static string Extract(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var pdf = PdfDocument.Open(stream);
        return string.Join("\n", pdf.GetPages().Select(page => page.Text));
    }

    private static PurchasesJournalPdfContext FrenchContext() => new(
        Title: "Journal d'achats",
        ViewModeLabel: "Détail",
        SourceLabel: "Factures fournisseur",
        From: new DateTime(2026, 4, 1),
        To: new DateTime(2026, 4, 10),
        SupplierName: null,
        CompanyName: "Société Test",
        MatriculeFiscal: "1234567A",
        ViewMode: SalesJournalViewMode.Detail,
        DetailRows: new[] { SampleRow() },
        AggregatedRows: Array.Empty<PurchasesJournalAggregatedRowDto>(),
        Totals: SampleTotals(),
        RightToLeft: false);

    private static PurchasesJournalPdfContext ArabicContext() => FrenchContext() with
    {
        Title = "يومية المشتريات",
        ViewModeLabel = "تفصيل",
        SourceLabel = "فواتير المزوّدين",
        RightToLeft = true
    };

    private static PurchasesJournalDetailRowDto SampleRow() => new()
    {
        EntryDate = new DateTime(2026, 4, 2),
        DocumentId = Guid.NewGuid(),
        DocumentNumber = "FS-2026-000001",
        DocumentKind = "FAC",
        SupplierId = Guid.NewGuid(),
        SupplierName = "Ste Mbarki",
        ProductId = Guid.NewGuid(),
        ProductCode = "CHA001",
        ProductName = "chaise",
        Quantity = 1.5m,
        UnitPrice = 30m,
        LineSubTotal = 45m,
        VatAmount = 8.55m,
        LineTotal = 1.5m,
        Currency = "TND"
    };

    private static PurchasesJournalTotalsDto SampleTotals() => new()
    {
        Quantity = 1.5m,
        LineSubTotal = 45m,
        VatAmount = 8.55m,
        LineTotal = 1.5m,
        Currency = "TND"
    };
}
