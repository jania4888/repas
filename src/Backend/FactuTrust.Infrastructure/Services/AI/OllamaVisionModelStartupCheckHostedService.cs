using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Vérifie, peu après le démarrage, que le modèle vision de l'import de relevés bancaires (GLM-OCR)
/// et son repli texte sont installés sur le moteur IA, et le journalise (patron
/// <see cref="OcrStartupCheckHostedService"/>).
///
/// <para>Tâche de fond lancée <see cref="StartupDelay"/> après le démarrage pour laisser le
/// conteneur Ollama répondre ; toute exception est avalée : ce contrôle ne fait jamais échouer le
/// démarrage. Sans lui, un modèle absent ne se voyait qu'au premier relevé importé, sous la forme
/// d'une session « Lu par l'IA locale » avec 0 opération. Les journaux ne portent que des noms de
/// modèles et le message du vérificateur. Même règle que
/// <see cref="OllamaVisionModelHealthCheck.EvaluateAsync"/>.</para>
/// </summary>
public sealed class OllamaVisionModelStartupCheckHostedService : IHostedService
{
    /// <summary>Délai par défaut avant le contrôle (le conteneur Ollama démarre avec l'API).</summary>
    public static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(15);

    private readonly IServiceProvider _services;
    private readonly ILogger<OllamaVisionModelStartupCheckHostedService> _logger;
    private readonly TimeSpan _delay;
    private readonly CancellationTokenSource _stopping = new();
    private Task? _run;

    public OllamaVisionModelStartupCheckHostedService(
        IServiceProvider services,
        ILogger<OllamaVisionModelStartupCheckHostedService> logger)
        : this(services, logger, StartupDelay)
    {
    }

    /// <summary>Constructeur de test : délai explicite (zéro pour un contrôle immédiat).</summary>
    public OllamaVisionModelStartupCheckHostedService(
        IServiceProvider services,
        ILogger<OllamaVisionModelStartupCheckHostedService> logger,
        TimeSpan delay)
    {
        _services = services;
        _logger = logger;
        _delay = delay;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _run = RunAsync(_stopping.Token);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _stopping.Cancel();
        if (_run is not null)
        {
            try
            {
                await _run.WaitAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // Arrêt de l'hôte pendant le contrôle : rien à faire.
            }
        }
    }

    /// <summary>Exécute le contrôle (après le délai) et renvoie son résultat ; null si non applicable ou en erreur.</summary>
    public async Task<OllamaVisionModelStatus?> RunAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (_delay > TimeSpan.Zero)
                await Task.Delay(_delay, cancellationToken);

            using var scope = _services.CreateScope();
            var provider = scope.ServiceProvider;
            var ollama = provider.GetRequiredService<IOptions<OllamaSettings>>().Value;
            var limits = provider.GetRequiredService<IOptions<AccountingSettings>>().Value.BankStatementImport;

            if (!limits.VisionReadingEnabled)
            {
                _logger.LogInformation(
                    "Modèle vision des relevés : lecture vision désactivée (Accounting:BankStatementImport:VisionReadingEnabled=false), contrôle de démarrage sans objet.");
                return null;
            }

            var status = await OllamaVisionModelHealthCheck.EvaluateAsync(
                provider.GetRequiredService<IOllamaClient>(),
                provider.GetRequiredService<IOllamaModelReadinessChecker>(),
                ollama,
                limits,
                cancellationToken);

            Log(status);
            return status;
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        catch (Exception ex)
        {
            // Jamais bloquant : le contrôle de santé « ollama-bank-statement-vision » redira l'état.
            _logger.LogWarning(ex, "Contrôle de démarrage du modèle vision des relevés impossible (le contrôle de santé ollama-bank-statement-vision reste disponible).");
            return null;
        }
    }

    private void Log(OllamaVisionModelStatus status)
    {
        if (!status.EngineAvailable)
        {
            _logger.LogWarning(
                "Moteur IA injoignable au démarrage : l'import de relevés annoncera l'IA indisponible tant qu'Ollama ne répond pas (modèle vision attendu « {VisionModel} », repli texte « {TextModel} »).",
                status.VisionModel ?? "(aucun)",
                status.TextModel);
            return;
        }

        if (status.Status == HealthStatus.Healthy)
        {
            _logger.LogInformation(
                "Modèle vision des relevés « {VisionModel} » prêt sur le moteur IA ; repli texte « {TextModel} » {TextFallbackState}.",
                status.VisionModel,
                status.TextModel,
                status.TextFallbackReady ? "prêt" : "NON prêt");
            return;
        }

        if (!status.VisionReady && status.TextFallbackReady)
        {
            _logger.LogWarning(
                "Modèle vision des relevés « {VisionModel} » non installé ou non chargeable sur le moteur IA : l'import de relevés se repliera page par page sur le modèle texte « {TextModel} » et le signalera (deploy/README.md, section GLM-OCR). Détail : {Detail}",
                status.VisionModel ?? "(aucun)",
                status.TextModel,
                status.Description);
            return;
        }

        _logger.LogWarning(
            "Modèle vision des relevés « {VisionModel} » non installé sur le moteur IA et repli texte « {TextModel} » non prêt : l'import de relevés annoncera l'IA indisponible (deploy/README.md, section GLM-OCR). Détail : {Detail}",
            status.VisionModel ?? "(aucun)",
            status.TextModel,
            status.Description);
    }
}
