using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Services.DocumentImport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Branchement d'un service d'extraction documentaire externe sur l'import de pièces comptables.
///
/// <para>Deux garanties, symétriques :</para>
/// <list type="bullet">
/// <item><b>Fournisseur actif</b> : il est le SEUL lecteur. Ni parseur natif, ni LLM — même quand
/// il échoue. Un échec est dit à l'utilisateur, jamais rattrapé en silence.</item>
/// <item><b>Fournisseur inactif</b> : le chemin historique est emprunté à l'identique. C'est la
/// garantie de non-régression, et elle est réversible d'un clic au back-office.</item>
/// </list>
/// </summary>
public sealed class AccountingDocumentExternalExtractionTests
{
    /// <summary>
    /// Réponse VERBATIM : tous les montants en chaîne, avec la virgule tunisienne.
    /// 1 250,500 dinars = 1250.500, et surtout PAS 1250500.
    /// </summary>
    private const string VerbatimJson = """
        {
          "documentType": "INVOICE",
          "documentNumber": "FA-2026-0042",
          "issueDate": "2026-03-11",
          "currency": "TND",
          "seller": { "name": "FOURNISSEUR DEMO" },
          "lines": [
            { "designation": "Prestation", "quantity": "2", "unitPriceHt": "625,250", "vatRatePercent": "19" }
          ],
          "totalHt": "1 250,500",
          "totalVat": "237,595",
          "totalTtc": "1488,095",
          "confidence": "high",
          "warnings": []
        }
        """;

    [Fact]
    public async Task External_extraction_wins_and_tunisian_amounts_survive_the_round_trip()
    {
        var provider = AvailableProvider(Result.Success(VerbatimJson));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("FA-2026-0042", result.Value.DocumentNumber);
        Assert.Equal(AccountingDocumentExtractionMethods.ExternalExtraction, result.Value.ExtractionMethod);

        // LE point du lot : la virgule decimale survit. Demander des NOMBRES a Docstrange
        // rendrait 1250500 au lieu de 1250.500 -- mille fois trop, et silencieusement.
        Assert.Equal(1250.500m, result.Value.TotalHt);
        Assert.Equal(237.595m, result.Value.TotalVat);
        Assert.Equal(1488.095m, result.Value.TotalTtc);
        var line = Assert.Single(result.Value.Lines);
        Assert.Equal(625.250m, line.UnitPriceHt);

        // Le pipeline LLM n'a PAS ete sollicite (mock strict : tout appel aurait leve).
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Without_a_provider_the_existing_ai_path_is_used_unchanged()
    {
        var pipeline = PipelineReturning(VerbatimJson);

        var result = await CreateSut(pipeline, provider: null).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Methode du chemin historique, pas celle du service externe.
        Assert.NotEqual(AccountingDocumentExtractionMethods.ExternalExtraction, result.Value.ExtractionMethod);
        pipeline.Verify(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()), Times.AtLeastOnce);
    }

    [Fact]
    public async Task A_disabled_provider_is_never_called()
    {
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);
        var pipeline = PipelineReturning(VerbatimJson);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotEqual(AccountingDocumentExtractionMethods.ExternalExtraction, result.Value.ExtractionMethod);
        // Strict : une extraction aurait leve. Seule la disponibilite a ete demandee.
        provider.Verify(x => x.IsAvailableAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_failing_provider_fails_the_import_and_never_calls_the_llm()
    {
        var provider = AvailableProvider(
            Result.Failure<string>(Error.Validation("DocStrange", "Le quota Docstrange est épuisé.")));
        // Strict : le moindre appel au pipeline ferait echouer le test.
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        // Le message du client, deja assaini et actionnable, est repris tel quel.
        Assert.Contains("quota", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_unparseable_provider_answer_fails_the_import_and_never_calls_the_llm()
    {
        var provider = AvailableProvider(Result.Success("ceci n'est pas du JSON"));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("inexploitable", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task A_throwing_provider_fails_the_import_without_propagating_and_without_leaking()
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("panne interne cote fournisseur"));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("injoignable", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        // Le detail technique reste au journal (CWE-209).
        Assert.DoesNotContain("panne interne", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_active_provider_bypasses_the_native_InstaFact_parser()
    {
        // Conséquence ASSUMÉE de la décision « tout passe par Docstrange » : même une facture
        // InstaFact, que le parseur local lit parfaitement et gratuitement, part chez le tiers.
        // Épinglé ici pour que le jour où l'on veut revenir en arrière, le test le dise.
        var realInstaFactInvoice = File.ReadAllBytes(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "accounting-documents", "Facture_FAC-2026-000012.pdf"));

        var provider = AvailableProvider(Result.Success(VerbatimJson));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(
            new AccountingDocumentExtractionRequest
            {
                FileStream = new MemoryStream(realInstaFactInvoice),
                FileName = "Facture_FAC-2026-000012.pdf",
                ContentType = "application/pdf",
                AllowAiFallback = true
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(AccountingDocumentExtractionMethods.ExternalExtraction, result.Value.ExtractionMethod);
        Assert.NotEqual(AccountingDocumentExtractionMethods.NativePdf, result.Value.ExtractionMethod);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_active_provider_still_requires_the_ai_permission()
    {
        // Le service externe fait SORTIR des données : l'activer ne doit dispenser personne de
        // la permission. Mock strict : le fournisseur ne doit même pas être sollicité.
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).ExtractAsync(
            new AccountingDocumentExtractionRequest
            {
                FileStream = new MemoryStream(Encoding.UTF8.GetBytes("image-factice")),
                FileName = "facture.png",
                ContentType = "image/png",
                AllowAiFallback = false
            },
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("autorisation", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public void The_verbatim_schema_types_every_amount_as_a_string()
    {
        // Garde de conception : si quelqu'un retypait un montant en « number », les montants
        // sortiraient multiplies par 1000 sans que rien ne le signale.
        var root = LlmOutputSchemas.AccountingDocumentVerbatim.GetProperty("properties");

        foreach (var name in new[] { "totalHt", "totalVat", "totalTtc", "fodecAmount", "fiscalStampAmount", "withholdingAmount" })
        {
            var types = root.GetProperty(name).GetProperty("type").EnumerateArray().Select(x => x.GetString()).ToArray();
            Assert.Contains("string", types);
            Assert.DoesNotContain("number", types);
        }

        var lineProps = root.GetProperty("lines").GetProperty("items").GetProperty("properties");
        foreach (var name in new[] { "quantity", "unitPriceHt", "discountPercent", "vatRatePercent" })
        {
            var types = lineProps.GetProperty(name).GetProperty("type").EnumerateArray().Select(x => x.GetString()).ToArray();
            Assert.Contains("string", types);
            Assert.DoesNotContain("number", types);
            Assert.DoesNotContain("integer", types);
        }
    }

    // ---- outillage -----------------------------------------------------------------------

    private static AccountingDocumentExtractionRequest Request() => new()
    {
        FileStream = new MemoryStream(Encoding.UTF8.GetBytes("image-factice")),
        FileName = "facture.png",
        ContentType = "image/png",
        AllowAiFallback = true
    };

    private static Mock<IDocumentExtractionProvider> AvailableProvider(Result<string> answer)
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(answer);
        return provider;
    }

    private static Mock<IAiStructuredExtractionPipeline> PipelineReturning(string raw)
    {
        var pipeline = new Mock<IAiStructuredExtractionPipeline>();
        pipeline.Setup(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new AiStructuredExtractionOutcome(
                raw,
                new AiDocumentExtractionResult { Success = true, Format = "image", OcrApplied = true, Text = "FACTURE" },
                false,
                "ollama:qwen2.5:7b-instruct",
                VisionUsed: false,
                1,
                10)));
        return pipeline;
    }

    private static AccountingDocumentExtractor CreateSut(
        Mock<IAiStructuredExtractionPipeline> pipeline,
        Mock<IDocumentExtractionProvider>? provider) =>
        new(
            new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance),
            pipeline.Object,
            Options.Create(new OllamaSettings()),
            NullLogger<AccountingDocumentExtractor>.Instance,
            provider?.Object);
}
