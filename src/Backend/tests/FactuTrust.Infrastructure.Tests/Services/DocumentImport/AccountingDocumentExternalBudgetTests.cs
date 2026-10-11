using System.Text.Json;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Services.DocumentImport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.DocumentImport;

/// <summary>
/// Budget propre à l'import comptable : il garantit une réponse au navigateur avant le délai du front
/// et des proxys, sans confondre l'expiration du budget avec une annulation par le client.
/// </summary>
public sealed class AccountingDocumentExternalBudgetTests
{
    [Fact]
    public async Task An_expired_budget_returns_the_stable_message_when_the_provider_throws()
    {
        var provider = SlowProvider(throwOnCancel: true);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider, TimeSpan.FromMilliseconds(100))
            .ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(InvoicePdfReadingWindow.ExternalBudgetExceededMessage, result.Error.Description);
        pipeline.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_expired_budget_returns_the_stable_message_when_the_provider_converts_it_to_a_failure()
    {
        var provider = SlowProvider(throwOnCancel: false);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider, TimeSpan.FromMilliseconds(100))
            .ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(InvoicePdfReadingWindow.ExternalBudgetExceededMessage, result.Error.Description);
    }

    [Fact]
    public async Task A_cancellation_by_the_client_still_propagates()
    {
        var provider = SlowProvider(throwOnCancel: true);
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateSut(pipeline, provider, TimeSpan.FromSeconds(30)).ExtractAsync(Request(), cancelled.Token));
    }

    [Fact]
    public async Task A_provider_failure_inside_the_budget_keeps_its_own_message()
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<string>(Error.Validation("DocStrange.Quota", "Quota Docstrange épuisé.")));
        var pipeline = new Mock<IAiStructuredExtractionPipeline>(MockBehavior.Strict);

        var result = await CreateSut(pipeline, provider, TimeSpan.FromSeconds(30))
            .ExtractAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Quota Docstrange épuisé.", result.Error.Description);
    }

    private static Mock<IDocumentExtractionProvider> SlowProvider(bool throwOnCancel)
    {
        var provider = new Mock<IDocumentExtractionProvider>();
        provider.SetupGet(x => x.Name).Returns("docstrange");
        provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        provider.Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .Returns<Stream, string, string, JsonElement, CancellationToken>(async (_, _, _, _, token) =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), token);
                }
                catch (OperationCanceledException) when (!throwOnCancel)
                {
                    // Comportement de DocStrangeHttpClient : l'annulation non demandée par l'appelant
                    // devient un échec « injoignable ».
                    return Result.Failure<string>(Error.Validation("DocStrange", "Le service d'extraction Docstrange est injoignable."));
                }
                return Result.Success("{}");
            });
        return provider;
    }

    private static AccountingDocumentExtractionRequest Request() => new()
    {
        FileStream = new MemoryStream(InvoicePageMarkPdf.Create(2)),
        FileName = "court.pdf",
        ContentType = "application/pdf",
        AllowAiFallback = true
    };

    private static AccountingDocumentExtractor CreateSut(
        Mock<IAiStructuredExtractionPipeline> pipeline,
        Mock<IDocumentExtractionProvider> provider,
        TimeSpan budget) =>
        new(
            new InstaFactInvoicePdfParser(NullLogger<InstaFactInvoicePdfParser>.Instance),
            pipeline.Object,
            Options.Create(new OllamaSettings()),
            NullLogger<AccountingDocumentExtractor>.Instance,
            provider.Object,
            pageWindow: null,
            externalBudget: budget);
}
