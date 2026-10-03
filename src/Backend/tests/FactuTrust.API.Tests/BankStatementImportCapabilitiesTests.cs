using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Les capacités sont lues à chaque ouverture de la saisie manuelle et du rapprochement : fonctionnalité
/// éteinte, elles répondent 200 <c>enabled=false</c> (un 404 serait journalisé en rouge par le navigateur
/// à chaque visite) sans rien révéler ni sonder le moteur IA. Les autres actions restent en 404.
/// </summary>
public sealed class BankStatementImportCapabilitiesTests
{
    private readonly Mock<IBankStatementAiExtraction> _ai = new();
    private readonly Mock<ICurrentUser> _user = new();

    private BankStatementImportController Controller(bool enabled, bool allDocuments = false)
    {
        _user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(true);
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BankStatementAiAvailability(true, "local", "ollama:test", null));
        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(Guid.NewGuid());
        return new BankStatementImportController(
            Mock.Of<IBankStatementImportService>(),
            Mock.Of<IBankStatementPostingService>(),
            _ai.Object,
            BankStatementProfileRegistry.Default,
            _user.Object,
            tenant.Object,
            Options.Create(new AccountingSettings { BankStatementAiPostingEnabled = enabled, BankStatementAiForAllDocumentsEnabled = allDocuments }));
    }

    private static BankStatementImportCapabilitiesDto Capabilities(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<ApiResponse<BankStatementImportCapabilitiesDto>>(ok.Value);
        Assert.True(body.Success);
        return body.Data!;
    }

    [Fact]
    public async Task Disabled_feature_answers_200_without_revealing_anything_nor_probing_the_ai()
    {
        var caps = Capabilities(await Controller(enabled: false).GetCapabilities());

        Assert.False(caps.Enabled);
        Assert.False(caps.AiAvailable);
        Assert.Null(caps.AiProviderKind);
        Assert.Equal(0, caps.MaxFileBytes);
        Assert.Empty(caps.AcceptedExtensions);
        Assert.Empty(caps.RecognizedBanks);
        _ai.Verify(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Enabled_feature_keeps_the_published_shape()
    {
        var caps = Capabilities(await Controller(enabled: true).GetCapabilities());

        Assert.True(caps.Enabled);
        Assert.True(caps.AiAvailable);
        Assert.Equal("local", caps.AiProviderKind);
        Assert.Equal(10 * 1024 * 1024, caps.MaxFileBytes);
        Assert.Contains(".pdf", caps.AcceptedExtensions);
        Assert.Contains("BIAT", caps.RecognizedBanks);
        Assert.Equal(caps.RecognizedBanks.Count, caps.RecognizedBanks.Distinct().Count());
    }

    [Fact]
    public async Task Screens_that_only_need_the_switch_do_not_probe_the_ai_engine()
    {
        var caps = Capabilities(await Controller(enabled: true).GetCapabilities(includeAi: false));

        Assert.True(caps.Enabled);
        Assert.False(caps.AiAvailable);
        _ai.Verify(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(false, false, false)]
    [InlineData(false, true, false)]
    [InlineData(true, false, false)]
    [InlineData(true, true, true)]
    public async Task All_documents_via_ai_needs_both_switches_even_without_ai_probe(bool enabled, bool allDocuments, bool expected)
    {
        var caps = Capabilities(await Controller(enabled, allDocuments).GetCapabilities(includeAi: false));

        Assert.Equal(expected, caps.AllDocumentsViaAi);
        _ai.Verify(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Other_actions_stay_hidden_when_the_feature_is_off()
    {
        var controller = Controller(enabled: false);

        Assert.IsType<NotFoundResult>(await controller.Get(Guid.NewGuid(), CancellationToken.None));
        Assert.IsType<NotFoundResult>(await controller.GetProposals(Guid.NewGuid(), CancellationToken.None));
    }
}
