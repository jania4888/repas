using System.Runtime.CompilerServices;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class ImportBankStatementLlmProviderTests
{
    private const string SampleJson = """
        {
          "bankName": "BIAT",
          "rib": "01001001111111111111",
          "holderName": "ACME",
          "periodStart": "2026-01-01",
          "periodEnd": "2026-01-31",
          "statementDate": "2026-02-01",
          "openingBalance": 1000,
          "closingBalance": 900,
          "currency": "TND",
          "lines": [
            {
              "transactionDate": "2026-01-15",
              "valueDate": "2026-01-15",
              "reference": "VIR",
              "description": "Loyer",
              "amount": 100,
              "isDebit": true
            }
          ],
          "confidence": "high",
          "warnings": []
        }
        """;

    [Fact]
    public async Task ExtractAsync_OpenRouter_UsesChatCompletionsClient()
    {
        var openAi = new Mock<IOpenAiChatCompletionsClient>();
        openAi.Setup(x => x.StreamChatAsOllamaCompatibleAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<IReadOnlyList<OpenAiChatMessagePayload>>(),
                It.IsAny<IReadOnlyList<OllamaToolDefinition>>(),
                It.IsAny<double>(),
                It.IsAny<int>(),
                It.IsAny<CancellationToken>(),
                It.IsAny<int?>(),
                It.IsAny<OpenAiCompatibleCallOptions?>()))
            .Returns(MockLlmStream(SampleJson));

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("openrouter:anthropic/claude-3.5-sonnet");
        platform.Setup(x => x.GetOpenRouterCredentialsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlatformOpenRouterCredentials(true, "sk-or-test", "https://openrouter.ai/api/v1"));

        var handler = CreateHandler(openAi.Object, platform.Object, cursor: null);
        var result = await handler.ExtractAsync(
            [0x25, 0x50, 0x44, 0x46],
            "releve.pdf",
            "application/pdf",
            new AiDocumentExtractionResult { Success = true, Text = "RELEVE BIAT", Format = "pdf" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("BIAT", result.Value.BankName);
        Assert.Single(result.Value.Lines);
        openAi.Verify(x => x.StreamChatAsOllamaCompatibleAsync(
            It.IsAny<string>(),
            "sk-or-test",
            "anthropic/claude-3.5-sonnet",
            It.IsAny<IReadOnlyList<OpenAiChatMessagePayload>>(),
            It.IsAny<IReadOnlyList<OllamaToolDefinition>>(),
            It.IsAny<double>(),
            It.IsAny<int>(),
            It.IsAny<CancellationToken>(),
            It.IsAny<int?>(),
            It.IsAny<OpenAiCompatibleCallOptions?>()), Times.Once);
    }

    [Fact]
    public async Task ExtractAsync_Cursor_UsesExtractClient()
    {
        var cursor = new Mock<ICursorAgentClient>();
        cursor.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        cursor.Setup(x => x.ExtractAsync(It.IsAny<CursorExtractRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(SampleJson);

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("cursor:composer-2.5");
        platform.Setup(x => x.GetCursorCredentialsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PlatformCursorCredentials(true, "cursor_test_key"));

        var handler = CreateHandler(Mock.Of<IOpenAiChatCompletionsClient>(), platform.Object, cursor.Object);
        var result = await handler.ExtractAsync(
            [0x25, 0x50, 0x44, 0x46],
            "releve.pdf",
            "application/pdf",
            new AiDocumentExtractionResult { Success = true, Text = "RELEVE BIAT", Format = "pdf" },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("BIAT", result.Value.BankName);
        cursor.Verify(x => x.ExtractAsync(
            It.Is<CursorExtractRequest>(r => r.Model.Kind == LlmProviderKind.Cursor),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    private static ImportBankStatementFromFileHandler CreateHandler(
        IOpenAiChatCompletionsClient openAi,
        IPlatformAiSettingsService platform,
        ICursorAgentClient? cursor)
    {
        var resolver = new Mock<IOllamaInferenceProfileResolver>();
        resolver.Setup(x => x.ResolveForPlatformAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaInferenceProfile(OllamaInferenceDevice.Gpu, null, null, null, false));

        var importResolver = new ImportAiModelResolutionService(
            platform,
            NullAiModelVisionProbe.Instance,
            Options.Create(new OllamaSettings()),
            NullLogger<ImportAiModelResolutionService>.Instance);

        return new ImportBankStatementFromFileHandler(
            Mock.Of<IOllamaClient>(),
            openAi,
            Mock.Of<IOllamaModelReadinessChecker>(),
            platform,
            importResolver,
            resolver.Object,
            NullLogger<ImportBankStatementFromFileHandler>.Instance,
            Options.Create(new OllamaSettings()),
            cursor,
            Options.Create(new CursorSdkSettings { Enabled = true }));
    }

    private static async IAsyncEnumerable<OllamaChatChunk> MockLlmStream(
        string json,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        yield return new OllamaChatChunk
        {
            Message = new OllamaChatMessage { Role = "assistant", Content = json },
            Done = true
        };
    }
}
