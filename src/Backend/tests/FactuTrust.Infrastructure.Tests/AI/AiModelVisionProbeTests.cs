using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// La capacité vision d'un modèle Ollama est <b>lue</b> sur le moteur, plus devinée d'après son
/// nom. Ces états figent la régression qui a mis l'import en échec : <c>surya-ocr-2-gguf</c> et
/// <c>qwen3-vl</c> étaient classés non multimodaux, donc aucun modèle vision n'était transmis et
/// une photo de facture échouait sur « OCR vide et aucun modèle d'import multimodal configuré ».
/// </summary>
public sealed class AiModelVisionProbeTests
{
    private const string Surya = "hf.co/datalab-to/surya-ocr-2-gguf:latest";
    private const string Qwen3Vl = "hf.co/Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M";
    private const string DeepSeekOcr = "hf.co/sabafallah/DeepSeek-OCR-2-GGUF:Q4_K_M";
    private const string GlmOcr = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";
    private const string TextOnly = "qwen2.5:7b-instruct";

    private static ParsedModelRef Ref(string id) => ModelRef.Parse($"{ModelRef.OllamaPrefix}{id}");

    private static OllamaModelVisionProbe Probe(Mock<IOllamaClient> client) =>
        new(client.Object, NullLogger<OllamaModelVisionProbe>.Instance);

    private static Mock<IOllamaClient> ClientReturning(params string[]? capabilities)
    {
        var client = new Mock<IOllamaClient>();
        client.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new OllamaModelShowResponse
            {
                Capabilities = capabilities?.ToList()
            });
        return client;
    }

    [Theory]
    [InlineData(Surya)]
    [InlineData(Qwen3Vl)]
    [InlineData(DeepSeekOcr)]
    [InlineData(GlmOcr)]
    public async Task Vision_declaree_par_le_moteur_est_retenue(string modelId)
    {
        var probe = Probe(ClientReturning("completion", "vision"));

        Assert.True(await probe.TryDetectVisionAsync(Ref(modelId)));
    }

    [Fact]
    public async Task Absence_de_vision_declaree_vaut_refus_meme_si_le_nom_suggere_le_contraire()
    {
        // Le moteur fait foi dans les deux sens : un modèle nommé « …-vision » mais sans
        // projecteur ne doit pas recevoir d'images.
        var probe = Probe(ClientReturning("completion", "tools"));

        Assert.False(await probe.TryDetectVisionAsync(Ref("un-modele-vision-sans-projecteur")));
    }

    [Fact]
    public async Task Capacites_absentes_restent_inconnues()
    {
        // Moteur trop ancien pour publier ses capacités : l'appelant doit retomber sur le nom.
        Assert.Null(await Probe(ClientReturning(null)).TryDetectVisionAsync(Ref(Surya)));
        Assert.Null(await Probe(ClientReturning()).TryDetectVisionAsync(Ref(Surya)));
    }

    [Fact]
    public async Task Modele_introuvable_ou_moteur_en_erreur_reste_inconnu()
    {
        var absent = new Mock<IOllamaClient>();
        absent.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((OllamaModelShowResponse?)null);
        Assert.Null(await Probe(absent).TryDetectVisionAsync(Ref(Surya)));

        var broken = new Mock<IOllamaClient>();
        broken.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("moteur injoignable"));
        Assert.Null(await Probe(broken).TryDetectVisionAsync(Ref(Surya)));
    }

    [Fact]
    public async Task Modele_hors_ollama_nest_jamais_sonde()
    {
        var client = ClientReturning("completion", "vision");

        Assert.Null(await Probe(client).TryDetectVisionAsync(
            ModelRef.Parse($"{ModelRef.OpenRouterPrefix}openai/gpt-4o")));

        client.Verify(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Annulation_demandee_remonte()
    {
        var client = new Mock<IOllamaClient>();
        client.Setup(c => c.ShowModelAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => Probe(client).TryDetectVisionAsync(Ref(Surya), cts.Token));
    }

    [Theory]
    [InlineData(Surya, true)]
    [InlineData(Qwen3Vl, true)]
    [InlineData(DeepSeekOcr, true)]
    [InlineData(GlmOcr, true)]
    [InlineData("granite-vision-3.2-2b", true)]
    [InlineData("gemma3:4b", true)]
    [InlineData(TextOnly, false)]
    [InlineData("hf.co/lmstudio-community/Qwen3-0.6B-GGUF:Q6_K", false)]
    public void Le_repli_par_le_nom_couvre_les_familles_installees(string modelId, bool expected)
    {
        // Utilisé quand le moteur ne répond pas : il doit au moins reconnaître les modèles
        // réellement déployés.
        Assert.Equal(expected, AiModelCapabilityDetector.DetectVisionSupport(modelId));
    }

    [Fact]
    public void Le_moteur_prime_sur_le_nom_dans_les_deux_sens()
    {
        Assert.True(AiModelCapabilityDetector.ResolveVisionSupport(true, TextOnly));
        Assert.False(AiModelCapabilityDetector.ResolveVisionSupport(false, GlmOcr));
        Assert.True(AiModelCapabilityDetector.ResolveVisionSupport(null, GlmOcr));
        Assert.False(AiModelCapabilityDetector.ResolveVisionSupport(null, TextOnly));
    }

    [Fact]
    public async Task La_resolution_d_import_transmet_le_modele_vision_declare()
    {
        // Le bout en bout du défaut : avec Surya sélectionné en plateforme, l'import doit
        // maintenant recevoir un identifiant de modèle vision.
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync($"{ModelRef.OllamaPrefix}{Surya}");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Probe(ClientReturning("completion", "vision")),
            Options.Create(new OllamaSettings { HonorLegacyImportVisionModels = false }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var resolution = await service.ResolveAsync(null);

        Assert.True(resolution.IsVisionCapable);
        Assert.Equal(ImportVisionStrategy.GenericMultimodal, resolution.VisionStrategy);
        Assert.Equal(Surya, await service.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: false));
    }

    [Fact]
    public async Task Un_modele_texte_declare_sans_vision_ne_recoit_pas_d_images()
    {
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync($"{ModelRef.OllamaPrefix}{TextOnly}");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Probe(ClientReturning("completion", "tools")),
            Options.Create(new OllamaSettings { HonorLegacyImportVisionModels = false }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var resolution = await service.ResolveAsync(null);

        Assert.False(resolution.IsVisionCapable);
        Assert.Equal(ImportVisionStrategy.None, resolution.VisionStrategy);
        Assert.Null(await service.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: false));
    }

    [Fact]
    public async Task GLM_OCR_conserve_sa_strategie_dediee()
    {
        // Non-régression de la configuration en service aujourd'hui.
        var platform = new Mock<IPlatformAiSettingsService>();
        platform.Setup(x => x.GetInvoiceImportModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync($"{ModelRef.OllamaPrefix}{GlmOcr}");

        var service = new ImportAiModelResolutionService(
            platform.Object,
            Probe(ClientReturning("completion", "vision")),
            Options.Create(new OllamaSettings { HonorLegacyImportVisionModels = false }),
            NullLogger<ImportAiModelResolutionService>.Instance);

        var resolution = await service.ResolveAsync(null);

        Assert.Equal(ImportVisionStrategy.GlmOcrOptimized, resolution.VisionStrategy);
    }
}
