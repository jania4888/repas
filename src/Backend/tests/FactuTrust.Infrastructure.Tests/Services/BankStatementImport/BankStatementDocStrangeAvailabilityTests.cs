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
/// Qui lit un relevé : la carte Docstrange du back-office, et elle seule.
///
/// <para>Depuis le 2026-10-08, le second interrupteur <c>DocStrangeEnabled</c> d'<c>appsettings</c>
/// n'existe plus : la carte gouverne les deux flux (pièces et relevés), comme pour les factures.
/// Ces tests épinglent la nouvelle règle ET le fait que <c>AiComplementAllowExternal</c>, qui
/// gouverne les fournisseurs <b>LLM</b>, continue de ne rien décider ici — ni dans un sens, ni
/// dans l'autre.</para>
/// </summary>
public sealed class BankStatementDocStrangeAvailabilityTests
{
    private const string TextModel = "qwen2.5:7b-instruct";

    [Fact]
    public async Task A_configured_card_makes_docstrange_the_announced_reader()
    {
        var availability = await Sut(AvailableProvider()).CheckAvailabilityAsync();

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
    public async Task A_card_without_a_usable_key_changes_nothing()
    {
        // IsAvailableAsync porte les DEUX conditions : carte activee ET cle dechiffrable. Faux ici,
        // donc la lecture locale reprend exactement son cours.
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var availability = await Sut(provider).CheckAvailabilityAsync();

        Assert.Equal("local", availability.ProviderKind);
    }

    [Fact]
    public async Task No_provider_registered_at_all_falls_back_to_the_local_reading()
    {
        var availability = await Sut(provider: null).CheckAvailabilityAsync();

        Assert.Equal("local", availability.ProviderKind);
    }

    [Fact]
    public async Task Allowing_external_llm_providers_neither_enables_nor_disables_docstrange()
    {
        // Les deux chemins de sortie restent INDEPENDANTS : ouvrir celui des LLM ne change pas
        // la reponse de Docstrange, et la fermer ne la ferme pas non plus.
        var opened = await Sut(AvailableProvider(), allowExternal: true).CheckAvailabilityAsync();
        var closed = await Sut(AvailableProvider(), allowExternal: false).CheckAvailabilityAsync();

        Assert.Equal("docstrange", opened.ProviderKind);
        Assert.Equal("docstrange", closed.ProviderKind);
    }

    [Fact]
    public async Task Docstrange_reads_even_when_the_local_engine_is_down()
    {
        // Le service externe ne depend d'aucun modele local : il doit rester disponible moteur arrete.
        var availability = await Sut(AvailableProvider(), ollamaUp: false).CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal("docstrange", availability.ProviderKind);
    }

    [Fact]
    public async Task Docstrange_does_not_depend_on_the_local_vision_reading_switch()
    {
        // VisionReadingEnabled gouverne le modele vision LOCAL. Docstrange n'en est pas un : le
        // confondre renverrait le relevé vers le modele texte local, c'est-a-dire vers l'IA que
        // l'activation de la carte est censee ecarter.
        var availability = await Sut(AvailableProvider(), visionReadingEnabled: false).CheckAvailabilityAsync();

        Assert.True(availability.Available);
        Assert.Equal("docstrange", availability.ProviderKind);
        Assert.Equal(BankStatementAiEngines.Vision, availability.Engine);
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
        Mock<IDocumentExtractionProvider>? provider,
        bool allowExternal = false,
        bool ollamaUp = true,
        bool visionReadingEnabled = true)
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
                    VisionReadingEnabled = visionReadingEnabled,
                    AiComplementAllowExternal = allowExternal
                }
            }),
            provider?.Object);
    }
}
