using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Estime la faisabilité de chargement d'un modèle Ollama selon la taille du fichier modèle
/// et la mémoire du MOTEUR (<see cref="IAiEngineMemoryProbe"/>), pas celle du processus API.
///
/// <para>La version précédente comparait la taille du modèle au tas .NET restant de l'API.
/// En déploiement conteneurisé, cela refusait l'import de facture par photo alors qu'Ollama
/// disposait de la mémoire nécessaire. Quand la mémoire du moteur n'est pas connaissable, le
/// verdict mémoire est désormais <b>abandonné</b> plutôt que rendu sur une mesure étrangère :
/// Ollama reste le juge final, et un échec de chargement est déjà rattrapé plus haut dans le
/// pipeline d'extraction.</para>
/// </summary>
public sealed class OllamaModelReadinessChecker : IOllamaModelReadinessChecker
{
    private const double BytesPerGiB = 1024.0 * 1024 * 1024;

    /// <summary>Surcoût d'exécution au-delà des poids : contexte, tampons, allocateur.</summary>
    private const double LoadOverheadFactor = 1.3;

    /// <summary>Part de la mémoire libre qu'on accepte de consacrer à un seul modèle.</summary>
    private const double UsableFraction = 0.7;

    private readonly IOllamaClient _ollamaClient;
    private readonly IAiEngineMemoryProbe _memoryProbe;
    private readonly ILogger<OllamaModelReadinessChecker> _logger;

    public OllamaModelReadinessChecker(
        IOllamaClient ollamaClient,
        IAiEngineMemoryProbe memoryProbe,
        ILogger<OllamaModelReadinessChecker> logger)
    {
        _ollamaClient = ollamaClient;
        _memoryProbe = memoryProbe;
        _logger = logger;
    }

    public async Task<OllamaModelReadinessResult> CheckAsync(
        string modelName,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(modelName))
            return new OllamaModelReadinessResult(false, "Aucun modèle d'import IA configuré.", null, null);

        if (!await _ollamaClient.IsAvailableAsync(cancellationToken))
        {
            return new OllamaModelReadinessResult(
                false,
                "Le moteur IA InstaFact est indisponible. Vérifiez que le service est démarré sur le serveur.",
                null,
                null);
        }

        var memory = await _memoryProbe.ReadAsync(cancellationToken);
        var availableGiB = memory.IsMeaningful
            ? Math.Round(memory.AvailableBytes / BytesPerGiB, 1)
            : (double?)null;

        var models = await _ollamaClient.ListModelsAsync(cancellationToken);
        var match = models.FirstOrDefault(m => ModelNameMatches(modelName, m.Name));

        if (match is null)
        {
            return new OllamaModelReadinessResult(
                false,
                $"Le modèle « {modelName} » n'est pas installé sur le moteur IA InstaFact. Contactez l'administrateur plateforme ou choisissez un autre modèle.",
                null,
                availableGiB);
        }

        // Pas de verdict mémoire sans mesure qui porte sur le bon processus.
        if (memory.IsMeaningful && match.Size > 0)
        {
            var requiredWithOverhead = match.Size * LoadOverheadFactor;
            var ramThreshold = memory.AvailableBytes * UsableFraction;
            if (requiredWithOverhead >= ramThreshold)
            {
                var requiredGiB = requiredWithOverhead / BytesPerGiB;
                _logger.LogWarning(
                    "Modèle {Model} : RAM moteur insuffisante (requis ~{RequiredGiB:F1} Go, disponible ~{AvailableGiB:F1} Go)",
                    modelName, requiredGiB, availableGiB);

                return new OllamaModelReadinessResult(
                    false,
                    $"Le modèle d'import « {modelName} » nécessite environ {requiredGiB:F1} Go de RAM, "
                    + $"mais seulement {availableGiB:F1} Go sont disponibles. "
                    + "Installez un modèle plus léger (ex. qwen2.5:7b-instruct) ou libérez de la mémoire.",
                    Math.Round(requiredGiB, 1),
                    availableGiB);
            }
        }

        return new OllamaModelReadinessResult(true, null, null, availableGiB);
    }

    /// <inheritdoc cref="OllamaModelName.Matches"/>
    private static bool ModelNameMatches(string requested, string installedName) =>
        OllamaModelName.Matches(requested, installedName);
}
