using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Lit la capacité vision publiée par Ollama sur <c>POST /api/show</c>.
///
/// <para>Ne lance jamais : toute incertitude devient <c>null</c>, et l'appelant retombe sur
/// l'heuristique de nom. Une sonde en échec ne doit pas faire échouer un import.
/// Les réponses sont déjà mises en cache par <see cref="IOllamaClient.ShowModelAsync"/>.</para>
/// </summary>
public sealed class OllamaModelVisionProbe : IAiModelVisionProbe
{
    private const string VisionCapability = "vision";

    private readonly IOllamaClient _ollamaClient;
    private readonly ILogger<OllamaModelVisionProbe> _logger;

    public OllamaModelVisionProbe(IOllamaClient ollamaClient, ILogger<OllamaModelVisionProbe> logger)
    {
        _ollamaClient = ollamaClient;
        _logger = logger;
    }

    public async Task<bool?> TryDetectVisionAsync(
        ParsedModelRef model,
        CancellationToken cancellationToken = default)
    {
        // Seul le moteur local publie ses capacités ; les fournisseurs distants restent au nom.
        if (model.Kind != LlmProviderKind.Ollama)
            return null;

        var modelId = model.ProviderModelId;
        if (string.IsNullOrWhiteSpace(modelId))
            return null;

        try
        {
            var show = await _ollamaClient.ShowModelAsync(modelId, cancellationToken);
            var capabilities = show?.Capabilities;

            // Moteur injoignable, modèle non installé, ou moteur trop ancien pour les publier.
            if (capabilities is null || capabilities.Count == 0)
                return null;

            return capabilities.Any(c => string.Equals(c, VisionCapability, StringComparison.OrdinalIgnoreCase));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex,
                "Capacités du modèle {Model} illisibles ; repli sur l'heuristique de nom.", modelId);
            return null;
        }
    }
}
