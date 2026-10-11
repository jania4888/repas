using System.Text;
using FactuTrust.Infrastructure.Services.DocumentImport;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

/// <summary>
/// Comptage des pages avant toute décision d'envoi : PdfPig d'abord, PdfSharp ensuite.
/// Un nombre de pages inconnu ne doit jamais être confondu avec « petite pièce ».
/// </summary>
public sealed class InvoicePdfPageWindowCountingTests
{
    [Theory]
    [InlineData(5, false, "1,2,3,4,5")]
    [InlineData(6, true, "1,2,4,5,6")]
    [InlineData(7, true, "1,2,5,6,7")]
    [InlineData(66, true, "1,2,64,65,66")]
    public void Prepare_applies_the_window_from_six_pages(int pageCount, bool windowed, string expectedPages)
    {
        var original = InvoicePageMarkPdf.Create(pageCount);
        var snapshot = original.ToArray();

        var reading = new InvoicePdfPageWindow().Prepare(original);

        Assert.False(reading.IsFailure);
        Assert.False(reading.PageCountUnavailable);
        Assert.Equal(pageCount, reading.SourcePageCount);
        Assert.Equal(windowed, reading.WindowApplied);
        Assert.Equal(InvoicePageCountSource.PdfPig, reading.PageCountSource);
        Assert.Equal(snapshot, original);
        if (windowed)
        {
            Assert.Equal(expectedPages, string.Join(",", reading.PagesRead));
            Assert.Equal(5, InvoicePageMarkPdf.ReadTexts(reading.Bytes).Count);
            Assert.Equal(original.Length, reading.OriginalByteCount);
            Assert.Equal(reading.Bytes.Length, reading.ReducedByteCount);
        }
        else
        {
            Assert.Same(original, reading.Bytes);
        }
    }

    [Fact]
    public void Prepare_falls_back_to_PdfSharp_when_PdfPig_cannot_count()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var window = new InvoicePdfPageWindow(
            extractPages: null,
            countWithPdfPig: _ => throw new InvalidOperationException("pdfpig ko"));

        var reading = window.Prepare(original);

        Assert.True(reading.WindowApplied);
        Assert.Equal(8, reading.SourcePageCount);
        Assert.Equal(InvoicePageCountSource.PdfSharp, reading.PageCountSource);
        Assert.Equal(new[] { 1, 2, 6, 7, 8 }, reading.PagesRead.ToArray());
    }

    [Fact]
    public void Prepare_treats_a_non_positive_count_as_a_failure_and_tries_the_other_reader()
    {
        var original = InvoicePageMarkPdf.Create(7);
        var window = new InvoicePdfPageWindow(extractPages: null, countWithPdfPig: _ => 0);

        var reading = window.Prepare(original);

        Assert.True(reading.WindowApplied);
        Assert.Equal(InvoicePageCountSource.PdfSharp, reading.PageCountSource);
    }

    [Fact]
    public void Prepare_reports_both_failures_when_no_reader_can_count()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var window = new InvoicePdfPageWindow(
            extractPages: null,
            countWithPdfPig: _ => throw new InvalidOperationException("pdfpig ko"),
            countWithPdfSharp: _ => throw new InvalidOperationException("pdfsharp ko"));

        var reading = window.Prepare(original);

        Assert.True(reading.PageCountUnavailable);
        Assert.False(reading.WindowApplied);
        Assert.Null(reading.SourcePageCount);
        Assert.Equal(InvoicePageCountSource.None, reading.PageCountSource);
        var aggregate = Assert.IsType<AggregateException>(reading.CountFailure);
        Assert.Equal(2, aggregate.InnerExceptions.Count);
    }

    [Fact]
    public void Prepare_counts_an_owner_password_only_pdf_and_applies_the_window()
    {
        var protectedPdf = Encrypt(InvoicePageMarkPdf.Create(8), userPassword: null, ownerPassword: "proprietaire");

        var reading = new InvoicePdfPageWindow().Prepare(protectedPdf);

        Assert.False(reading.PageCountUnavailable);
        Assert.Equal(8, reading.SourcePageCount);
        Assert.False(reading.IsFailure);
        Assert.True(reading.WindowApplied);
        Assert.Equal(new[] { 1, 2, 6, 7, 8 }, reading.PagesRead.ToArray());
    }

    [Fact]
    public void Prepare_marks_a_user_password_pdf_as_unavailable()
    {
        var protectedPdf = Encrypt(InvoicePageMarkPdf.Create(8), userPassword: "ouverture", ownerPassword: "proprietaire");

        var reading = new InvoicePdfPageWindow().Prepare(protectedPdf);

        Assert.True(reading.PageCountUnavailable);
        Assert.False(reading.WindowApplied);
        Assert.Same(protectedPdf, reading.Bytes);
    }

    [Fact]
    public void Prepare_marks_a_truncated_pdf_as_unavailable()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var truncated = original[..(original.Length / 2)];

        var reading = new InvoicePdfPageWindow().Prepare(truncated);

        Assert.True(reading.PageCountUnavailable);
        Assert.False(reading.WindowApplied);
        Assert.NotNull(reading.CountFailure);
    }

    [Fact]
    public void Prepare_finds_a_pdf_header_preceded_by_a_few_bytes_and_never_lets_it_through_whole()
    {
        var pdf = InvoicePageMarkPdf.Create(8);
        var prefixed = new byte[] { 0xEF, 0xBB, 0xBF, 0x20, 0x0A }.Concat(pdf).ToArray();

        var reading = new InvoicePdfPageWindow().Prepare(prefixed);

        // Le comptage voit les 8 pages : la pièce doit être réduite, ou refusée si la réduction
        // échoue. Jamais le passage intégral réservé aux non-PDF.
        Assert.Equal(8, reading.SourcePageCount);
        Assert.NotSame(prefixed, reading.Bytes);
        Assert.True(reading.WindowApplied || reading.IsFailure);
        if (reading.WindowApplied)
            Assert.Equal(5, InvoicePageMarkPdf.ReadTexts(reading.Bytes).Count);
    }

    [Fact]
    public void Prepare_ignores_a_pdf_marker_beyond_the_header_search_range()
    {
        var bytes = new byte[InvoicePdfPageWindow.PdfHeaderSearchLength]
            .Concat(Encoding.ASCII.GetBytes("%PDF-1.7"))
            .ToArray();

        var reading = new InvoicePdfPageWindow().Prepare(bytes);

        Assert.Same(bytes, reading.Bytes);
        Assert.False(reading.PageCountUnavailable);
        Assert.False(reading.WindowApplied);
    }

    private static byte[] Encrypt(byte[] pdf, string? userPassword, string ownerPassword)
    {
        using var source = PdfReader.Open(new MemoryStream(pdf, writable: false), PdfDocumentOpenMode.Import);
        using var target = new PdfDocument();
        foreach (var page in source.Pages)
            target.AddPage(page);
        if (userPassword is not null)
            target.SecuritySettings.UserPassword = userPassword;
        target.SecuritySettings.OwnerPassword = ownerPassword;
        using var output = new MemoryStream();
        target.Save(output, closeStream: false);
        return output.ToArray();
    }
}
