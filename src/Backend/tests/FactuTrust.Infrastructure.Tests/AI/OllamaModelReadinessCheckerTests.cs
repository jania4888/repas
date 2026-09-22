using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class OllamaModelReadinessCheckerTests
{
    private readonly Mock<IOllamaClient> _ollamaClient = new();
    private readonly Mock<IAiEngineMemoryProbe> _memoryProbe = new();

    public OllamaModelReadinessCheckerTests()
    {
        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        SetEngineMemory(new AiEngineMemorySnapshot(64L << 30, 64L << 30, true));
    }

    private void SetEngineMemory(AiEngineMemorySnapshot snapshot) =>
        _memoryProbe.Setup(p => p.ReadAsync(It.IsAny<CancellationToken>())).ReturnsAsync(snapshot);

    private void SetInstalled(params OllamaModelInfo[] models) =>
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);

    private OllamaModelReadinessChecker CreateSut() =>
        new(_ollamaClient.Object, _memoryProbe.Object,
            NullLogger<OllamaModelReadinessChecker>.Instance);

    [Fact]
    public async Task EmptyModelName_IsNotReady()
    {
        var result = await CreateSut().CheckAsync("  ");

        Assert.False(result.IsReady);
        Assert.Contains("Aucun modèle", result.UserMessage);
    }

    [Fact]
    public async Task EngineUnavailable_IsNotReady()
    {
        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await CreateSut().CheckAsync("gemma3:4b");

        Assert.False(result.IsReady);
        Assert.Contains("indisponible", result.UserMessage);
    }

    [Fact]
    public async Task ModelNotInstalled_IsNotReady()
    {
        SetInstalled(new OllamaModelInfo { Name = "qwen2.5:7b-instruct", Size = 4_683_087_332L });

        var result = await CreateSut().CheckAsync("gemma3:4b");

        Assert.False(result.IsReady);
        Assert.Contains("n'est pas installé", result.UserMessage);
    }

    [Fact]
    public async Task ModelFitsInDeclaredBudget_IsReady()
    {
        SetEngineMemory(new AiEngineMemorySnapshot(12L << 30, 10L << 30, true));
        SetInstalled(new OllamaModelInfo { Name = "glm-ocr:q8_0", Size = 1_700_000_000L });

        var result = await CreateSut().CheckAsync("glm-ocr:q8_0");

        Assert.True(result.IsReady);
        Assert.Null(result.UserMessage);
    }

    [Fact]
    public async Task ModelTooBigForDeclaredBudget_IsNotReadyWithFigures()
    {
        SetEngineMemory(new AiEngineMemorySnapshot(4L << 30, 2L << 30, true));
        SetInstalled(new OllamaModelInfo { Name = "gemma3:4b", Size = 3_338_801_804L });

        var result = await CreateSut().CheckAsync("gemma3:4b");

        Assert.False(result.IsReady);
        Assert.Contains("nécessite environ", result.UserMessage);
        Assert.NotNull(result.RequiredGiB);
        Assert.NotNull(result.AvailableGiB);
    }

    /// <summary>
    /// La régression corrigée : moteur déporté, mémoire non mesurable. Le modèle ne doit
    /// PAS être refusé sur la mémoire du processus API — c'est ce qui bloquait l'import de
    /// facture par photo en production alors qu'Ollama avait la place.
    /// </summary>
    [Fact]
    public async Task MemoryNotMeaningful_LargeModelIsStillReady()
    {
        SetEngineMemory(AiEngineMemorySnapshot.Unknown);
        SetInstalled(new OllamaModelInfo { Name = "gemma3:4b", Size = 3_338_801_804L });

        var result = await CreateSut().CheckAsync("gemma3:4b");

        Assert.True(result.IsReady);
        Assert.Null(result.UserMessage);
        Assert.Null(result.AvailableGiB);
    }

    /// <summary>Le contrôle « modèle installé » reste actif même sans mesure mémoire.</summary>
    [Fact]
    public async Task MemoryNotMeaningful_StillRejectsMissingModel()
    {
        SetEngineMemory(AiEngineMemorySnapshot.Unknown);
        SetInstalled(new OllamaModelInfo { Name = "qwen2.5:7b-instruct", Size = 4_683_087_332L });

        var result = await CreateSut().CheckAsync("hf.co/ggml-org/GLM-OCR-GGUF:Q8_0");

        Assert.False(result.IsReady);
        Assert.Contains("n'est pas installé", result.UserMessage);
    }

    /// <summary>Un nom sans étiquette vaut « :latest », des deux côtés (OllamaModelName).</summary>
    [Fact]
    public async Task ImplicitLatestTag_Matches()
    {
        SetInstalled(new OllamaModelInfo { Name = "glm-ocr:latest", Size = 2_200_000_000L });

        var result = await CreateSut().CheckAsync("glm-ocr");

        Assert.True(result.IsReady);
    }
}
