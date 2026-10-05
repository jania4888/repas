using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Contrôle de santé « ollama-bank-statement-vision » (plan GLM-OCR §4.5 / §7.1) : Unhealthy quand le
/// moteur IA ne répond pas, Degraded quand le modèle vision des relevés n'est pas prêt mais que le
/// repli texte l'est, Healthy quand GLM-OCR est prêt. La description ne porte que des noms de modèles.
/// </summary>
public sealed class OllamaVisionModelHealthCheckTests
{
    private const string GlmOcr = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";
    private const string TextModel = "qwen2.5:7b-instruct";

    private readonly Mock<IOllamaClient> _client = new();
    private readonly Mock<IOllamaModelReadinessChecker> _readiness = new();
    private readonly OllamaSettings _ollama = new()
    {
        InvoiceImportModel = TextModel,
        InvoiceImportVisionModel = GlmOcr,
        BankStatementImportVisionModel = GlmOcr,
    };
    private readonly AccountingSettings _accounting = new()
    {
        BankStatementImport = new BankStatementImportLimits { VisionReadingEnabled = true },
    };

    public OllamaVisionModelHealthCheckTests()
    {
        _client.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        SetReady(TextModel, ready: true);
        SetReady(GlmOcr, ready: true);
    }

    private void SetReady(string model, bool ready, string? message = null) =>
        _readiness
            .Setup(r => r.CheckAsync(model, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(
                ready,
                ready ? null : message ?? $"Le modèle « {model} » n'est pas installé sur le moteur IA InstaFact.",
                null,
                null));

    private OllamaVisionModelHealthCheck CreateSut() =>
        new(_client.Object, _readiness.Object, Options.Create(_ollama), Options.Create(_accounting));

    private static HealthCheckContext Context(HealthStatus failureStatus = HealthStatus.Unhealthy) => new()
    {
        Registration = new HealthCheckRegistration(
            OllamaVisionModelHealthCheck.Name,
            _ => Mock.Of<IHealthCheck>(),
            failureStatus,
            new[] { OllamaVisionModelHealthCheck.Tag }),
    };

    [Fact]
    public async Task Engine_unreachable_is_unhealthy()
    {
        _client.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Unhealthy, result.Status);
        Assert.Contains("injoignable", result.Description);
        _readiness.Verify(r => r.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Vision_model_not_ready_with_text_fallback_ready_is_degraded()
    {
        SetReady(GlmOcr, ready: false);

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains(GlmOcr, result.Description);
        Assert.Contains("n'est pas installé", result.Description);
        Assert.Contains(TextModel, result.Description);
        Assert.Contains("page par page", result.Description);
    }

    [Fact]
    public async Task Vision_model_not_ready_and_text_fallback_not_ready_is_unhealthy()
    {
        SetReady(GlmOcr, ready: false);
        SetReady(TextModel, ready: false, "Le moteur IA InstaFact manque de mémoire.");

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Unhealthy, result.Status);
        Assert.Contains("IA indisponible", result.Description);
    }

    [Fact]
    public async Task Vision_model_ready_is_healthy_and_names_both_models()
    {
        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Healthy, result.Status);
        Assert.Contains(GlmOcr, result.Description);
        Assert.Contains(TextModel, result.Description);
        Assert.Contains("prêt", result.Description);
    }

    [Fact]
    public async Task Vision_reading_disabled_is_degraded_without_probing_the_vision_model()
    {
        _accounting.BankStatementImport.VisionReadingEnabled = false;

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("VisionReadingEnabled=false", result.Description);
        _readiness.Verify(r => r.CheckAsync(GlmOcr, It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Missing_vision_model_is_degraded_and_points_to_the_configuration_keys()
    {
        _ollama.InvoiceImportVisionModel = "";
        _ollama.BankStatementImportVisionModel = "";

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("BankStatementImportVisionModel", result.Description);
    }

    [Fact]
    public async Task Non_ollama_vision_model_is_degraded_because_vision_is_local_only()
    {
        _ollama.BankStatementImportVisionModel = "openrouter:google/gemma-3-27b-it";

        var result = await CreateSut().CheckHealthAsync(Context());

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("hors Ollama", result.Description);
        _readiness.Verify(r => r.CheckAsync("google/gemma-3-27b-it", It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Exceptions_are_reported_as_the_registration_failure_status_not_thrown()
    {
        _client.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new HttpRequestException("boom"));

        var result = await CreateSut().CheckHealthAsync(Context(HealthStatus.Degraded));

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.NotNull(result.Exception);
    }

    [Fact]
    public async Task Startup_check_logs_and_returns_the_same_verdict_through_a_scope()
    {
        SetReady(GlmOcr, ready: false);

        var services = new ServiceCollection();
        services.AddScoped(_ => _client.Object);
        services.AddScoped(_ => _readiness.Object);
        services.AddSingleton(Options.Create(_ollama));
        services.AddSingleton(Options.Create(_accounting));
        await using var provider = services.BuildServiceProvider();

        var hosted = new OllamaVisionModelStartupCheckHostedService(
            provider,
            NullLogger<OllamaVisionModelStartupCheckHostedService>.Instance,
            TimeSpan.Zero);

        var status = await hosted.RunAsync(CancellationToken.None);

        Assert.NotNull(status);
        Assert.Equal(HealthStatus.Degraded, status!.Status);
        Assert.Equal(GlmOcr, status.VisionModel);
        Assert.Equal(TextModel, status.TextModel);
        Assert.False(status.VisionReady);
        Assert.True(status.TextFallbackReady);
    }

    [Fact]
    public async Task Startup_check_is_skipped_when_vision_reading_is_disabled()
    {
        _accounting.BankStatementImport.VisionReadingEnabled = false;

        var services = new ServiceCollection();
        services.AddScoped(_ => _client.Object);
        services.AddScoped(_ => _readiness.Object);
        services.AddSingleton(Options.Create(_ollama));
        services.AddSingleton(Options.Create(_accounting));
        await using var provider = services.BuildServiceProvider();

        var hosted = new OllamaVisionModelStartupCheckHostedService(
            provider,
            NullLogger<OllamaVisionModelStartupCheckHostedService>.Instance,
            TimeSpan.Zero);

        Assert.Null(await hosted.RunAsync(CancellationToken.None));
        _client.Verify(c => c.IsAvailableAsync(It.IsAny<CancellationToken>()), Times.Never);
    }
}
