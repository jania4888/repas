using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Matrice des flags de l'endpoint capacités (B-P0-08) : tout coupé ⇒ tout faux, le workbench
/// exige l'aperçu de plan, templates/pages sont subordonnés au workbench, les libellés de modèle
/// sont des noms humains (jamais la référence canonique) et le modèle avancé n'est annoncé que si
/// le flag EnableStudioAiAdvancedModel est levé ET qu'un modèle avancé est configuré en plateforme.
/// </summary>
public sealed class StudioAiCapabilitiesQueryTests
{
    private readonly Mock<IPlatformAiSettingsService> _platformAiSettings = new();

    public StudioAiCapabilitiesQueryTests()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        _platformAiSettings
            .Setup(s => s.GetStudioAiAdvancedModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
    }

    [Fact]
    public async Task All_flags_off_yields_every_capability_false()
    {
        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiPlanPreview = false,
            EnableStudioSystemGeneration = false,
            EnableStudioAiModifyTools = false,
            EnableStudioAiViewTools = false,
            EnableStudioAiReportTools = false,
            EnableStudioAiWorkbench = false,
            EnableStudioTemplates = false,
            EnableStudioPages = false,
            EnableStudioManyToMany = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = result.Value;
        Assert.False(dto.PlanPreviewEnabled);
        Assert.False(dto.SystemGenerationEnabled);
        Assert.False(dto.ModifyToolsEnabled);
        Assert.False(dto.ViewToolsEnabled);
        Assert.False(dto.ReportToolsEnabled);
        Assert.False(dto.WorkbenchEnabled);
        Assert.False(dto.TemplatesEnabled);
        Assert.False(dto.PagesEnabled);
        Assert.False(dto.AdvancedModelAvailable);
        Assert.Null(dto.AdvancedModelLabel);
        // Programme « Studio IA » (contrat A6) : les six drapeaux ajoutés en PR 2.1 sont tous faux.
        Assert.False(dto.ManyToManyEnabled);
        Assert.False(dto.RecordViewsEnabled);
        Assert.False(dto.RecordViewToolsEnabled);
        Assert.False(dto.SystemExportEnabled);
        Assert.False(dto.WorkflowsEnabled);
        Assert.False(dto.WorkflowToolsEnabled);
    }

    /// <summary>
    /// PR 2.1 : <c>ManyToManyEnabled</c> suit <c>Ollama:EnableStudioManyToMany</c> (indépendant du
    /// workbench) ; les autres drapeaux non livrés (outils de vues, export, workflows) restent faux tant
    /// que leur fonctionnalité n'existe pas — même quand tout le reste est levé. PR 2.3 :
    /// <c>RecordViewsEnabled</c> suit désormais <c>Ollama:EnableStudioRecordViews</c>.
    /// </summary>
    [Fact]
    public async Task ManyToMany_follows_its_flag_and_future_program_flags_stay_false()
    {
        var enabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioManyToMany = true,
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true,
            EnableStudioTemplates = true,
            EnableStudioPages = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(enabled.Value.ManyToManyEnabled);
        Assert.False(enabled.Value.RecordViewsEnabled); // pas de EnableStudioRecordViews ⇒ faux
        Assert.False(enabled.Value.RecordViewToolsEnabled);
        Assert.False(enabled.Value.SystemExportEnabled);
        Assert.False(enabled.Value.WorkflowsEnabled);
        Assert.False(enabled.Value.WorkflowToolsEnabled);

        // Le drapeau N‑N ne dépend pas du workbench : coupé ⇒ faux, même workbench actif.
        var disabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioManyToMany = false,
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.False(disabled.Value.ManyToManyEnabled);

        // Et inversement : N‑N levé sans workbench reste annoncé.
        var withoutWorkbench = await CreateHandler(new OllamaSettings
        {
            EnableStudioManyToMany = true,
            EnableStudioAiWorkbench = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.True(withoutWorkbench.Value.ManyToManyEnabled);
    }

    /// <summary>
    /// PR 2.3 : <c>RecordViewsEnabled</c> suit <c>Ollama:EnableStudioRecordViews</c> (indépendant du
    /// workbench). PR 2.4 : <c>RecordViewToolsEnabled</c> exige les TROIS drapeaux
    /// (<c>EnableStudioAiRecordViewTools</c> + <c>EnableStudioRecordViews</c> +
    /// <c>EnableStudioAiPlanPreview</c>) — ici il manque les deux derniers/premiers, donc faux.
    /// </summary>
    [Fact]
    public async Task RecordViews_follows_its_flag_and_view_tools_stay_false()
    {
        var enabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioRecordViews = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(enabled.Value.RecordViewsEnabled);
        Assert.False(enabled.Value.RecordViewToolsEnabled);

        var disabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioRecordViews = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.False(disabled.Value.RecordViewsEnabled);
    }

    /// <summary>
    /// PR 2.4 : les outils de vues enregistrées ne s'annoncent que si les TROIS drapeaux sont levés
    /// (flag dédié + vues enregistrées + aperçu de plan — un plan sans aperçu ne serait pas validable).
    /// </summary>
    [Fact]
    public async Task RecordViewTools_follows_its_three_flags()
    {
        var enabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiPlanPreview = true,
            EnableStudioRecordViews = true,
            EnableStudioAiRecordViewTools = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.True(enabled.Value.RecordViewToolsEnabled);

        // Chaque drapeau coupé à tour de rôle ⇒ faux.
        foreach (var settings in new[]
        {
            new OllamaSettings { EnableStudioAiPlanPreview = false, EnableStudioRecordViews = true, EnableStudioAiRecordViewTools = true },
            new OllamaSettings { EnableStudioAiPlanPreview = true, EnableStudioRecordViews = false, EnableStudioAiRecordViewTools = true },
            new OllamaSettings { EnableStudioAiPlanPreview = true, EnableStudioRecordViews = true, EnableStudioAiRecordViewTools = false }
        })
        {
            var result = await CreateHandler(settings).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
            Assert.False(result.Value.RecordViewToolsEnabled);
        }
    }

    /// <summary>
    /// PR 3.3 : <c>SystemExportEnabled</c> suit <c>Ollama:EnableStudioSystemExport</c>
    /// (indépendant du workbench) — levé ⇒ vrai, coupé ou absent ⇒ faux.
    /// </summary>
    [Fact]
    public async Task SystemExport_follows_its_flag()
    {
        var enabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioSystemExport = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.True(enabled.Value.SystemExportEnabled);

        var disabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioSystemExport = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.False(disabled.Value.SystemExportEnabled);
    }

    /// <summary>
    /// PR 4.1i : <c>WorkflowsEnabled</c> suit <c>Ollama:EnableStudioWorkflows</c> ; les outils de
    /// workflows (<c>WorkflowToolsEnabled</c>) restent faux tant que 4.3a n'est pas livrée.
    /// </summary>
    [Fact]
    public async Task Workflows_follow_their_flag_and_workflow_tools_stay_false()
    {
        var enabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioWorkflows = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(enabled.Value.WorkflowsEnabled);
        Assert.False(enabled.Value.WorkflowToolsEnabled);

        var disabled = await CreateHandler(new OllamaSettings
        {
            EnableStudioWorkflows = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.False(disabled.Value.WorkflowsEnabled);
        Assert.False(disabled.Value.WorkflowToolsEnabled);
    }

    [Fact]
    public async Task Workbench_requires_both_workbench_flag_and_plan_preview()
    {
        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(result.Value.WorkbenchEnabled);
    }

    [Fact]
    public async Task Workbench_flag_without_plan_preview_is_reported_disabled()
    {
        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(result.Value.PlanPreviewEnabled is false);
        Assert.False(result.Value.WorkbenchEnabled);
    }

    [Fact]
    public async Task Templates_and_pages_follow_the_workbench_gate()
    {
        var handler = CreateHandler(new OllamaSettings
        {
            EnableStudioAiPlanPreview = true,
            EnableStudioAiWorkbench = true,
            EnableStudioTemplates = true,
            EnableStudioPages = true
        });

        var enabled = await handler.Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.True(enabled.Value.TemplatesEnabled);
        Assert.True(enabled.Value.PagesEnabled);

        // Workbench coupé (ou incohérent) ⇒ templates et pages retombent à false.
        var withoutWorkbench = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiPlanPreview = true,
            EnableStudioAiWorkbench = false,
            EnableStudioTemplates = true,
            EnableStudioPages = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.False(withoutWorkbench.Value.TemplatesEnabled);
        Assert.False(withoutWorkbench.Value.PagesEnabled);
    }

    [Fact]
    public async Task Standard_model_label_strips_the_provider_prefix()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("ollama:qwen2.5:7b-instruct");

        var result = await CreateHandler(new OllamaSettings())
            .Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.Equal("qwen2.5:7b-instruct", result.Value.StandardModelLabel);
        Assert.DoesNotContain("ollama:", result.Value.StandardModelLabel);
    }

    [Fact]
    public async Task Standard_model_label_falls_back_to_settings_then_default_model()
    {
        var fromSettings = await CreateHandler(new OllamaSettings { StudioAiModel = "llama3.1:8b" })
            .Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.Equal("llama3.1:8b", fromSettings.Value.StandardModelLabel);

        var fromDefault = await CreateHandler(new OllamaSettings { StudioAiModel = "", DefaultModel = "mistral" })
            .Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);
        Assert.Equal("mistral", fromDefault.Value.StandardModelLabel);
    }

    [Fact]
    public async Task Ambiguous_model_reference_is_kept_raw()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("ollama:");

        var result = await CreateHandler(new OllamaSettings())
            .Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.Equal("ollama:", result.Value.StandardModelLabel);
    }

    [Fact]
    public async Task Advanced_model_is_not_exposed_when_the_flag_is_off()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiAdvancedModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("openrouter:qwen/qwen-2.5-72b-instruct");

        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true,
            EnableStudioAiAdvancedModel = false
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.False(result.Value.AdvancedModelAvailable);
        Assert.Null(result.Value.AdvancedModelLabel);
        // Flag baissé : on ne lit même pas la colonne plateforme.
        _platformAiSettings.Verify(
            s => s.GetStudioAiAdvancedModelRefAsync(It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Advanced_model_is_not_exposed_when_no_model_is_configured()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiAdvancedModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("   ");

        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true,
            EnableStudioAiAdvancedModel = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.False(result.Value.AdvancedModelAvailable);
        Assert.Null(result.Value.AdvancedModelLabel);
    }

    [Fact]
    public async Task Advanced_model_is_exposed_with_a_human_label_when_flag_and_model_are_set()
    {
        _platformAiSettings
            .Setup(s => s.GetStudioAiModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("ollama:qwen2.5:7b-instruct");
        _platformAiSettings
            .Setup(s => s.GetStudioAiAdvancedModelRefAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync("openrouter:qwen/qwen-2.5-72b-instruct");

        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true,
            EnableStudioAiAdvancedModel = true
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.True(result.Value.AdvancedModelAvailable);
        Assert.Equal("qwen/qwen-2.5-72b-instruct", result.Value.AdvancedModelLabel);
        Assert.Equal("qwen2.5:7b-instruct", result.Value.StandardModelLabel);
    }

    /// <summary>
    /// PR 4.3 : les outils de workflows ne s'annoncent que si les TROIS drapeaux sont levés
    /// (<c>EnableStudioWorkflows</c> + <c>EnableStudioAiWorkflowTools</c> +
    /// <c>EnableStudioAiPlanPreview</c> — règle centralisée <c>StudioAiPlanCreation.WorkflowToolsEnabled</c>).
    /// </summary>
    [Theory]
    [InlineData(true, true, true, true)]
    [InlineData(false, true, true, false)]
    [InlineData(true, false, true, false)]
    [InlineData(true, true, false, false)]
    public async Task Workflow_tools_enabled_only_when_workflows_ai_workflow_tools_and_preview_flags_are_all_on(
        bool workflows, bool workflowTools, bool preview, bool expected)
    {
        var result = await CreateHandler(new OllamaSettings
        {
            EnableStudioWorkflows = workflows,
            EnableStudioAiWorkflowTools = workflowTools,
            EnableStudioAiPlanPreview = preview
        }).Handle(new StudioAiCapabilitiesQuery(), CancellationToken.None);

        Assert.Equal(expected, result.Value.WorkflowToolsEnabled);
    }

    private StudioAiCapabilitiesQueryHandler CreateHandler(OllamaSettings settings) => new(
        Options.Create(settings),
        _platformAiSettings.Object,
        NullLogger<StudioAiCapabilitiesQueryHandler>.Instance);
}
