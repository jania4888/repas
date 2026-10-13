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
    private readonly Mock<IBankStatementImportService> _service = new();

    private BankStatementImportController Controller(
        bool enabled, bool allDocuments = false, BankStatementAiAvailability? ai = null, bool tabularEnabled = false, string? suspenseAccountNumber = null)
    {
        _user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(true);
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(ai ?? new BankStatementAiAvailability(true, "local", "ollama:test", null));
        _service.Setup(s => s.GetSuspenseAccountNumberAsync(It.IsAny<CancellationToken>())).ReturnsAsync(suspenseAccountNumber);
        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(Guid.NewGuid());
        return new BankStatementImportController(
            _service.Object,
            Mock.Of<IBankStatementTabularImportService>(),
            Mock.Of<IBankStatementPostingService>(),
            _ai.Object,
            BankStatementProfileRegistry.Default,
            _user.Object,
            tenant.Object,
            Options.Create(new AccountingSettings
            {
                BankStatementAiPostingEnabled = enabled,
                BankStatementAiForAllDocumentsEnabled = allDocuments,
                BankStatementTabularImportEnabled = tabularEnabled
            }));
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
    public async Task Ready_vision_engine_publishes_no_unavailability_reason()
    {
        var caps = Capabilities(await Controller(enabled: true, allDocuments: true,
            ai: new BankStatementAiAvailability(true, "local", "ollama:qwen2.5:7b-instruct", null,
                Engine: BankStatementAiEngines.Vision, VisionModelRef: "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0")).GetCapabilities());

        Assert.True(caps.AiAvailable);
        Assert.Equal(BankStatementAiEngines.Vision, caps.AiEngine);
        Assert.Null(caps.AiUnavailableReason);
        Assert.Null(caps.VisionUnavailableReason);
        Assert.Equal(50, caps.MaxPages);
    }

    [Fact]
    public async Task Missing_glm_ocr_is_reported_as_a_vision_reason_while_the_text_engine_stays_available()
    {
        var caps = Capabilities(await Controller(enabled: true, allDocuments: true,
            ai: new BankStatementAiAvailability(true, "local", "ollama:qwen2.5:7b-instruct", null,
                Engine: BankStatementAiEngines.Text, VisionUnavailableReason: "modèle GLM-OCR non installé sur le serveur")).GetCapabilities());

        Assert.True(caps.AiAvailable);
        Assert.Equal(BankStatementAiEngines.Text, caps.AiEngine);
        Assert.Null(caps.AiUnavailableReason);
        Assert.Equal("modèle GLM-OCR non installé sur le serveur", caps.VisionUnavailableReason);
    }

    [Fact]
    public async Task Unreachable_engine_is_reported_with_a_stable_reason_code_and_never_a_raw_error()
    {
        var caps = Capabilities(await Controller(enabled: true, allDocuments: true,
            ai: BankStatementAiAvailability.Unavailable("Connection refused (127.0.0.1:11434)", BankStatementAiAvailabilityReasons.EngineUnavailable)).GetCapabilities());

        Assert.False(caps.AiAvailable);
        Assert.Equal(BankStatementAiAvailabilityReasons.EngineUnavailable, caps.AiUnavailableReason);
        Assert.Null(caps.VisionUnavailableReason);
        Assert.DoesNotContain("11434", caps.AiUnavailableReason, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unavailable_engine_without_a_reason_code_falls_back_to_engine_unavailable()
    {
        var caps = Capabilities(await Controller(enabled: true,
            ai: new BankStatementAiAvailability(false, "local", null, "le moteur IA ne répond pas")).GetCapabilities());

        Assert.False(caps.AiAvailable);
        Assert.Equal(BankStatementAiAvailabilityReasons.EngineUnavailable, caps.AiUnavailableReason);
    }

    [Fact]
    public async Task Disabled_feature_or_screens_without_ai_probe_publish_no_reason()
    {
        Assert.Null(Capabilities(await Controller(enabled: false).GetCapabilities()).AiUnavailableReason);
        Assert.Null(Capabilities(await Controller(enabled: true).GetCapabilities(includeAi: false)).AiUnavailableReason);
    }

    [Fact]
    public async Task Other_actions_stay_hidden_when_the_feature_is_off()
    {
        var controller = Controller(enabled: false);

        Assert.IsType<NotFoundResult>(await controller.Get(Guid.NewGuid(), CancellationToken.None));
        Assert.IsType<NotFoundResult>(await controller.GetProposals(Guid.NewGuid(), null, CancellationToken.None));
        Assert.IsType<NotFoundResult>(await controller.Retry(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task Tabular_capabilities_are_off_by_default_even_when_ai_import_is_enabled()
    {
        var caps = Capabilities(await Controller(enabled: true).GetCapabilities());

        Assert.False(caps.TabularEnabled);
        Assert.Empty(caps.TabularExtensions);
    }

    [Fact]
    public async Task Tabular_capabilities_require_both_the_ai_import_switch_and_the_tabular_sub_flag()
    {
        var caps = Capabilities(await Controller(enabled: true, tabularEnabled: true).GetCapabilities());

        Assert.True(caps.TabularEnabled);
        Assert.Equal(new[] { ".csv", ".xlsx" }, caps.TabularExtensions);
        Assert.True(caps.MaxTabularRows > 0);
        Assert.True(caps.MaxAtomicLines > 0);
    }

    [Fact]
    public async Task Tabular_capabilities_stay_off_when_the_master_switch_is_off_even_with_the_sub_flag_on()
    {
        var caps = Capabilities(await Controller(enabled: false, tabularEnabled: true).GetCapabilities());

        Assert.False(caps.TabularEnabled);
        Assert.Empty(caps.TabularExtensions);
    }

    [Fact]
    public async Task Suspense_account_number_is_resolved_through_the_import_service_and_published_as_is()
    {
        var caps = Capabilities(await Controller(enabled: true, suspenseAccountNumber: "471000").GetCapabilities());

        Assert.Equal("471000", caps.SuspenseAccountNumber);
    }

    [Fact]
    public async Task Disabled_feature_never_resolves_the_suspense_account()
    {
        Capabilities(await Controller(enabled: false).GetCapabilities());

        _service.Verify(s => s.GetSuspenseAccountNumberAsync(It.IsAny<CancellationToken>()), Times.Never);
    }
}
