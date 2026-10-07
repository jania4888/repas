using System.Runtime.CompilerServices;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class InvoiceImportHandlerContractTests
{
    private const string SampleLlmJson = """
        {
          "documentType": "INVOICE",
          "invoiceNumber": "FAC-2026-000093",
          "issueDate": "2026-05-09",
          "dueDate": "2026-06-08",
          "currency": "TND",
          "client": { "name": "Client Test", "nif": null },
          "lines": [
            { "designation": "Prestation", "quantity": 1, "unitPriceHT": 1000, "vatRatePercent": 19 }
          ],
          "totals": { "totalHT": 1000, "totalVat": 190, "totalTTC": 1190 },
          "confidence": "high",
          "warnings": []
        }
        """;

    [Fact]
    public async Task HandleAsync_WithMockedLlm_ReturnsStructuredInvoice()
    {
        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        ollama.Setup(x => x.StreamChatAsync(
                It.IsAny<OllamaChatRequest>(),
                It.IsAny<CancellationToken>(),
                It.IsAny<TimeSpan?>(),
                It.IsAny<bool>()))
            .Returns(MockLlmStream(SampleLlmJson));

        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(x => x.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(true, null, null, 16));

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
                OcrApplied = false,
                PageCount = 1
            });

        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetClientsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<ClientListDto> { Items = [], TotalCount = 0 });
        mediator.Setup(m => m.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = [], TotalCount = 0 }));

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var handler = new ImportInvoiceFromFileHandler(
            ollama.Object,
            Mock.Of<IOpenAiChatCompletionsClient>(),
            extractor.Object,
            readiness.Object,
            platform.Object,
            CreateInferenceResolver(),
            mediator.Object,
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings
            {
                DefaultModel = "qwen2.5:7b-instruct",
                InvoiceImportModel = "qwen2.5:7b-instruct",
                InvoiceImportVisionModel = "llava",
                InvoiceImportVisionOnEmptyOcr = true,
                ImportMaxOutputTokens = 1536,
                ImportLlmTimeoutSeconds = 180
            }));

        await using var stream = new MemoryStream([0x25, 0x50, 0x44, 0x46]); // minimal trigger
        var command = new ImportInvoiceFromFileCommand(stream, "test.pdf", "application/pdf");
        var result = await handler.HandleAsync(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("FAC-2026-000093", result.Value.InvoiceNumber);
        Assert.Single(result.Value.Lines);
        Assert.Equal("TND", result.Value.Currency);
    }

    [Fact]
    public async Task WarmUpAsync_WhenModelNotInstalled_ReturnsReadyFalseWithPullMessage()
    {
        var handler = CreateHandlerWithReadiness(new OllamaModelReadinessResult(
            false,
            "Le modèle « qwen2.5:7b-instruct » n'est pas installé sur le moteur IA InstaFact. Contactez l'administrateur plateforme ou choisissez un autre modèle.",
            null,
            27.2));

        var result = await handler.WarmUpAsync(CancellationToken.None);

        Assert.True(result.Accepted);
        Assert.False(result.Ready);
        Assert.Equal("qwen2.5:7b-instruct", result.Model);
        Assert.Contains("moteur IA InstaFact", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task WarmUpAsync_WhenPlatformSettingsFails_UsesAppsettingsModel()
    {
        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        ollama.Setup(x => x.WarmUpModelAsync(
                "qwen2.5:7b-instruct",
                It.IsAny<string>(),
                It.IsAny<CancellationToken>(),
                It.IsAny<int?>(),
                It.IsAny<int?>(),
                It.IsAny<OllamaInferenceProfile?>()))
            .ReturnsAsync(true);

        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(x => x.CheckAsync("qwen2.5:7b-instruct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(true, null, null, 27.2));

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Simulated DB failure"));

        var handler = new ImportInvoiceFromFileHandler(
            ollama.Object,
            Mock.Of<IOpenAiChatCompletionsClient>(),
            Mock.Of<IAiDocumentTextExtractor>(),
            readiness.Object,
            platform.Object,
            CreateInferenceResolver(),
            Mock.Of<IMediator>(),
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings
            {
                InvoiceImportModel = "qwen2.5:7b-instruct",
                KeepAliveMinutes = 30
            }));

        var result = await handler.WarmUpAsync(CancellationToken.None);

        Assert.True(result.Accepted);
        Assert.True(result.Ready);
        Assert.Equal("qwen2.5:7b-instruct", result.Model);
    }

    [Fact]
    public async Task WarmUpAsync_CpuOnlyMode_PassesNumGpuZeroProfile()
    {
        OllamaInferenceProfile? capturedProfile = null;
        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(x => x.WarmUpModelAsync(
                "qwen2.5:7b-instruct",
                It.IsAny<string>(),
                It.IsAny<CancellationToken>(),
                It.IsAny<int?>(),
                It.IsAny<int?>(),
                It.IsAny<OllamaInferenceProfile?>()))
            .Callback<string, string?, CancellationToken, int?, int?, OllamaInferenceProfile?>(
                (_, _, _, _, _, profile) => capturedProfile = profile)
            .ReturnsAsync(true);

        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(x => x.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(true, null, null, 27.2));

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var handler = new ImportInvoiceFromFileHandler(
            ollama.Object,
            Mock.Of<IOpenAiChatCompletionsClient>(),
            Mock.Of<IAiDocumentTextExtractor>(),
            readiness.Object,
            platform.Object,
            CreateInferenceResolver(OllamaInferenceDevice.CpuOnly),
            Mock.Of<IMediator>(),
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings { InvoiceImportModel = "qwen2.5:7b-instruct" }));

        var result = await handler.WarmUpAsync(CancellationToken.None);

        Assert.True(result.Ready);
        Assert.NotNull(capturedProfile);
        Assert.Equal(OllamaInferenceDevice.CpuOnly, capturedProfile!.Device);
        Assert.Equal(0, capturedProfile.NumGpu);
    }

    [Fact]
    public async Task HandleAsync_ImageWithEmptyOcr_UsesVisionModelWhenConfigured()
    {
        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var visionCalled = false;
        ollama.Setup(x => x.StreamChatAsync(
                It.Is<OllamaChatRequest>(r => r.Model == "llava"),
                It.IsAny<CancellationToken>(),
                It.IsAny<TimeSpan?>(),
                It.IsAny<bool>()))
            .Returns(MockLlmStream(SampleLlmJson))
            .Callback(() => visionCalled = true);

        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(x => x.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(true, null, null, 16));

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
                Text = string.Empty,
                Format = "image",
                OcrApplied = true,
                PageCount = 1,
                Pages =
                [
                    new AiDocumentExtractedPage
                    {
                        PageIndex = 0,
                        Text = string.Empty,
                        ImageBase64 = Convert.ToBase64String([1, 2, 3]),
                        OcrApplied = true
                    }
                ]
            });

        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetClientsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<ClientListDto> { Items = [], TotalCount = 0 });
        mediator.Setup(m => m.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = [], TotalCount = 0 }));

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var handler = new ImportInvoiceFromFileHandler(
            ollama.Object,
            Mock.Of<IOpenAiChatCompletionsClient>(),
            extractor.Object,
            readiness.Object,
            platform.Object,
            CreateInferenceResolver(),
            mediator.Object,
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings
            {
                InvoiceImportModel = "qwen2.5:7b-instruct",
                InvoiceImportVisionModel = "llava",
                InvoiceImportVisionOnEmptyOcr = true,
                // Le modele vision de ce scenario vient des cles appsettings, que le commit
                // 4064593c n'honore plus que sous ce drapeau : le test couvre ce chemin precis.
                HonorLegacyImportVisionModels = true
            }));

        await using var stream = new MemoryStream([0x89, 0x50, 0x4E, 0x47]);
        var command = new ImportInvoiceFromFileCommand(stream, "bl.png", "image/png");
        var result = await handler.HandleAsync(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(visionCalled);
    }

    private static ImportInvoiceFromFileHandler CreateHandlerWithReadiness(OllamaModelReadinessResult readinessResult)
    {
        var ollama = new Mock<IOllamaClient>();
        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(x => x.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(readinessResult);

        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        return new ImportInvoiceFromFileHandler(
            ollama.Object,
            Mock.Of<IOpenAiChatCompletionsClient>(),
            Mock.Of<IAiDocumentTextExtractor>(),
            readiness.Object,
            platform.Object,
            CreateInferenceResolver(),
            Mock.Of<IMediator>(),
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings { InvoiceImportModel = "qwen2.5:7b-instruct" }));
    }

    private static IOllamaInferenceProfileResolver CreateInferenceResolver(
        OllamaInferenceDevice device = OllamaInferenceDevice.Gpu)
    {
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInferenceDeviceAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(device);
        return new OllamaInferenceProfileResolver(platform.Object, Options.Create(new OllamaSettings()));
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
