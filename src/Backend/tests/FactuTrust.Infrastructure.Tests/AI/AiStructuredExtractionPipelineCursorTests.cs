using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class AiStructuredExtractionPipelineCursorTests
{
    private const string SampleJson = """
        {
          "documentType": "INVOICE",
          "invoiceNumber": "FAC-2026-000093",
          "issueDate": "2026-05-09",
          "dueDate": "2026-06-08",
          "currency": "TND",
          "client": { "name": "Client Test" },
          "lines": [
            { "designation": "Prestation", "quantity": 1, "unitPriceHT": 1000, "vatRatePercent": 19 }
          ],
          "totals": { "totalHT": 1000, "totalVat": 190, "totalTTC": 1190 },
          "confidence": "high",
          "warnings": []
        }
        """;

    [Fact]
    public async Task RunAsync_Cursor_UsesExtractClient_AndDoesNotCallOpenRouter()
    {
        var cursor = new Mock<ICursorAgentClient>();
        cursor.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        cursor.Setup(x => x.ExtractAsync(It.IsAny<CursorExtractRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(SampleJson);

        var openAi = new Mock<IOpenAiChatCompletionsClient>(MockBehavior.Strict);
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("cursor:composer-2.5");
        platform.Setup(x => x.GetCursorCredentialsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlatformCursorCredentials(true, "cursor_test_key"));
        platform.Setup(x => x.GetInferenceDeviceAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(OllamaInferenceDevice.Gpu);

        var extractor = new Mock<IAiDocumentTextExtractor>();
        extractor.Setup(x => x.ExtractAsync(
                It.IsAny<Stream>(),
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<AiDocumentExtractOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiDocumentExtractionResult
            {
                Success = true,
                Text = "FACTURE FAC-2026-000093 Client Test",
                Format = "pdf",
                PageCount = 1
            });

        var importResolver = new ImportAiModelResolutionService(
            platform.Object,
            NullAiModelVisionProbe.Instance,
            Options.Create(new OllamaSettings
            {
                InvoiceImportModel = "qwen2.5:7b-instruct",
                ImportMaxOutputTokens = 1536
            }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var pipeline = new AiStructuredExtractionPipeline(
            Mock.Of<IOllamaClient>(),
            openAi.Object,
            extractor.Object,
            Mock.Of<IOllamaModelReadinessChecker>(),
            platform.Object,
            importResolver,
            new OllamaInferenceProfileResolver(platform.Object, Options.Create(new OllamaSettings())),
            NullLogger<AiStructuredExtractionPipeline>.Instance,
            Options.Create(new OllamaSettings
            {
                InvoiceImportModel = "qwen2.5:7b-instruct",
                ImportMaxOutputTokens = 1536
            }),
            Mock.Of<IModalCredentialsResolver>(),
            Mock.Of<ITenantContext>(),
            cursor.Object,
            Options.Create(new CursorSdkSettings { Enabled = true }));

        await using var stream = new MemoryStream([0x25, 0x50, 0x44, 0x46]);
        var result = await pipeline.RunAsync(
            new AiStructuredExtractionRequest
            {
                FileStream = stream,
                FileName = "fac.pdf",
                ContentType = "application/pdf",
                SystemPrompt = "Extract JSON"
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Contains("FAC-2026-000093", result.Value.RawContent);
        cursor.Verify(x => x.ExtractAsync(It.IsAny<CursorExtractRequest>(), It.IsAny<CancellationToken>()), Times.Once);
        openAi.VerifyNoOtherCalls();
    }
}
