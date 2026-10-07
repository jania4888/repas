using System.Text.Json;
using FactuTrust.Application.Features.AI.DTOs;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Contrat de lecture des compteurs de jetons rendus par Ollama dans le fragment final.
/// Ces compteurs sont le seul moyen de savoir si une page jointe en image a bien été
/// tokenisée par le modèle : un prompt_eval_count de l'ordre de la seule consigne textuelle
/// signale que l'image n'a pas été prise en compte, ce qui est précisément le symptôme
/// « JSON valide mais vide ». Les mêmes options de sérialisation que OllamaHttpClient.
/// </summary>
public sealed class OllamaChatChunkTokenMetricsTests
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    [Fact]
    public void Final_chunk_exposes_token_counts_and_durations()
    {
        // Forme réelle du dernier fragment de /api/chat (champs utiles seulement).
        const string json = """
            {"model":"qwen3-vl:2b","message":{"role":"assistant","content":""},"done":true,
             "done_reason":"stop","prompt_eval_count":1731,"eval_count":42,
             "prompt_eval_duration":123456789000,"eval_duration":9876543210}
            """;

        var chunk = JsonSerializer.Deserialize<OllamaChatChunk>(json, Options);

        Assert.NotNull(chunk);
        Assert.True(chunk!.Done);
        Assert.Equal(1731, chunk.PromptEvalCount);
        Assert.Equal(42, chunk.EvalCount);
        Assert.Equal(123456789000L, chunk.PromptEvalDurationNs);
        Assert.Equal(9876543210L, chunk.EvalDurationNs);
    }

    [Fact]
    public void Streaming_chunk_without_counts_leaves_metrics_absent()
    {
        // Les fragments intermédiaires ne portent aucun compteur : ils doivent rester nuls
        // pour que la capture côté pipeline ne retienne que le fragment final.
        const string json = """
            {"model":"qwen3-vl:2b","message":{"role":"assistant","content":"{\"lines\""},"done":false}
            """;

        var chunk = JsonSerializer.Deserialize<OllamaChatChunk>(json, Options);

        Assert.NotNull(chunk);
        Assert.False(chunk!.Done);
        Assert.Null(chunk.PromptEvalCount);
        Assert.Null(chunk.EvalCount);
        Assert.Null(chunk.PromptEvalDurationNs);
        Assert.Null(chunk.EvalDurationNs);
    }
}
