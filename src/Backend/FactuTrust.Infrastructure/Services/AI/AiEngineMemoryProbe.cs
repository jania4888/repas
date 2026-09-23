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

    private readonly IOptions<OllamaSettings> _settings;
    private readonly ILogger<AiEngineMemoryProbe> _logger;

    public AiEngineMemoryProbe(
        IOptions<OllamaSettings> settings,
        ILogger<AiEngineMemoryProbe> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    public Task<AiEngineMemorySnapshot> ReadAsync(CancellationToken cancellationToken = default)
    {
        var settings = _settings.Value;

        // 1. Budget déclaré par l'exploitant : la seule mesure juste en déploiement séparé.
        //    Doit refléter la mémoire réellement allouable au moteur (ex. `mem_limit` du
        //    conteneur Ollama), et non celle de l'hôte entier.
        //
        //    Le budget est le plafond qu'UN modèle doit respecter pour être chargeable. Les
        //    modèles déjà résidents ne sont PAS déduits : Ollama évince un modèle inactif pour
        //    charger le suivant (OLLAMA_MAX_LOADED_MODELS). Les déduire refusait à tort un
        //    modèle qui tenait parfaitement — gemma3:4b avec deux autres modèles en mémoire.
        if (settings.EngineRamBudgetGiB > 0)
        {
            var total = (long)(settings.EngineRamBudgetGiB * BytesPerGiB);
            return Task.FromResult(new AiEngineMemorySnapshot(total, total, true));
        }

        // 2. Moteur distant sans budget déclaré : l'API ne peut rien savoir de la mémoire
        //    d'une autre machine. Mesurer la sienne produirait un refus arbitraire.
        if (!IsLocalEngine(settings.BaseUrl))
        {
            _logger.LogDebug(
                "Mémoire du moteur IA non mesurable ({BaseUrl} n'est pas local et « Ollama:EngineRamBudgetGiB » "
                + "n'est pas défini) : le contrôle de faisabilité mémoire est ignoré.",
                settings.BaseUrl);
            return Task.FromResult(AiEngineMemorySnapshot.Unknown);
        }

        // 3. Moteur local (poste de développement) : le processus API et Ollama se partagent
        //    la même machine, l'ancienne heuristique reste une approximation acceptable.
        var gcInfo = GC.GetGCMemoryInfo();
        var totalRam = gcInfo.TotalAvailableMemoryBytes;
        var usedByProcess = Process.GetCurrentProcess().WorkingSet64;
        return Task.FromResult(
            new AiEngineMemorySnapshot(totalRam, Math.Max(0, totalRam - usedByProcess), true));
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
