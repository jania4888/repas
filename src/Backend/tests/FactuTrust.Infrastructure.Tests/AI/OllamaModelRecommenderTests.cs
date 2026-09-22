using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Enums;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class OllamaModelRecommenderTests
{
    private readonly Mock<IOllamaClient> _ollamaClient = new();
    private readonly Mock<IPlatformAiSettingsService> _platform = new();
    private readonly Mock<IAiEngineMemoryProbe> _memoryProbe = new();
    private readonly IMemoryCache _cache = new MemoryCache(new MemoryCacheOptions());

    public OllamaModelRecommenderTests()
    {
        _platform.Setup(x => x.GetInferenceDeviceAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(OllamaInferenceDevice.Gpu);

        // Mesure large et DETERMINISTE : les tests ne doivent pas dépendre de la RAM de la
        // machine qui les exécute. Chaque test qui s'intéresse à la mémoire la redéfinit.
        SetEngineMemory(new AiEngineMemorySnapshot(64L << 30, 64L << 30, true));
    }

    private void SetEngineMemory(AiEngineMemorySnapshot snapshot) =>
        _memoryProbe.Setup(p => p.ReadAsync(It.IsAny<CancellationToken>())).ReturnsAsync(snapshot);

    private OllamaModelRecommender CreateSut() =>
        new(_ollamaClient.Object, _platform.Object, _memoryProbe.Object, _cache,
            NullLogger<OllamaModelRecommender>.Instance);

    [Fact]
    public async Task RecommendBestLocalModel_OllamaUnavailable_ReturnsNull()
    {
        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task RecommendBestLocalModel_NoModelsInstalled_ReturnsNull()
    {
        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<OllamaModelInfo>());

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task RecommendBestLocalModel_SingleCompatibleModel_ReturnsThatModel()
    {
        var models = new[]
        {
            new OllamaModelInfo { Name = "mistral:latest", Size = 40_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);
        _ollamaClient.Setup(c => c.ShowModelAsync("mistral:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails
                {
                    ParameterSize = "7B",
                    QuantizationLevel = "Q4_K_M",
                    Family = "mistral"
                }
            });

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.NotNull(result);
        Assert.Equal("ollama:mistral:latest", result!.RecommendedModelRef);
        Assert.Equal("mistral:latest", result.DisplayLabel);
        Assert.Contains("7B", result.Reason);
    }

    [Fact]
    public async Task RecommendBestLocalModel_ToolCallingModelWins()
    {
        var models = new[]
        {
            new OllamaModelInfo { Name = "generic:latest", Size = 40_000_000L, ModifiedAt = DateTime.UtcNow },
            new OllamaModelInfo { Name = "qwen2.5:latest", Size = 45_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);

        _ollamaClient.Setup(c => c.ShowModelAsync("generic:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails
                {
                    ParameterSize = "7B",
                    QuantizationLevel = "Q4_K_M",
                    Family = "generic"
                }
            });

        _ollamaClient.Setup(c => c.ShowModelAsync("qwen2.5:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails
                {
                    ParameterSize = "7B",
                    QuantizationLevel = "Q4_K_M",
                    Family = "qwen2.5",
                    Families = new List<string> { "qwen2.5" }
                }
            });

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.NotNull(result);
        Assert.Equal("ollama:qwen2.5:latest", result!.RecommendedModelRef);
        Assert.Contains("tool-calling", result.Reason);
    }

    [Fact]
    public async Task RecommendBestLocalModel_LargerCompatibleModel_WinsOverSmaller()
    {
        var models = new[]
        {
            new OllamaModelInfo { Name = "small:latest", Size = 20_000_000L, ModifiedAt = DateTime.UtcNow },
            new OllamaModelInfo { Name = "large:latest", Size = 60_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);

        _ollamaClient.Setup(c => c.ShowModelAsync("small:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails { ParameterSize = "3B", QuantizationLevel = "Q4_K_M" }
            });

        _ollamaClient.Setup(c => c.ShowModelAsync("large:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails { ParameterSize = "13B", QuantizationLevel = "Q4_K_M" }
            });

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.NotNull(result);
        Assert.Equal("ollama:large:latest", result!.RecommendedModelRef);
    }

    [Fact]
    public async Task RecommendBestLocalModel_GpuFitBonusApplied()
    {
        var models = new[]
        {
            new OllamaModelInfo { Name = "fit:latest", Size = 30_000_000L, ModifiedAt = DateTime.UtcNow },
            new OllamaModelInfo { Name = "nofit:latest", Size = 30_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaProcessListResponse
            {
                Models = new List<OllamaRunningModel>
                {
                    new() { Name = "other", Size = 2_000_000_000, SizeVram = 8_000_000_000L }
                }
            });

        _ollamaClient.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails { ParameterSize = "7B", QuantizationLevel = "Q4_K_M" }
            });

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.NotNull(result);
        Assert.NotNull(result!.HardwareProfile.Gpu);
        Assert.True(result.HardwareProfile.Gpu!.IsAccelerated);
    }

    [Fact]
    public async Task RecommendBestLocalModel_ResultIsCached()
    {
        var models = new[]
        {
            new OllamaModelInfo { Name = "test:latest", Size = 20_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);
        _ollamaClient.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails { ParameterSize = "3B" }
            });

        var sut = CreateSut();
        var first = await sut.RecommendBestLocalModelAsync();
        var second = await sut.RecommendBestLocalModelAsync();

        Assert.NotNull(first);
        Assert.Same(first, second);
        _ollamaClient.Verify(c => c.ListModelsAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>
    /// Sans mesure portant sur le moteur, aucun modèle ne doit être écarté : c'est le défaut
    /// qui faisait recommander un modèle 0,6 B sur un serveur disposant de la mémoire voulue.
    /// </summary>
    [Fact]
    public async Task RecommendBestLocalModel_MemoryNotMeaningful_DoesNotFilterLargeModel()
    {
        SetEngineMemory(AiEngineMemorySnapshot.Unknown);

        var models = new[]
        {
            new OllamaModelInfo { Name = "big:latest", Size = 20_000_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);
        _ollamaClient.Setup(c => c.ShowModelAsync("big:latest", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Details = new OllamaModelDetails { ParameterSize = "70B", QuantizationLevel = "Q4_K_M" }
            });

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.NotNull(result);
        Assert.Equal("ollama:big:latest", result!.RecommendedModelRef);
    }

    /// <summary>Budget moteur déclaré : le filtrage redevient légitime, et s'applique.</summary>
    [Fact]
    public async Task RecommendBestLocalModel_DeclaredBudgetTooSmall_FiltersModel()
    {
        SetEngineMemory(new AiEngineMemorySnapshot(2L << 30, 2L << 30, true));

        var models = new[]
        {
            new OllamaModelInfo { Name = "big:latest", Size = 20_000_000_000L, ModifiedAt = DateTime.UtcNow }
        };

        _ollamaClient.Setup(c => c.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _ollamaClient.Setup(c => c.ListModelsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(models);
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaProcessListResponse?)null);

        var result = await CreateSut().RecommendBestLocalModelAsync();

        Assert.Null(result);
    }
}
