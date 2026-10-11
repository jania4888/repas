using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Services.DocumentImport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

/// <summary>
/// La fenêtre de pages ne concerne que Docstrange et l'IA locale. Le parseur natif et les
/// pièces d'au plus 5 pages restent sur les octets d'origine. Une pièce dont le nombre de pages
/// est illisible n'est jamais envoyée à Docstrange.
/// </summary>
public sealed class AccountingDocumentPageWindowTests
{
    private const string VerbatimJson = """
        {
          "documentType": "INVOICE",
          "documentNumber": "FA-2026-0042",
          "issueDate": "2026-03-11",
          "currency": "TND",
          "seller": { "name": "FOURNISSEUR DEMO" },
          "lines": [
            { "designation": "Prestation", "quantity": "2", "unitPriceHt": "625,250", "vatRatePercent": "19" }
          ],
          "totalHt": "1 250,500",
          "totalVat": "237,595",
          "totalTtc": "1488,095",
          "confidence": "high",
          "warnings": ["Contrôle du tiers."]
        }
        """;

    [Fact]
    public async Task External_reader_receives_only_the_head_and_tail_of_a_long_pdf()
    {
        var original = InvoicePageMarkPdf.Create(8);
        byte[]? sent = null;
        var provider = AvailableProvider(Result.Success(VerbatimJson), captured => sent = captured);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(original, "long.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(sent);
        Assert.NotEqual(original, sent);
        var texts = InvoicePageMarkPdf.ReadTexts(sent!);
        Assert.Equal(5, texts.Count);
        Assert.Contains(InvoicePageMarkPdf.Mark(1), texts[0]);
        Assert.Contains(InvoicePageMarkPdf.Mark(8), texts[4]);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(4), string.Join("\n", texts));
        Assert.Contains(
            InvoicePdfReadingWindow.DescribeSkippedPages(8, new[] { 1, 2, 6, 7, 8 }),
            result.Value.Warnings);
        Assert.Contains("Contrôle du tiers.", result.Value.Warnings);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("seule une partie a été analysée", StringComparison.Ordinal));
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task External_reader_receives_a_five_page_pdf_unchanged_and_without_warning()
    {
        var original = InvoicePageMarkPdf.Create(5);
        byte[]? sent = null;
        var provider = AvailableProvider(Result.Success(VerbatimJson), captured => sent = captured);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(original, "court.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(original, sent);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("pages intermédiaires", StringComparison.Ordinal));
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task External_reader_receives_five_pages_of_a_six_page_pdf_with_a_singular_warning()
    {
        var original = InvoicePageMarkPdf.Create(6);
        byte[]? sent = null;
        string? sentContentType = null;
        var provider = AvailableProvider(Result.Success(VerbatimJson), captured => sent = captured,
            contentType => sentContentType = contentType);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(
            Request(original, "six.pdf", "application/octet-stream"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var texts = InvoicePageMarkPdf.ReadTexts(sent!);
        Assert.Equal(5, texts.Count);
        Assert.DoesNotContain(InvoicePageMarkPdf.Mark(3), string.Join("\n", texts));
        Assert.Equal("application/pdf", sentContentType);
        Assert.Contains(
            InvoicePdfReadingWindow.DescribeSkippedPages(6, new[] { 1, 2, 4, 5, 6 }),
            result.Value.Warnings);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Local_ai_receives_five_pages_of_a_six_page_pdf()
    {
        var original = InvoicePageMarkPdf.Create(6);
        byte[]? sent = null;
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .Callback<AiStructuredExtractionRequest, CancellationToken>((request, _) => sent = ReadAll(request.FileStream))
            .ReturnsAsync(Result.Success(Outcome(VerbatimJson)));

        var result = await CreateSut(pipeline, provider: null).ExtractAsync(Request(original, "six.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(5, InvoicePageMarkPdf.ReadTexts(sent!).Count);
    }

    [Fact]
    public async Task External_reader_keeps_the_declared_content_type_when_no_window_is_applied()
    {
        var original = InvoicePageMarkPdf.Create(2);
        string? sentContentType = null;
        var provider = AvailableProvider(Result.Success(VerbatimJson), _ => { }, contentType => sentContentType = contentType);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(
            Request(original, "court.pdf", "application/x-pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("application/x-pdf", sentContentType);
    }

    [Fact]
    public async Task External_reader_receives_a_non_pdf_unchanged()
    {
        var png = Encoding.ASCII.GetBytes("\x89PNG\r\nfacture");
        byte[]? sent = null;
        var provider = AvailableProvider(Result.Success(VerbatimJson), captured => sent = captured);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(
            Request(png, "facture.png", "image/png"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(png, sent);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("pages intermédiaires", StringComparison.Ordinal));
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task External_reader_refuses_an_unreadable_pdf_and_sends_nothing()
    {
        var garbage = Encoding.ASCII.GetBytes("%PDF-1.7 corrompu");
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(garbage, "illisible.pdf"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(InvoicePdfReadingWindow.PageCountUnavailableMessage, result.Error.Description);
        provider.Verify(x => x.ExtractStructuredAsync(
            It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()),
            Times.Never);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Local_ai_still_reads_an_unreadable_pdf_as_is_when_the_provider_is_inactive()
    {
        var garbage = Encoding.ASCII.GetBytes("%PDF-1.7 corrompu");
        byte[]? sent = null;
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .Callback<AiStructuredExtractionRequest, CancellationToken>((request, _) => sent = ReadAll(request.FileStream))
            .ReturnsAsync(Result.Success(Outcome(VerbatimJson)));

        var result = await CreateSut(pipeline, provider: null).ExtractAsync(Request(garbage, "illisible.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(garbage, sent);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("pages intermédiaires", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Failed_reduction_does_not_send_the_full_pdf()
    {
        var original = InvoicePageMarkPdf.Create(8);
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);
        var window = new InvoicePdfPageWindow((_, _, _) => throw new InvalidOperationException("boom-secret"));

        var result = await CreateSut(pipeline, provider, window).ExtractAsync(
            Request(original, "long.pdf"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(InvoicePdfReadingWindow.ReductionFailedMessage, result.Error.Description);
        Assert.DoesNotContain("boom-secret", result.Error.Description, StringComparison.Ordinal);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Local_ai_receives_the_reduced_pdf_when_the_native_parser_does_not_apply()
    {
        var original = InvoicePageMarkPdf.Create(8);
        byte[]? sent = null;
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .Callback<AiStructuredExtractionRequest, CancellationToken>((request, _) => sent = ReadAll(request.FileStream))
            .ReturnsAsync(Result.Success(Outcome(VerbatimJson)));

        var result = await CreateSut(pipeline, provider: null).ExtractAsync(Request(original, "long.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(AccountingDocumentExtractionMethods.LlmText, result.Value.ExtractionMethod);
        Assert.NotNull(sent);
        Assert.Equal(5, InvoicePageMarkPdf.ReadTexts(sent!).Count);
        Assert.Contains(
            InvoicePdfReadingWindow.DescribeSkippedPages(8, new[] { 1, 2, 6, 7, 8 }),
            result.Value.Warnings);
    }

    [Fact]
    public async Task Inactive_provider_reads_an_InstaFact_invoice_natively_without_the_page_window()
    {
        var fixture = File.ReadAllBytes(Path.Combine(
            AppContext.BaseDirectory, "Fixtures", "accounting-documents", "Facture_FAC-2026-000012.pdf"));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);
        var window = new ExplodingPageWindow();

        var result = await CreateSut(pipeline, provider: null, window).ExtractAsync(
            Request(fixture, "Facture_FAC-2026-000012.pdf"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(AccountingDocumentExtractionMethods.NativePdf, result.Value.ExtractionMethod);
        Assert.Equal(0, window.Calls);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("pages intermédiaires", StringComparison.Ordinal));
        pipeline.VerifyNoOtherCalls();
    }

    private static AccountingDocumentExtractionRequest Request(byte[] bytes, string fileName, string contentType = "application/pdf") =>
        new()
        {
            FileStream = new MemoryStream(bytes),
            FileName = fileName,
            ContentType = contentType,
            AllowAiFallback = true
        };

    private static Mock<IDocumentExtractionProvider> AvailableProvider(
        Result<string> answer,
        Action<byte[]> capture,
        Action<string>? captureContentType = null)
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .Callback<Stream, string, string, JsonElement, CancellationToken>((stream, _, contentType, _, _) =>
            {
                capture(ReadAll(stream));
                captureContentType?.Invoke(contentType);
            })
            .ReturnsAsync(answer);
        return provider;
    }

    private static AiStructuredExtractionOutcome Outcome(string raw) => new(
        raw,
        new AiDocumentExtractionResult { Success = true, Format = "pdf", OcrApplied = false, Text = "FACTURE", PageCount = 5 },
        false,
        "ollama:qwen2.5:7b-instruct",
        VisionUsed: false,
        1,
        10);

    private static byte[] ReadAll(Stream stream)
    {
        if (stream.CanSeek)
            stream.Position = 0;
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    private static AccountingDocumentExtractor CreateSut(
        Mock<IAiStructuredExtractionPipeline> pipeline,
        Mock<IDocumentExtractionProvider>? provider,
        IInvoicePdfPageWindow? pageWindow = null) =>
        new(
            new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance),
            pipeline.Object,
            Options.Create(new OllamaSettings()),
            NullLogger<AccountingDocumentExtractor>.Instance,
            provider?.Object,
            pageWindow);

    private sealed class ExplodingPageWindow : IInvoicePdfPageWindow
    {
        public int Calls { get; private set; }

        public InvoicePdfReading Prepare(byte[] original)
        {
            Calls++;
            throw new InvalidOperationException("la fenêtre ne doit pas être appelée");
        }
    }
}
