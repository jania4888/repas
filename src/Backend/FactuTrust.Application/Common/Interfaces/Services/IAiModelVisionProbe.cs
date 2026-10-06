using FactuTrust.Application.Features.AI;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Interroge le moteur local sur les capacités <b>déclarées</b> d'un modèle, au lieu de les
/// deviner d'après son nom.
///
/// <para>Ollama expose <c>capabilities</c> sur <c>POST /api/show</c> (par ex.
/// <c>["completion", "vision"]</c>). C'est la réponse de référence : les heuristiques de nom de
/// <see cref="AiModelCapabilityDetector"/> se trompent dès qu'un modèle sort des familles
/// connues — <c>surya-ocr-2-gguf</c> et <c>qwen3-vl</c> étaient classés non multimodaux alors
/// qu'ils acceptent les images.</para>
/// </summary>
public interface IAiModelVisionProbe
{
    /// <summary>
    /// Capacité vision déclarée par le moteur.
    /// </summary>
    /// <returns>
    /// <c>true</c> ou <c>false</c> si le moteur l'a déclarée ; <c>null</c> si elle est inconnue —
    /// modèle hors Ollama, moteur injoignable, modèle non installé, ou moteur trop ancien pour
    /// publier ses capacités. L'appelant retombe alors sur l'heuristique de nom.
    /// </returns>
    Task<bool?> TryDetectVisionAsync(ParsedModelRef model, CancellationToken cancellationToken = default);
}
