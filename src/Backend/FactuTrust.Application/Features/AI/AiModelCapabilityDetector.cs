namespace FactuTrust.Application.Features.AI;

/// <summary>
/// Heuristiques d'auto-détection des capacités d'un modèle LLM à partir de son
/// nom/référence. Utilisé pour décider, par exemple, si on doit envoyer les
/// images d'une pièce jointe au modèle (modèles vision multimodaux).
///
/// <para><b>Repli, pas référence.</b> Pour un modèle Ollama, la capacité est publiée par le
/// moteur lui-même (<see cref="Common.Interfaces.Services.IAiModelVisionProbe"/>) : c'est elle
/// qui fait foi. Ces listes ne servent que lorsque le moteur ne répond pas, ou pour les
/// fournisseurs distants qui n'exposent pas leurs capacités.</para>
/// </summary>
public static class AiModelCapabilityDetector
{
    private static readonly string[] VisionMarkers =
    {
        "llava", "vision", "gemma3", "gemma-3", "gemma:3",
        "qwen2-vl", "qwen2.5-vl", "qwen-vl",
        "llama3.2-vision", "llama-3.2-vision",
        "minicpm-v", "moondream", "bakllava",
        "pixtral", "internvl",
        "phi-3.5-vision", "phi-4-vision",
        "claude-3", "claude-4",
        "gpt-4o", "gpt-4-turbo", "gpt-4v",
        "gemini-1.5", "gemini-2",
        "glm-ocr", "glm_ocr", "glmocr",
        // Familles OCR / VL dont le nom ne porte ni « vision » ni un millésime connu.
        // « -ocr » couvre surya-ocr-2, deepseek-ocr-2, olmocr ; « -vl- » / « -vl: » couvrent
        // qwen3-vl et les suivants, là où « qwen-vl » ne matchait que les deux premiers.
        "-ocr", "ocr-", "-vl-", "-vl:", "surya"
    };

    private static readonly string[] EmbeddingMarkers =
    {
        "embed", "embedding", "nomic-embed", "bge-", "e5-", "gte-",
        "snowflake-arctic-embed", "mxbai-embed", "paraphrase-",
        "all-minilm", "all-mpnet"
    };

    /// <summary>
    /// Vrai si le modèle nommé semble être un modèle d'embedding uniquement (pas de génération/chat).
    /// </summary>
    public static bool DetectEmbeddingOnly(string? modelRef)
    {
        if (string.IsNullOrWhiteSpace(modelRef)) return false;
        var name = modelRef.ToLowerInvariant();
        foreach (var marker in EmbeddingMarkers)
        {
            if (name.Contains(marker, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    /// <summary>
    /// Vrai si le modèle peut être utilisé pour un appel chat/completion (import, assistant).
    /// </summary>
    public static bool DetectChatCapable(string? modelRef) =>
        !string.IsNullOrWhiteSpace(modelRef) && !DetectEmbeddingOnly(modelRef);

    /// <summary>
    /// Vrai si le modèle nommé semble supporter l'entrée image (vision multimodale).
    /// Détection conservative : faux par défaut si le nom est inconnu.
    /// </summary>
    public static bool DetectVisionSupport(string? modelRef)
    {
        if (string.IsNullOrWhiteSpace(modelRef)) return false;
        var name = modelRef.ToLowerInvariant();
        foreach (var marker in VisionMarkers)
        {
            if (name.Contains(marker, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    /// <summary>
    /// Les IDs Cursor (composer-2.5, auto-smart, …) n'ont pas de marqueur vision dans le nom.
    /// Le SDK accepte des images sur <c>SDKUserMessage</c> : on les considère vision-capable.
    /// </summary>
    public static bool DetectVisionSupport(ParsedModelRef parsed) =>
        parsed.Kind == LlmProviderKind.Cursor || DetectVisionSupport(parsed.ProviderModelId);

    public static bool DetectChatCapable(ParsedModelRef parsed) =>
        parsed.Kind == LlmProviderKind.Cursor || DetectChatCapable(parsed.ProviderModelId);

    /// <summary>
    /// Règle unique de décision : la capacité déclarée par le moteur l'emporte toujours ; à
    /// défaut seulement (<paramref name="engineDeclared"/> nul), on devine d'après le nom.
    /// </summary>
    /// <param name="engineDeclared">Verdict de <see cref="Common.Interfaces.Services.IAiModelVisionProbe"/>, ou nul si inconnu.</param>
    public static bool ResolveVisionSupport(bool? engineDeclared, ParsedModelRef parsed) =>
        engineDeclared ?? DetectVisionSupport(parsed);

    /// <inheritdoc cref="ResolveVisionSupport(bool?, ParsedModelRef)"/>
    public static bool ResolveVisionSupport(bool? engineDeclared, string? modelRef) =>
        engineDeclared ?? DetectVisionSupport(modelRef);
}
