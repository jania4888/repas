using FactuTrust.Application.Features.AI;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Plafond de jetons de sortie du pipeline structuré (plan §3.4) : une demande explicite
/// (<c>MaxOutputTokens</c> de la requête, ex. 4096 pour les pages de relevé) n'est plus écrasée par
/// <c>Ollama:MaxTokens</c> (plafond des flux conversationnels) — la cause racine des pages vides ;
/// elle reste bornée par <c>min(8192, NumCtx/2)</c>. Sans demande explicite, comportement historique
/// <c>min(MaxTokens, plafond import ≤ 3072)</c> inchangé.
/// </summary>
public sealed class AiStructuredExtractionPipelineOutputCapTests
{
    [Fact]
    public void Explicit_override_ignores_the_conversational_max_tokens()
    {
        // Relevé : VisionMaxOutputTokens 4096, Ollama:MaxTokens 2048 → 4096 conservé (régression d'origine).
        var cap = AiStructuredExtractionPipeline.ResolveOutputCap(4096, ollamaMaxTokens: 2048, importMaxOutputTokens: 0, numCtx: 16384);

        Assert.Equal(4096, cap);
    }

    [Fact]
    public void Explicit_override_is_bounded_by_half_the_context_and_8192()
    {
        Assert.Equal(8192, AiStructuredExtractionPipeline.ResolveOutputCap(12000, 2048, 0, numCtx: 32768));
        Assert.Equal(4096, AiStructuredExtractionPipeline.ResolveOutputCap(12000, 2048, 0, numCtx: 8192));
    }

    [Fact]
    public void Explicit_override_has_a_floor_of_256()
    {
        Assert.Equal(256, AiStructuredExtractionPipeline.ResolveOutputCap(10, 2048, 0, numCtx: 16384));
    }

    [Fact]
    public void Explicit_override_with_zero_context_falls_back_to_8192_bound()
    {
        Assert.Equal(6000, AiStructuredExtractionPipeline.ResolveOutputCap(6000, 2048, 0, numCtx: 0));
    }

    [Fact]
    public void No_override_keeps_the_legacy_min_of_max_tokens_and_import_cap()
    {
        Assert.Equal(1536, AiStructuredExtractionPipeline.ResolveOutputCap(null, ollamaMaxTokens: 2048, importMaxOutputTokens: 0, numCtx: 16384));
        Assert.Equal(2048, AiStructuredExtractionPipeline.ResolveOutputCap(null, ollamaMaxTokens: 2048, importMaxOutputTokens: 3072, numCtx: 16384));
        Assert.Equal(1024, AiStructuredExtractionPipeline.ResolveOutputCap(null, ollamaMaxTokens: 1024, importMaxOutputTokens: 3072, numCtx: 16384));
        Assert.Equal(3072, AiStructuredExtractionPipeline.ResolveOutputCap(null, ollamaMaxTokens: 8192, importMaxOutputTokens: 99999, numCtx: 16384));
    }
}
