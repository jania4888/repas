using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Hangfire;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Disponibilité de la lecture IA avant lancement (décision D2, plan §3.5) : le repli sur le modèle
/// texte est explicite (raison + code) et jamais silencieux ; sans vision ni texte, l'import est
/// indisponible avec un code exploitable par l'API et le frontend.
/// </summary>
public sealed class BankStatementAiExtractionAvailabilityTests
{
    private const string TextModel = "qwen2.5:7b-instruct";
    private const string VisionModel = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";

    private static (BankStatementAiExtraction Service, Mock<IAiStructuredExtractionPipeline> Pipeline,
        Mock<IOllamaClient> Ollama, Mock<IOllamaModelReadinessChecker> Readiness) Sut(
            bool visionEnabled = true, string? visionModel = VisionModel, bool allowExternal = false)
    {
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(p => p.ResolveModelRefAsync(null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ModelRef.Parse(TextModel));

        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(o => o.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var readiness = new Mock<IOllamaModelReadinessChecker>();

        var ollamaSettings = Options.Create(new OllamaSettings { BankStatementImportVisionModel = visionModel ?? string.Empty });
        var accounting = Options.Create(new AccountingSettings
        {
            BankStatementImport = new BankStatementImportLimits
            {
                VisionReadingEnabled = visionEnabled,
                AiComplementAllowExternal = allowExternal
            }
        });

        var service = new BankStatementAiExtraction(
            pipeline.Object, ollama.Object, readiness.Object, Mock.Of<IBackgroundJobClient>(),
            NullLogger<BankStatementAiExtraction>.Instance, ollamaSettings, accounting);

        return (service, pipeline, ollama, readiness);
    }

    private static OllamaModelReadinessResult Ready => new(true, null, null, null);
    private static OllamaModelReadinessResult NotReady(string message) => new(false, message, 12, 4);

    [Fact]
    public async Task Vision_ready_gives_the_vision_engine_without_reason()
    {
        var (service, _, _, readiness) = Sut();
        readiness.Setup(r => r.CheckAsync(VisionModel, It.IsAny<CancellationToken>())).ReturnsAsync(Ready);

        var availability = await service.CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal(BankStatementAiEngines.Vision, availability.Engine);
        Assert.True(availability.IsVision);
        Assert.Equal($"ollama:{VisionModel}", availability.VisionModelRef);
        Assert.Null(availability.VisionUnavailableReason);
        Assert.Null(availability.ReasonCode);
    }

    [Fact]
    public async Task Vision_not_ready_falls_back_to_text_with_an_explicit_reason()
    {
        var (service, _, _, readiness) = Sut();
        readiness.Setup(r => r.CheckAsync(VisionModel, It.IsAny<CancellationToken>()))
            .ReturnsAsync(NotReady("Le modèle GLM-OCR demande 12 Gio, 4 Gio disponibles."));
        readiness.Setup(r => r.CheckAsync(TextModel, It.IsAny<CancellationToken>())).ReturnsAsync(Ready);

        var availability = await service.CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal(BankStatementAiEngines.Text, availability.Engine);
        Assert.False(availability.IsVision);
        Assert.Equal("Le modèle GLM-OCR demande 12 Gio, 4 Gio disponibles.", availability.VisionUnavailableReason);
        Assert.Equal(BankStatementAiAvailabilityReasons.VisionModelUnavailable, availability.ReasonCode);
    }

    [Fact]
    public async Task Vision_and_text_unavailable_make_the_import_unavailable_with_a_reason_code()
    {
        var (service, _, _, readiness) = Sut();
        readiness.Setup(r => r.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(NotReady("modèle absent"));

        var availability = await service.CheckAvailabilityAsync();

        Assert.False(availability.Available);
        Assert.Equal(BankStatementAiAvailabilityReasons.TextModelUnavailable, availability.ReasonCode);
        Assert.False(string.IsNullOrWhiteSpace(availability.VisionUnavailableReason));
    }

    [Fact]
    public async Task An_unavailable_engine_is_explicit()
    {
        var (service, _, ollama, _) = Sut();
        ollama.Setup(o => o.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var availability = await service.CheckAvailabilityAsync();

        Assert.False(availability.Available);
        Assert.Equal(BankStatementAiAvailabilityReasons.EngineUnavailable, availability.ReasonCode);
    }

    [Fact]
    public async Task No_text_model_configured_is_explicit()
    {
        var (service, pipeline, _, _) = Sut();
        pipeline.Setup(p => p.ResolveModelRefAsync(null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ModelRef.Parse((string?)null));

        var availability = await service.CheckAvailabilityAsync();

        Assert.False(availability.Available);
        Assert.Equal(BankStatementAiAvailabilityReasons.TextModelUnavailable, availability.ReasonCode);
    }

    [Fact]
    public async Task An_external_vision_model_is_rejected_when_external_ai_is_not_allowed()
    {
        var (service, _, _, _) = Sut(visionModel: "openrouter:qwen/qwen-vl-max");

        var availability = await service.CheckAvailabilityAsync();

        Assert.False(availability.Available);
        Assert.Equal(BankStatementAiAvailabilityReasons.ExternalNotAllowed, availability.ReasonCode);
    }

    [Fact]
    public async Task Vision_disabled_or_unconfigured_falls_back_to_text_with_a_reason()
    {
        var (service, _, _, readiness) = Sut(visionModel: null);
        readiness.Setup(r => r.CheckAsync(TextModel, It.IsAny<CancellationToken>())).ReturnsAsync(Ready);

        var availability = await service.CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal(BankStatementAiEngines.Text, availability.Engine);
        Assert.Equal(BankStatementAiAvailabilityReasons.VisionModelUnavailable, availability.ReasonCode);
        Assert.NotNull(availability.VisionUnavailableReason);
    }
}
