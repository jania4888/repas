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

public sealed class SalesJournalPdfTests
{
    [Fact]
    public async Task FrenchPdf_ContainsTitleAndThreeDecimalAmount()
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("fr-FR");
        try
        {
            var bytes = await Generate(FrenchContext());
            var text = Extract(bytes);
            Assert.Contains("Journal de ventes", text);
            Assert.Contains("1.500", text);
            Assert.Contains("N° facture", text);
            Assert.DoesNotContain("يومية", text);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
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
            Assert.Contains("FAC-1", text);
            Assert.True(text.Count(c => c is >= '\u0600' and <= '\u06FF' or >= '\uFE70' and <= '\uFEFF') >= 8, text);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static async Task<byte[]> Generate(SalesJournalPdfContext context)
    {
        var pdf = new PdfService(Mock.Of<IHttpClientFactory>(), Mock.Of<IDocumentTemplateRegistry>());
        return await pdf.GenerateSalesJournalReportPdfAsync(context);
    }

    private static string Extract(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var pdf = PdfDocument.Open(stream);
        return string.Join("\n", pdf.GetPages().Select(page => page.Text));
    }

    private static SalesJournalPdfContext FrenchContext() => new(
        Title: "Journal de ventes",
        ViewModeLabel: "Détail",
        From: new DateTime(2026, 4, 1),
        To: new DateTime(2026, 4, 10),
        ClientName: null,
        CompanyName: "Société Test",
        MatriculeFiscal: "1234567A",
        ViewMode: SalesJournalViewMode.Detail,
        DetailRows: new[] { SampleRow() },
        AggregatedRows: Array.Empty<SalesJournalAggregatedRowDto>(),
        Totals: SampleTotals(),
        RightToLeft: false);

    private static SalesJournalPdfContext ArabicContext() => FrenchContext() with
    {
        Title = "يومية المبيعات",
        ViewModeLabel = "التفاصيل",
        RightToLeft = true
    };

    private static SalesJournalDetailRowDto SampleRow() => new()
    {
        IssueDate = new DateTime(2026, 4, 2),
        InvoiceId = Guid.NewGuid(),
        InvoiceNumber = "FAC-1",
        DocumentType = "FAC",
        ClientId = Guid.NewGuid(),
        ClientName = "Client Test",
        ProductCode = "TAB001",
        ProductName = "tableau",
        Quantity = 1.5m,
        UnitPrice = 30m,
        LineSubTotal = 45m,
        VatAmount = 8.55m,
        LineTotal = 1.5m,
        Currency = "TND"
    };

    private static SalesJournalTotalsDto SampleTotals() => new()
    {
        Quantity = 1.5m,
        LineSubTotal = 45m,
        VatAmount = 8.55m,
        LineTotal = 1.5m,
        Currency = "TND"
    };
}
