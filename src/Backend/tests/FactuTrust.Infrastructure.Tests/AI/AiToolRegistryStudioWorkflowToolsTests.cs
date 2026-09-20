using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// PR 4.3 — exposition de <c>studio_plan_workflow</c> : uniquement en flux d'aperçu ET avec le
/// flag dédié, jamais hors StudioBuilder ; focus Report l'exclut, focus Build le conserve ;
/// définition mutante, permission <c>DesignEntities</c> et libellé FR présents.
/// </summary>
public sealed class AiToolRegistryStudioWorkflowToolsTests
{
    [Fact]
    public void Workflow_tool_requires_preview_flow_and_dedicated_flag()
    {
        // Flag posé sans flux d'aperçu : absent (un plan n'a de sens que validable).
        var withoutPreview = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true,
            studioPlanPreview: false, studioWorkflowTools: true);
        Assert.DoesNotContain(withoutPreview, d => d.Name == "studio_plan_workflow");

        // Flag coupé : absent même en aperçu.
        var withoutFlag = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true,
            studioPlanPreview: true, studioWorkflowTools: false);
        Assert.DoesNotContain(withoutFlag, d => d.Name == "studio_plan_workflow");

        // Aperçu + flag : présent.
        var full = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true,
            studioPlanPreview: true, studioWorkflowTools: true);
        Assert.Single(full, d => d.Name == "studio_plan_workflow");
    }

    [Fact]
    public void Workflow_tool_is_filtered_out_of_restricted_modes()
    {
        // Compliance et ScreenAnalysis ont un catalogue curé : jamais d'outil Studio.
        // (Default expose historiquement TOUT le catalogue — comportement inchangé, le gating
        // effectif est côté SendChatMessageCommand qui ne propage le flag qu'en StudioBuilder.)
        foreach (var mode in new[] { AssistantMode.Compliance, AssistantMode.ScreenAnalysis })
        {
            var defs = AiToolRegistry.GetDefinitionsForMode(
                mode, enableMutationTools: true, studioPlanPreview: true, studioWorkflowTools: true);
            Assert.DoesNotContain(defs, d => d.Name == "studio_plan_workflow");
        }
    }

    [Fact]
    public void Focus_build_keeps_the_workflow_tool_focus_report_excludes_it()
    {
        var build = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioPlanPreview: true,
            studioWorkflowTools: true, studioFocus: StudioToolFocus.Build);
        Assert.Contains(build, d => d.Name == "studio_plan_workflow");

        var report = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioPlanPreview: true,
            studioReportTools: true, studioWorkflowTools: true, studioFocus: StudioToolFocus.Report);
        Assert.DoesNotContain(report, d => d.Name == "studio_plan_workflow");
        Assert.Contains(report, d => d.Name == "studio_plan_report");
    }

    [Fact]
    public void Workflow_tool_definition_is_mutating_requires_spec_json_design_entities_and_has_a_french_label()
    {
        var tool = AiToolRegistry.GetToolDefinition("studio_plan_workflow");

        Assert.NotNull(tool);
        Assert.True(tool!.IsMutating);
        Assert.Equal(new[] { "spec_json" }, tool.RequiredParameters);
        Assert.Equal(Permissions.Studio.DesignEntities, tool.RequiredPermission);
        Assert.True(AiToolFrenchLabels.Labels.ContainsKey("studio_plan_workflow"));
        Assert.NotEqual(AiToolFrenchLabels.GenericLabel, AiToolFrenchLabels.Describe("studio_plan_workflow"));
    }
}
