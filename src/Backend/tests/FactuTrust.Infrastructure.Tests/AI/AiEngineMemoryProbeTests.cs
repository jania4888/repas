using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class AiEngineMemoryProbeTests
{
    private static AiEngineMemoryProbe CreateSut(OllamaSettings settings) =>
        new(Options.Create(settings), NullLogger<AiEngineMemoryProbe>.Instance);

    /// <summary>
    /// Le budget est le plafond qu'UN modèle doit respecter. Les modèles résidents ne sont pas
    /// déduits : Ollama en évince un inactif pour charger le suivant, et les déduire refusait à
    /// tort gemma3:4b quand deux autres modèles étaient en mémoire.
    /// </summary>
    [Fact]
    public async Task DeclaredBudget_IsTheCeilingForASingleModel()
    {
        var snapshot = await CreateSut(new OllamaSettings
        {
            BaseUrl = "http://ollama:11434",
            EngineRamBudgetGiB = 12
        }).ReadAsync();

        Assert.True(snapshot.IsMeaningful);
        Assert.Equal(12L << 30, snapshot.TotalBytes);
        Assert.Equal(12L << 30, snapshot.AvailableBytes);
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
