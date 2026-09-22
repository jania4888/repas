using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class AiEngineMemoryProbeTests
{
    private readonly Mock<IOllamaClient> _ollamaClient = new();

    private AiEngineMemoryProbe CreateSut(OllamaSettings settings) =>
        new(_ollamaClient.Object, Options.Create(settings), NullLogger<AiEngineMemoryProbe>.Instance);

    [Fact]
    public async Task DeclaredBudget_SubtractsAlreadyLoadedModels()
    {
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaProcessListResponse
            {
                Models = new List<OllamaRunningModel>
                {
                    new() { Name = "a", Size = 2L << 30 },
                    new() { Name = "b", Size = 1L << 30 }
                }
            });

        var snapshot = await CreateSut(new OllamaSettings { EngineRamBudgetGiB = 12 }).ReadAsync();

        Assert.True(snapshot.IsMeaningful);
        Assert.Equal(12L << 30, snapshot.TotalBytes);
        Assert.Equal(9L << 30, snapshot.AvailableBytes);
    }

    [Fact]
    public async Task DeclaredBudget_RunningModelsUnreadable_TreatsBudgetAsFree()
    {
        _ollamaClient.Setup(c => c.ListRunningModelsAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("moteur injoignable"));

        var snapshot = await CreateSut(new OllamaSettings { EngineRamBudgetGiB = 8 }).ReadAsync();

        Assert.True(snapshot.IsMeaningful);
        Assert.Equal(8L << 30, snapshot.AvailableBytes);
    }

    /// <summary>
    /// Le cas de production : Ollama dans un autre conteneur, aucun budget déclaré. Mesurer
    /// la mémoire de l'API n'apprendrait rien sur celle du moteur.
    /// </summary>
    [Fact]
    public async Task RemoteEngine_WithoutDeclaredBudget_IsNotMeaningful()
    {
        var snapshot = await CreateSut(new OllamaSettings { BaseUrl = "http://ollama:11434" }).ReadAsync();

        Assert.False(snapshot.IsMeaningful);
        Assert.Equal(0, snapshot.TotalBytes);
    }

    [Fact]
    public async Task LocalEngine_WithoutDeclaredBudget_FallsBackToProcessHeuristic()
    {
        var snapshot = await CreateSut(new OllamaSettings { BaseUrl = "http://localhost:11434" }).ReadAsync();

        Assert.True(snapshot.IsMeaningful);
        Assert.True(snapshot.TotalBytes > 0);
    }

    [Theory]
    [InlineData("http://localhost:11434", true)]
    [InlineData("http://127.0.0.1:11434", true)]
    [InlineData("http://LOCALHOST:11434", true)]
    [InlineData("http://ollama:11434", false)]
    [InlineData("http://192.168.1.20:11434", false)]
    [InlineData("", false)]
    [InlineData("pas-une-url", false)]
    public void IsLocalEngine_ClassifiesHosts(string baseUrl, bool expected) =>
        Assert.Equal(expected, AiEngineMemoryProbe.IsLocalEngine(baseUrl));
}
