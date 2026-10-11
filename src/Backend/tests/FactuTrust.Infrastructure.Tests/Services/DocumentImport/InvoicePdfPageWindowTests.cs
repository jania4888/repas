using System.Text;
using FactuTrust.Infrastructure.Services.DocumentImport;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using UglyToad.PdfPig;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

public sealed class InvoicePdfPageWindowTests
{
    [Fact]
    public void Prepare_eight_pages_keeps_the_first_two_and_the_last_three()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var snapshot = original.ToArray();

        var reading = new InvoicePdfPageWindow().Prepare(original);

        Assert.False(reading.IsFailure);
        Assert.True(reading.WindowApplied);
        Assert.Equal(8, reading.SourcePageCount);
        Assert.Equal(new[] { 1, 2, 6, 7, 8 }, reading.PagesRead.ToArray());
        Assert.Equal(snapshot, original);
        Assert.NotSame(original, reading.Bytes);

        var texts = InvoicePageMarkPdf.ReadTexts(reading.Bytes);
        Assert.Equal(5, texts.Count);
        Assert.Contains(InvoicePageMarkPdf.Mark(1), texts[0]);
        Assert.Contains(InvoicePageMarkPdf.Mark(2), texts[1]);
        Assert.Contains(InvoicePageMarkPdf.Mark(6), texts[2]);
        Assert.Contains(InvoicePageMarkPdf.Mark(7), texts[3]);
        Assert.Contains(InvoicePageMarkPdf.Mark(8), texts[4]);
        var joined = string.Join("\n", texts);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(3), joined);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(4), joined);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(5), joined);
    }

    [Fact]
    public void Prepare_six_pages_keeps_the_first_two_and_the_last_three()
    {
        var original = InvoicePageMarkPdf.Create(6);

        var reading = new InvoicePdfPageWindow().Prepare(original);

        Assert.True(reading.WindowApplied);
        Assert.Equal(6, reading.SourcePageCount);
        Assert.Equal(new[] { 1, 2, 4, 5, 6 }, reading.PagesRead.ToArray());
        var texts = InvoicePageMarkPdf.ReadTexts(reading.Bytes);
        Assert.Equal(5, texts.Count);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(3), string.Join("\n", texts));
    }

    [Fact]
    public void Prepare_five_pages_returns_the_original_bytes()
    {
        var called = false;
        var original = InvoicePageMarkPdf.Create(5);
        var window = new InvoicePdfPageWindow((_, _, _) =>
        {
            called = true;
            throw new InvalidOperationException("ne doit pas réduire");
        });

        var reading = window.Prepare(original);

        Assert.False(called);
        Assert.False(reading.WindowApplied);
        Assert.False(reading.IsFailure);
        Assert.False(reading.PageCountUnavailable);
        Assert.Same(original, reading.Bytes);
        Assert.Equal(5, reading.SourcePageCount);
    }

    [Fact]
    public void Prepare_non_pdf_returns_the_same_bytes()
    {
        var png = Encoding.ASCII.GetBytes("\x89PNG\r\nnot-a-pdf");

        var reading = new InvoicePdfPageWindow().Prepare(png);

        Assert.Same(png, reading.Bytes);
        Assert.False(reading.WindowApplied);
        Assert.False(reading.PageCountUnavailable);
        Assert.False(reading.IsFailure);
    }

    [Fact]
    public void Prepare_unreadable_pdf_keeps_the_original_without_claiming_a_window()
    {
        var garbage = Encoding.ASCII.GetBytes("%PDF-1.7 this is not a readable document");

        var reading = new InvoicePdfPageWindow().Prepare(garbage);

        Assert.Same(garbage, reading.Bytes);
        Assert.True(reading.PageCountUnavailable);
        Assert.False(reading.WindowApplied);
        Assert.False(reading.IsFailure);
        Assert.NotNull(reading.CountFailure);
    }

    [Fact]
    public void Prepare_when_reduction_throws_does_not_return_the_original()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var window = new InvoicePdfPageWindow((_, _, _) =>
            throw new InvalidOperationException("boom-secret"));

        var reading = window.Prepare(original);

        Assert.True(reading.IsFailure);
        Assert.False(reading.WindowApplied);
        Assert.Empty(reading.Bytes);
        Assert.NotSame(original, reading.Bytes);
        Assert.Equal(8, reading.SourcePageCount);
        Assert.Contains("boom-secret", reading.Failure!.Message, StringComparison.Ordinal);
    }
}

internal static class InvoicePageMarkPdf
{
    private static readonly object Gate = new();

    static InvoicePageMarkPdf()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static string Mark(int pageNumber) => $"MARK{pageNumber:00}";

    public static byte[] Create(int pageCount)
    {
        lock (Gate)
        {
            return Document.Create(container =>
            {
                for (var pageNumber = 1; pageNumber <= pageCount; pageNumber++)
                {
                    var mark = Mark(pageNumber);
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4);
                        page.Margin(40);
                        page.Content().Text(mark);
                    });
                }
            }).GeneratePdf();
        }
    }

    public static IReadOnlyList<string> ReadTexts(byte[] pdf)
    {
        using var document = PdfDocument.Open(pdf);
        return document.GetPages().Select(page => page.Text).ToList();
    }
}
