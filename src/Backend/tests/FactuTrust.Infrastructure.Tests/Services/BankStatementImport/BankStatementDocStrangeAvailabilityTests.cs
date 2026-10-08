using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Hangfire;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Autorisation d'envoyer des relevés au service d'extraction externe (Docstrange).
///
/// <para>Deux interrupteurs INDÉPENDANTS gouvernent les deux chemins de sortie des données :
/// <c>AiComplementAllowExternal</c> pour les fournisseurs LLM, <c>DocStrangeEnabled</c> pour ce
/// service. Ces tests vérifient qu'aucun n'ouvre la porte de l'autre.</para>
/// </summary>
public sealed class BankStatementDocStrangeAvailabilityTests
{
    private const string TextModel = "qwen2.5:7b-instruct";

    [Fact]
    public async Task Without_the_flag_the_provider_is_never_even_consulted()
    {
        // Mock strict : toute sollicitation du fournisseur ferait echouer le test.
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);

        var availability = await Sut(docStrangeEnabled: false, provider: provider).CheckAvailabilityAsync();

        Assert.Equal("local", availability.ProviderKind);
        provider.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task With_the_flag_and_a_configured_provider_the_statement_reading_is_announced_as_docstrange()
    {
        var provider = AvailableProvider();

        var availability = await Sut(docStrangeEnabled: true, provider: provider).CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal("docstrange", availability.ProviderKind);
        Assert.Equal(BankStatementAiEngines.Vision, availability.Engine);

        // ProviderKind est volontairement DISTINCT de « external » : les deux gardes
        // AiComplementAllowExternal continuent de ne gouverner que les fournisseurs LLM.
        Assert.NotEqual("external", availability.ProviderKind);

        // Aucun nom de modele ni secret n'est publie.
        Assert.Null(availability.ModelRef);
        Assert.Null(availability.VisionModelRef);
    }

    [Fact]
    public async Task The_flag_alone_without_a_key_changes_nothing()
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var availability = await Sut(docStrangeEnabled: true, provider: provider).CheckAvailabilityAsync();

        // Retombe sur la logique habituelle : le drapeau n'est PAS une autorisation a lui seul.
        Assert.Equal("local", availability.ProviderKind);
    }

    [Fact]
    public async Task Allowing_external_llm_providers_does_not_enable_docstrange()
    {
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);

        var availability = await Sut(docStrangeEnabled: false, provider: provider, allowExternal: true)
            .CheckAvailabilityAsync();

        Assert.NotEqual("docstrange", availability.ProviderKind);
        provider.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Docstrange_reads_even_when_the_local_engine_is_down()
    {
        // Le service externe ne depend d'aucun modele local : il doit rester disponible moteur arrete.
        var provider = AvailableProvider();

        var availability = await Sut(docStrangeEnabled: true, provider: provider, ollamaUp: false)
            .CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal("docstrange", availability.ProviderKind);
    }

    // ---- outillage -----------------------------------------------------------------------

    private static Mock<IDocumentExtractionProvider> AvailableProvider()
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        return provider;
    }

    private static BankStatementAiExtraction Sut(
        bool docStrangeEnabled,
        Mock<IDocumentExtractionProvider> provider,
        bool allowExternal = false,
        bool ollamaUp = true)
    {
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(p => p.ResolveModelRefAsync(null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ModelRef.Parse(TextModel));

        var ollama = new Mock<IOllamaClient>();
        ollama.Setup(o => o.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(ollamaUp);

        var readiness = new Mock<IOllamaModelReadinessChecker>();
        readiness.Setup(r => r.CheckAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelReadinessResult(true, null, null, null));

        var import = new Mock<IImportAiModelResolutionService>();
        import.Setup(x => x.ResolveEffectiveVisionModelIdAsync(null, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync("hf.co/ggml-org/GLM-OCR-GGUF:Q8_0");

        return new BankStatementAiExtraction(
            pipeline.Object,
            ollama.Object,
            readiness.Object,
            Mock.Of<IBackgroundJobClient>(),
            NullLogger<BankStatementAiExtraction>.Instance,
            import.Object,
            Options.Create(new OllamaSettings()),
            Options.Create(new AccountingSettings
            {
                BankStatementImport = new BankStatementImportLimits
                {
                    VisionReadingEnabled = true,
                    AiComplementAllowExternal = allowExternal,
                    DocStrangeEnabled = docStrangeEnabled
                }
            }),
            provider.Object);
    }
}
