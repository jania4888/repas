using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class ImportAiModelResolutionServiceTests
{
    private const string GlmOcr = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";

    [Fact]
    public async Task ResolveAsync_prefers_platform_import_model()
    {
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync($"ollama:{GlmOcr}");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Options.Create(new OllamaSettings { InvoiceImportModel = "qwen2.5:7b-instruct" }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var resolution = await service.ResolveAsync(null);

        Assert.Equal(DocumentImportModelSource.Platform, resolution.Source);
        Assert.Equal(ImportVisionStrategy.GlmOcrOptimized, resolution.VisionStrategy);
        Assert.True(resolution.IsVisionCapable);
    }

    [Fact]
    public async Task ResolveEffectiveVisionModelIdAsync_uses_platform_when_not_legacy()
    {
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync($"ollama:{GlmOcr}");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Options.Create(new OllamaSettings { HonorLegacyImportVisionModels = false }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var vision = await service.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: true);

        Assert.Equal(GlmOcr, vision);
    }

    [Fact]
    public async Task ResolveEffectiveVisionModelIdAsync_legacy_appsettings_when_flag_on()
    {
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("ollama:qwen2.5:3b-instruct");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Options.Create(new OllamaSettings
            {
                HonorLegacyImportVisionModels = true,
                BankStatementImportVisionModel = GlmOcr
            }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var vision = await service.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: true);

        Assert.Equal(GlmOcr, vision);
    }
}
