using System.Text;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Services.DocumentImport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class AccountingDocumentExtractorVisionRetryTests
{
    private const string ValidJson = """
        {
          "documentType": "INVOICE",
          "documentNumber": "68",
          "issueDate": "2024-03-16",
          "currency": "TND",
          "seller": { "name": "E-info" },
          "buyer": { "name": "Mohamed" },
          "lines": [{ "designation": "Article", "quantity": 1, "unitPriceHt": 100, "vatRatePercent": 7 }],
          "vatBreakdown": [{ "ratePercent": 7, "baseAmount": 100, "vatAmount": 7 }],
          "totalHt": 100,
          "totalVat": 7,
          "totalTtc": 107,
          "confidence": "medium",
          "warnings": []
        }
        """;

    [Fact]
    public async Task ExtractAsync_retries_with_force_vision_when_text_json_invalid()
    {
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        var textOutcome = new AiStructuredExtractionOutcome(
            "not json at all",
            new AiDocumentExtractionResult
            {
                Success = true,
                Format = "image",
                OcrApplied = true,
                Text = "FACTURE",
                Pages = [new AiDocumentExtractedPage { ImageBase64 = "aW1hZ2U=" }]
            },
            false,
            "qwen2.5:7b-instruct",
            VisionUsed: false,
            1,
            10);

        var visionOutcome = new AiStructuredExtractionOutcome(
            ValidJson,
            textOutcome.Extraction,
            false,
            "gemma3:4b",
            VisionUsed: true,
            1,
            20);

        // Depuis le commit 4064593c, la porte de repli vision interroge le pipeline au lieu de lire
        // OllamaSettings.InvoiceImportVisionModel : sans ce stub, elle rend null et aucun repli n'a lieu.
        pipeline.Setup(x => x.ResolveEffectiveVisionModelIdAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("ollama:gemma3:4b");

        var call = 0;
        pipeline.Setup(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                call++;
                return call == 1
                    ? Result.Success(textOutcome)
                    : Result.Success(visionOutcome);
            });

        var extractor = new AccountingDocumentExtractor(
            new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance),
            pipeline.Object,
            Options.Create(new OllamaSettings
            {
                InvoiceImportVisionModel = "gemma3:4b",
                InvoiceImportVisionOnImages = false
            }),
            NullLogger<AccountingDocumentExtractor>.Instance);

        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("fake-image"));
        var result = await extractor.ExtractAsync(
            new AccountingDocumentExtractionRequest
            {
                FileStream = stream,
                FileName = "facture.png",
                ContentType = "image/png",
                AllowAiFallback = true
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("68", result.Value.DocumentNumber);
        Assert.Equal(2, call);
        pipeline.Verify(
            x => x.RunAsync(
                It.Is<AiStructuredExtractionRequest>(r => r.ForceVision),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
