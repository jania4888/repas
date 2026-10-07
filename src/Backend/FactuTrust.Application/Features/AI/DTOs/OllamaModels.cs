using System.Text.Json.Serialization;

namespace FactuTrust.Application.Features.AI.DTOs;

public sealed record OllamaChatRequest
{
    public required string Model { get; init; }
    public required List<OllamaChatMessage> Messages { get; init; }
    public bool Stream { get; init; } = true;
    public List<OllamaToolDefinition>? Tools { get; init; }
    public OllamaOptions? Options { get; init; }

    /// <summary>
    /// Durée pendant laquelle Ollama garde le modèle en mémoire après la requête (ex: "30m", "1h", "0" = indéfini).
    /// </summary>
    [JsonPropertyName("keep_alive")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? KeepAlive { get; init; }

    /// <summary>
    /// Mode de sortie structurée Ollama. Deux formes acceptées :
    /// <list type="bullet">
    /// <item>la chaîne <c>"json"</c> — garantit un JSON syntaxiquement valide, mais rien sur les
    /// types (c'est ainsi qu'un modèle a pu écrire <c>19.0</c> pour un entier) ;</item>
    /// <item>un SCHÉMA JSON (objet) — Ollama ≥ 0.5 contraint alors le décodage lui-même, donc les
    /// types. C'est la correction à la source.</item>
    /// </list>
    /// Typé <c>object?</c> pour porter les deux ; la sérialisation d'une chaîne est inchangée au
    /// caractère près, donc aucun impact sur les appelants existants. Ignoré quand null.
    /// </summary>
    [JsonPropertyName("format")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Format { get; init; }
}

public sealed record OllamaChatMessage
{
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    [JsonPropertyName("content")]
    public string Content { get; init; } = string.Empty;

    [JsonPropertyName("tool_calls")]
    public List<OllamaToolCall>? ToolCalls { get; init; }

    /// <summary>
    /// Liste d'images en base64 (sans préfixe data:) jointes au message.
    /// Renseigné uniquement pour les modèles vision capables (gemma3, llava, llama3.2-vision…).
    /// </summary>
    [JsonPropertyName("images")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Images { get; init; }
}

public sealed record OllamaOptions
{
    [JsonPropertyName("temperature")]
    public double? Temperature { get; init; }

    [JsonPropertyName("num_predict")]
    public int? NumPredict { get; init; }

    [JsonPropertyName("num_ctx")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? NumCtx { get; init; }

    [JsonPropertyName("num_gpu")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? NumGpu { get; init; }

    [JsonPropertyName("num_thread")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? NumThread { get; init; }

    [JsonPropertyName("num_batch")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? NumBatch { get; init; }

    /// <summary>
    /// Graine de génération (seed). Fixée => sorties reproductibles à température/contexte égaux,
    /// ce qui supprime la divergence d'un essai à l'autre pour une même question.
    /// </summary>
    [JsonPropertyName("seed")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Seed { get; init; }

    [JsonPropertyName("top_p")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? TopP { get; init; }
}

public sealed record OllamaChatChunk
{
    [JsonPropertyName("model")]
    public string Model { get; init; } = string.Empty;

    [JsonPropertyName("message")]
    public OllamaChatMessage? Message { get; init; }

    [JsonPropertyName("done")]
    public bool Done { get; init; }

    [JsonPropertyName("done_reason")]
    public string? DoneReason { get; init; }

    /// <summary>
    /// Jetons d'entrée réellement évalués par le modèle (dernier fragment, <c>done = true</c>).
    /// Diagnostic décisif pour la lecture vision : une page jointe en image pèse des centaines de
    /// jetons, donc un compte proche de la seule longueur du prompt signale que l'image n'a pas
    /// été prise en compte par le modèle.
    /// </summary>
    [JsonPropertyName("prompt_eval_count")]
    public int? PromptEvalCount { get; init; }

    /// <summary>Jetons produits (dernier fragment) : distingue « rien produit » de « produit puis illisible ».</summary>
    [JsonPropertyName("eval_count")]
    public int? EvalCount { get; init; }

    /// <summary>Durée d'évaluation de l'entrée, en nanosecondes (dernier fragment).</summary>
    [JsonPropertyName("prompt_eval_duration")]
    public long? PromptEvalDurationNs { get; init; }

    /// <summary>Durée de production, en nanosecondes (dernier fragment).</summary>
    [JsonPropertyName("eval_duration")]
    public long? EvalDurationNs { get; init; }
}

public sealed record OllamaToolDefinition
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = "function";

    [JsonPropertyName("function")]
    public required OllamaFunctionDefinition Function { get; init; }
}

public sealed record OllamaFunctionDefinition
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("description")]
    public required string Description { get; init; }

    [JsonPropertyName("parameters")]
    public required OllamaFunctionParameters Parameters { get; init; }
}

public sealed record OllamaFunctionParameters
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = "object";

    [JsonPropertyName("properties")]
    public Dictionary<string, OllamaParameterProperty> Properties { get; init; } = new();

    [JsonPropertyName("required")]
    public List<string> Required { get; init; } = new();
}

public sealed record OllamaParameterProperty
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    [JsonPropertyName("description")]
    public required string Description { get; init; }

    [JsonPropertyName("enum")]
    public List<string>? Enum { get; init; }
}

public sealed record OllamaToolCall
{
    /// <summary>Optional id (OpenAI / replay); omitted for native Ollama when null.</summary>
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Id { get; init; }

    [JsonPropertyName("function")]
    public OllamaToolCallFunction? Function { get; init; }
}

public sealed record OllamaToolCallFunction
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("arguments")]
    public Dictionary<string, object?> Arguments { get; init; } = new();
}

public sealed record OllamaModelInfo
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("size")]
    public long Size { get; init; }

    [JsonPropertyName("modified_at")]
    public DateTime ModifiedAt { get; init; }
}

public sealed record OllamaModelListResponse
{
    [JsonPropertyName("models")]
    public List<OllamaModelInfo> Models { get; init; } = new();
}

// ── POST /api/show response ──

public sealed record OllamaModelShowResponse
{
    [JsonPropertyName("details")]
    public OllamaModelDetails? Details { get; init; }

    [JsonPropertyName("model_info")]
    public Dictionary<string, object?>? ModelInfo { get; init; }

    /// <summary>
    /// Capacités déclarées par le moteur, par ex. <c>["completion", "vision", "tools"]</c>.
    /// Absente des moteurs trop anciens pour les publier : la liste est alors nulle, et
    /// l'appelant retombe sur l'heuristique de nom.
    /// </summary>
    [JsonPropertyName("capabilities")]
    public List<string>? Capabilities { get; init; }
}

public sealed record OllamaModelDetails
{
    [JsonPropertyName("parameter_size")]
    public string? ParameterSize { get; init; }

    [JsonPropertyName("quantization_level")]
    public string? QuantizationLevel { get; init; }

    [JsonPropertyName("families")]
    public List<string>? Families { get; init; }

    [JsonPropertyName("family")]
    public string? Family { get; init; }
}

// ── GET /api/ps response ──

public sealed record OllamaProcessListResponse
{
    [JsonPropertyName("models")]
    public List<OllamaRunningModel>? Models { get; init; }
}

public sealed record OllamaRunningModel
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    [JsonPropertyName("size")]
    public long Size { get; init; }

    [JsonPropertyName("size_vram")]
    public long SizeVram { get; init; }

    [JsonPropertyName("details")]
    public OllamaModelDetails? Details { get; init; }
}
