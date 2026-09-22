using System.Diagnostics;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <inheritdoc cref="IAiEngineMemoryProbe"/>
public sealed class AiEngineMemoryProbe : IAiEngineMemoryProbe
{
    private const double BytesPerGiB = 1024.0 * 1024 * 1024;

    private readonly IOllamaClient _ollamaClient;
    private readonly IOptions<OllamaSettings> _settings;
    private readonly ILogger<AiEngineMemoryProbe> _logger;

    public AiEngineMemoryProbe(
        IOllamaClient ollamaClient,
        IOptions<OllamaSettings> settings,
        ILogger<AiEngineMemoryProbe> logger)
    {
        _ollamaClient = ollamaClient;
        _settings = settings;
        _logger = logger;
    }

    public async Task<AiEngineMemorySnapshot> ReadAsync(CancellationToken cancellationToken = default)
    {
        var settings = _settings.Value;

        // 1. Budget déclaré par l'exploitant : la seule mesure juste en déploiement séparé.
        //    Doit refléter la mémoire réellement allouable au moteur (ex. `mem_limit` du
        //    conteneur Ollama), et non celle de l'hôte entier.
        if (settings.EngineRamBudgetGiB > 0)
        {
            var total = (long)(settings.EngineRamBudgetGiB * BytesPerGiB);
            var loaded = await ReadLoadedBytesAsync(cancellationToken);
            return new AiEngineMemorySnapshot(total, Math.Max(0, total - loaded), true);
        }

        // 2. Moteur distant sans budget déclaré : l'API ne peut rien savoir de la mémoire
        //    d'une autre machine. Mesurer la sienne produirait un refus arbitraire.
        if (!IsLocalEngine(settings.BaseUrl))
        {
            _logger.LogDebug(
                "Mémoire du moteur IA non mesurable ({BaseUrl} n'est pas local et « Ollama:EngineRamBudgetGiB » "
                + "n'est pas défini) : le contrôle de faisabilité mémoire est ignoré.",
                settings.BaseUrl);
            return AiEngineMemorySnapshot.Unknown;
        }

        // 3. Moteur local (poste de développement) : le processus API et Ollama se partagent
        //    la même machine, l'ancienne heuristique reste une approximation acceptable.
        var gcInfo = GC.GetGCMemoryInfo();
        var totalRam = gcInfo.TotalAvailableMemoryBytes;
        var usedByProcess = Process.GetCurrentProcess().WorkingSet64;
        return new AiEngineMemorySnapshot(totalRam, Math.Max(0, totalRam - usedByProcess), true);
    }

    /// <summary>
    /// Somme des modèles déjà résidents dans le moteur (<c>GET /api/ps</c>). Un échec de
    /// lecture ne doit pas faire échouer la sonde : on retombe sur « rien de chargé », ce qui
    /// est permissif — cohérent avec le fait qu'Ollama reste le juge final du chargement.
    /// </summary>
    private async Task<long> ReadLoadedBytesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var running = await _ollamaClient.ListRunningModelsAsync(cancellationToken);
            if (running?.Models is not { Count: > 0 } models)
                return 0;

            return models.Sum(m => Math.Max(0, m.Size));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Lecture des modèles résidents impossible ; budget moteur considéré comme libre.");
            return 0;
        }
    }

    /// <summary>
    /// Vrai si le moteur tourne sur la même machine que l'API. Une URL illisible est traitée
    /// comme distante : mieux vaut renoncer au verdict mémoire que le fonder sur une hypothèse.
    /// </summary>
    internal static bool IsLocalEngine(string? baseUrl)
    {
        if (string.IsNullOrWhiteSpace(baseUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
            return false;

        return uri.IsLoopback
            || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase);
    }
}
