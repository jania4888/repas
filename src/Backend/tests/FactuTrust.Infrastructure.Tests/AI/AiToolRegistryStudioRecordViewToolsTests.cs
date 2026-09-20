using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.AI;

/// <summary>
/// PR 2.4 — exposition de <c>studio_plan_record_view</c> : uniquement en flux d'aperçu ET avec le
/// flag dédié, jamais hors StudioBuilder ; focus Report l'exclut, focus Build le conserve ;
/// liste centralisée des outils « plan » (R7).
/// </summary>
public sealed class AiToolRegistryStudioRecordViewToolsTests
{
    [Fact]
    public void Record_view_tool_requires_preview_flow_and_dedicated_flag()
    {
        // Flag coupé : absent même en aperçu.
        var withoutFlag = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioPlanPreview: true);
        Assert.DoesNotContain(withoutFlag, d => d.Name == "studio_plan_record_view");

        // Flag posé sans flux d'aperçu : absent (un plan n'a de sens que validable).
        var withoutPreview = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioRecordViewTools: true);
        Assert.DoesNotContain(withoutPreview, d => d.Name == "studio_plan_record_view");

        // Aperçu + flag : présent.
        var full = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true,
            studioPlanPreview: true, studioRecordViewTools: true);
        var tool = Assert.Single(full, d => d.Name == "studio_plan_record_view");
        Assert.True(tool.IsMutating);
        Assert.Equal(Permissions.Studio.DesignForms, tool.RequiredPermission);
    }

    [Fact]
    public void Record_view_tool_is_filtered_out_of_restricted_modes()
    {
        // Compliance et ScreenAnalysis ont un catalogue curé : jamais d'outil Studio.
        // (Default expose historiquement TOUT le catalogue — comportement inchangé, le gating
        // effectif est côté SendChatMessageCommand qui ne propage le flag qu'en StudioBuilder.)
        foreach (var mode in new[] { AssistantMode.Compliance, AssistantMode.ScreenAnalysis })
        {
            var defs = AiToolRegistry.GetDefinitionsForMode(
                mode, enableMutationTools: true, studioPlanPreview: true, studioRecordViewTools: true);
            Assert.DoesNotContain(defs, d => d.Name == "studio_plan_record_view");
        }
    }

    [Fact]
    public void Focus_build_keeps_the_tool_focus_report_excludes_it()
    {
        var build = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioPlanPreview: true,
            studioRecordViewTools: true, studioFocus: StudioToolFocus.Build);
        Assert.Contains(build, d => d.Name == "studio_plan_record_view");

        var report = AiToolRegistry.GetDefinitionsForMode(
            AssistantMode.StudioBuilder, enableMutationTools: true, studioPlanPreview: true,
            studioReportTools: true, studioRecordViewTools: true, studioFocus: StudioToolFocus.Report);
        Assert.DoesNotContain(report, d => d.Name == "studio_plan_record_view");
        Assert.Contains(report, d => d.Name == "studio_plan_report");
    }

    [Fact]
    public void StudioPlanEmittingTools_lists_every_plan_tool_once()
    {
        // R7 : liste centralisée — chaque outil « plan → aperçu » y figure, une seule fois.
        Assert.Equal(
            new[]
            {
                "studio_plan_app", "studio_plan_system", "studio_plan_report",
                "studio_plan_changes", "studio_plan_view", "studio_plan_record_view",
                "studio_plan_workflow"
            }.OrderBy(n => n),
            AiToolRegistry.StudioPlanEmittingTools.OrderBy(n => n));
    }
}
