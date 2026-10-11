using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// Import de facture du wizard (<c>POST /api/ai/invoice-import</c>) face au service d'extraction
/// externe.
///
/// <para>Ce chemin ignorait totalement Docstrange : il était 100 % LLM, service activé ou non.
/// C'était le défaut le plus net — et le moins visible, puisqu'il ne concerne pas l'écran où
/// l'anomalie a été constatée.</para>
/// </summary>
public sealed class InvoiceImportExternalExtractionTests
{
    /// <summary>Réponse VERBATIM : montants en chaîne, virgule tunisienne. 1 250,500 ≠ 1250500.</summary>
    private const string VerbatimJson = """
        {
          "documentType": "INVOICE",
          "invoiceNumber": "FA-2026-0042",
          "issueDate": "2026-03-11",
          "currency": "TND",
          "seller": { "name": "FOURNISSEUR DEMO" },
          "client": { "name": "CLIENT DEMO" },
          "lines": [
            { "designation": "Prestation", "quantity": "2", "unitPriceHT": "625,250", "vatRatePercent": "19" }
          ],
          "totals": { "totalHT": "1 250,500", "totalVat": "237,595", "totalTTC": "1488,095" },
          "confidence": "high",
          "warnings": []
        }
        """;

    [Fact]
    public async Task An_active_provider_reads_the_invoice_and_the_llm_is_never_called()
    {
        var provider = AvailableProvider(Result.Success(VerbatimJson));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("FA-2026-0042", result.Value.InvoiceNumber);

        // La virgule tunisienne survit : 1 250,500 dinars, pas 1 250 500.
        Assert.Equal(1250.500m, result.Value.Totals!.TotalHT);
        Assert.Equal(1488.095m, result.Value.Totals!.TotalTTC);

        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task A_failing_provider_fails_the_import_and_never_calls_the_llm()
    {
        var provider = AvailableProvider(
            Result.Failure<string>(Error.Validation("DocStrange", "Le quota Docstrange est épuisé.")));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("quota", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task A_throwing_provider_fails_without_propagating_and_without_leaking()
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("panne interne cote fournisseur"));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("injoignable", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("panne interne", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_unparseable_answer_fails_the_import_and_never_calls_the_llm()
    {
        var provider = AvailableProvider(Result.Success("ceci n'est pas du JSON"));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("inexploitable", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Without_a_provider_the_llm_path_is_used_unchanged()
    {
        // Non-régression : service inactif = comportement d'avant, bit à bit.
        var pipeline = PipelineReturning(VerbatimJson);

        var result = await CreateSut(pipeline, provider: null).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        pipeline.Verify(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_disabled_provider_is_never_asked_to_extract()
    {
        var provider = new Mock<IDocumentExtractionProvider>(MockBehavior.Strict);
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);
        var pipeline = PipelineReturning(VerbatimJson);

        var result = await CreateSut(pipeline, provider).HandleAsync(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Strict : une extraction aurait levé. Seule la disponibilité a été demandée.
        provider.Verify(x => x.IsAvailableAsync(It.IsAny<CancellationToken>()), Times.Once);
        pipeline.Verify(x => x.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void The_invoice_verbatim_schema_types_every_amount_as_a_string()
    {
        // Garde de conception : retyper un montant en « number » ferait sortir les montants
        // multipliés par 1000, silencieusement.
        var props = LlmOutputSchemas.InvoiceImportVerbatim.GetProperty("properties");

        var totals = props.GetProperty("totals").GetProperty("properties");
        foreach (var name in new[] { "totalHT", "totalVat", "totalTTC" })
        {
            var types = totals.GetProperty(name).GetProperty("type").EnumerateArray().Select(x => x.GetString()).ToArray();
            Assert.Contains("string", types);
            Assert.DoesNotContain("number", types);
        }

        var line = props.GetProperty("lines").GetProperty("items").GetProperty("properties");
        foreach (var name in new[] { "quantity", "unitPriceHT", "discountPercent", "vatRatePercent" })
        {
            var types = line.GetProperty(name).GetProperty("type").EnumerateArray().Select(x => x.GetString()).ToArray();
            Assert.Contains("string", types);
            Assert.DoesNotContain("number", types);
            Assert.DoesNotContain("integer", types);
        }
    }

    [Fact]
    public async Task The_invoice_wizard_sends_a_long_pdf_unchanged_because_the_page_window_is_out_of_scope()
    {
        // Hors périmètre : la fenêtre 2 + 3 ne concerne que l'import de pièce comptable.
        var original = FactuTrust.Infrastructure.Tests.Services.DocumentImport.InvoicePageMarkPdf.Create(8);
        byte[]? sent = null;
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .Callback<Stream, string, string, JsonElement, CancellationToken>((stream, _, _, _, _) =>
            {
                using var copy = new MemoryStream();
                stream.CopyTo(copy);
                sent = copy.ToArray();
            })
            .ReturnsAsync(Result.Success(VerbatimJson));

        await CreateSut(PipelineReturning(VerbatimJson), provider).HandleAsync(
            new ImportInvoiceFromFileCommand(new MemoryStream(original), "longue.pdf", "application/pdf"),
            CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(original, sent);
    }

    // ---- outillage -----------------------------------------------------------------------

    private static ImportInvoiceFromFileCommand Command() =>
        new(new MemoryStream(Encoding.UTF8.GetBytes("image-factice")), "facture.png", "image/png");

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

    private static ImportInvoiceFromFileHandler CreateSut(
        Mock<IAiStructuredExtractionPipeline> pipeline,
        Mock<IDocumentExtractionProvider>? provider)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<GetClientsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<ClientListDto> { Items = [], TotalCount = 0 });
        mediator.Setup(m => m.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = [], TotalCount = 0 }));

        return new ImportInvoiceFromFileHandler(
            Mock.Of<IOllamaClient>(),
            Mock.Of<IOpenAiChatCompletionsClient>(),
            Mock.Of<IAiDocumentTextExtractor>(),
            Mock.Of<IOllamaModelReadinessChecker>(),
            Mock.Of<IPlatformAiSettingsService>(),
            Mock.Of<IOllamaInferenceProfileResolver>(),
            mediator.Object,
            NullLogger<ImportInvoiceFromFileHandler>.Instance,
            Options.Create(new OllamaSettings()),
            pipeline.Object,
            importModelResolver: null,
            externalExtraction: provider?.Object);
    }
}
