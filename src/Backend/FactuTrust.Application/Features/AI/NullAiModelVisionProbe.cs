using FactuTrust.Application.Common.Interfaces.Services;

namespace FactuTrust.Application.Features.AI;

/// <summary>
/// Sonde inerte : ne répond jamais, donc la capacité est toujours déduite du nom du modèle.
/// Sert aux appelants historiques qui construisent eux-mêmes leurs dépendances (tests, replis
/// de constructeur) ; en production, c'est <c>OllamaModelVisionProbe</c> qui est injectée.
/// </summary>
public sealed class NullAiModelVisionProbe : IAiModelVisionProbe
{
    public static readonly NullAiModelVisionProbe Instance = new();

    private NullAiModelVisionProbe() { }

    public Task<bool?> TryDetectVisionAsync(
        ParsedModelRef model,
        CancellationToken cancellationToken = default) => Task.FromResult<bool?>(null);
}
