using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

public sealed class ImportAiModelResolverTests
{
    [Fact]
    public void TryResolvePlatformImportModel_rejects_embedding_model()
    {
        var ok = ImportAiModelResolver.TryResolvePlatformImportModel(
            "ollama:nomic-embed-text:latest",
            NullLogger.Instance,
            out _);

        Assert.False(ok);
    }

    [Fact]
    public void TryResolvePlatformImportModel_accepts_chat_model()
    {
        var ok = ImportAiModelResolver.TryResolvePlatformImportModel(
            "qwen2.5:7b-instruct",
            NullLogger.Instance,
            out var modelRef);

        Assert.True(ok);
        Assert.Contains("qwen2.5", modelRef.ProviderModelId, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveServerImportModel_uses_invoice_import_then_default()
    {
        var settings = new OllamaSettings
        {
            InvoiceImportModel = "qwen2.5:7b-instruct",
            DefaultModel = "mistral"
        };

        var resolved = ImportAiModelResolver.ResolveServerImportModel(settings);
        Assert.Contains("qwen2.5", resolved.ProviderModelId, StringComparison.OrdinalIgnoreCase);
    }

    // ── Modèle vision des relevés bancaires (lecture GLM-OCR de toute page) ─────────────────────

    private const string GlmOcr = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";

    [Fact]
    public void ResolveBankStatementVisionModelId_prefers_the_explicit_statement_key()
    {
        var settings = new OllamaSettings
        {
            InvoiceImportVisionModel = "gemma3:4b",
            BankStatementImportVisionModel = $"  {GlmOcr}  ",
        };

        Assert.Equal(GlmOcr, ImportAiModelResolver.ResolveBankStatementVisionModelId(settings));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void ResolveBankStatementVisionModelId_inherits_the_invoice_vision_model_when_empty(string? statementModel)
    {
        var settings = new OllamaSettings
        {
            InvoiceImportVisionModel = GlmOcr,
            BankStatementImportVisionModel = statementModel!,
        };

        Assert.Equal(GlmOcr, ImportAiModelResolver.ResolveBankStatementVisionModelId(settings));
    }

    [Fact]
    public void ResolveBankStatementVisionModelId_is_null_when_no_vision_model_is_configured()
    {
        var settings = new OllamaSettings
        {
            InvoiceImportVisionModel = " ",
            BankStatementImportVisionModel = "",
        };

        Assert.Null(ImportAiModelResolver.ResolveBankStatementVisionModelId(settings));
    }

    [Fact]
    public void Resolved_bank_statement_vision_model_is_an_ollama_reference_without_prefix()
    {
        var settings = new OllamaSettings { BankStatementImportVisionModel = GlmOcr };

        var parsed = ModelRef.Parse(ImportAiModelResolver.ResolveBankStatementVisionModelId(settings));

        Assert.Equal(LlmProviderKind.Ollama, parsed.Kind);
        Assert.Equal(GlmOcr, parsed.ProviderModelId);
        Assert.Equal($"{ModelRef.OllamaPrefix}{GlmOcr}", parsed.CanonicalModelRef);
    }

    [Fact]
    public void ResolveServerImportModel_returns_the_text_fallback_with_a_canonical_ollama_prefix()
    {
        var settings = new OllamaSettings { InvoiceImportModel = "qwen2.5:7b-instruct", DefaultModel = "mistral" };

        var resolved = ImportAiModelResolver.ResolveServerImportModel(settings);

        Assert.Equal(LlmProviderKind.Ollama, resolved.Kind);
        Assert.Equal("qwen2.5:7b-instruct", resolved.ProviderModelId);
        Assert.Equal("ollama:qwen2.5:7b-instruct", resolved.CanonicalModelRef);
    }

    [Fact]
    public void DetectGlmOcrModel_recognizes_glm_ocr_ids()
    {
        Assert.True(ImportAiModelResolver.DetectGlmOcrModel(GlmOcr));
        Assert.False(ImportAiModelResolver.DetectGlmOcrModel("qwen2.5:7b-instruct"));
    }

    [Fact]
    public void ResolveVisionStrategy_maps_glm_ocr_to_optimized()
    {
        var glm = ModelRef.Parse($"ollama:{GlmOcr}");
        var qwen = ModelRef.Parse("ollama:qwen2.5:7b-instruct");

        Assert.Equal(ImportVisionStrategy.GlmOcrOptimized, ImportAiModelResolver.ResolveVisionStrategy(glm));
        Assert.Equal(ImportVisionStrategy.None, ImportAiModelResolver.ResolveVisionStrategy(qwen));
    }

    [Fact]
    public void ResolveServerImportModel_falls_back_to_default_model_then_mistral()
    {
        Assert.Equal(
            "qwen2.5:3b-instruct",
            ImportAiModelResolver.ResolveServerImportModel(new OllamaSettings { InvoiceImportModel = "", DefaultModel = "qwen2.5:3b-instruct" }).ProviderModelId);

        Assert.Equal(
            "mistral",
            ImportAiModelResolver.ResolveServerImportModel(new OllamaSettings { InvoiceImportModel = " ", DefaultModel = "" }).ProviderModelId);
    }
}
