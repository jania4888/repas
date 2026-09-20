using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat de la bibliothèque « Modèles de systèmes » (B-P0-08) : garde par
/// <c>EnableStudioAiWorkbench</c> OU <c>EnableStudioTemplates</c>, liste builtin seule en P0
/// (source « builtin », sans id ni visibilité tenant), détail avec spec canonique, 404 sur clé
/// inconnue.
/// </summary>
public sealed class StudioTemplatesControllerTests
{
    [Fact]
    public void Controller_is_routed_under_studio_templates()
    {
        var route = typeof(StudioTemplatesController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();

        Assert.Equal("api/studio/templates", route.Template);
    }

    [Fact]
    public void List_and_detail_return_404_when_both_flags_are_off()
    {
        var controller = CreateController(workbenchEnabled: false, templatesEnabled: false);

        Assert.IsType<NotFoundObjectResult>(controller.List(null));
        Assert.IsType<NotFoundObjectResult>(controller.GetByKey("gestion-conges"));
    }

    [Fact]
    public void List_returns_builtin_templates_when_workbench_enabled()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        var ok = Assert.IsType<OkObjectResult>(controller.List(null));
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<StudioTemplateListItemDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(10, body.Data!.Count);
        Assert.All(body.Data, item =>
        {
            Assert.Equal("builtin", item.Source);
            Assert.Null(item.Id);
            Assert.Null(item.Visibility);
            Assert.Null(item.UpdatedAt);
            Assert.True(item.EntityCount > 0);
        });
    }

    [Fact]
    public void List_is_unavailable_when_workbench_is_off_even_with_templates_flag()
    {
        // La bibliothèque est subordonnée au workbench (aligné sur StudioAiCapabilitiesDto.TemplatesEnabled) :
        // le catalogue ne sert qu'au flux d'aperçu ; le flag Templates seul ne suffit pas (P3 pourra assouplir).
        var controller = CreateController(workbenchEnabled: false, templatesEnabled: true);

        Assert.IsType<NotFoundObjectResult>(controller.List(null));
    }

    [Fact]
    public void List_filters_by_category_case_insensitively()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        var ok = Assert.IsType<OkObjectResult>(controller.List("rh"));
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<StudioTemplateListItemDto>>>(ok.Value);
        Assert.NotEmpty(body.Data!);
        Assert.All(body.Data!, item => Assert.Equal("RH", item.Category));
    }

    [Fact]
    public void GetByKey_returns_the_canonical_spec_of_a_known_template()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        var ok = Assert.IsType<OkObjectResult>(controller.GetByKey("gestion-conges"));
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioTemplateDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("gestion-conges", body.Data!.Key);
        Assert.Equal("builtin", body.Data.Source);
        Assert.Contains("Gestion des congés", body.Data.SpecJson);
    }

    [Fact]
    public void List_items_carry_relation_count_and_view_modes()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        var ok = Assert.IsType<OkObjectResult>(controller.List(null));
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<StudioTemplateListItemDto>>>(ok.Value);
        Assert.All(body.Data!, item => Assert.NotNull(item.ViewModes));

        var interventions = Assert.Single(body.Data!, item => item.Key == "gestion-interventions");
        Assert.Equal(3, interventions.EntityCount);
        Assert.Equal(0, interventions.RelationCount);
        Assert.Contains("calendar", interventions.ViewModes!);

        var formations = Assert.Single(body.Data!, item => item.Key == "gestion-formations");
        Assert.Equal(4, formations.EntityCount);
        Assert.Equal(1, formations.RelationCount);
    }

    [Fact]
    public void Detail_carries_relation_count_and_view_modes()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        var ok = Assert.IsType<OkObjectResult>(controller.GetByKey("suivi-reclamations"));
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioTemplateDetailDto>>(ok.Value);
        Assert.Equal(3, body.Data!.EntityCount);
        Assert.Equal(0, body.Data.RelationCount);
        Assert.Equal(new[] { "kanban", "list" }, body.Data.ViewModes);
        Assert.Contains("\"views\"", body.Data.SpecJson);
    }

    [Fact]
    public void GetByKey_returns_404_for_an_unknown_key()
    {
        var controller = CreateController(workbenchEnabled: true, templatesEnabled: false);

        Assert.IsType<NotFoundObjectResult>(controller.GetByKey("modele-inexistant"));
    }

    [Fact]
    public void Capabilities_dto_never_exposes_a_model_reference()
    {
        // Le client ne doit jamais recevoir la référence canonique d'un modèle (ollama:…,
        // openrouter:…) : seuls des libellés humains sortent de l'API.
        var propertyNames = typeof(StudioAiCapabilitiesDto).GetProperties().Select(p => p.Name);
        Assert.DoesNotContain(propertyNames, n => n.Contains("Ref", StringComparison.OrdinalIgnoreCase));
    }

    private static StudioTemplatesController CreateController(bool workbenchEnabled, bool templatesEnabled) =>
        new(Options.Create(new OllamaSettings
        {
            EnableStudioAiWorkbench = workbenchEnabled,
            EnableStudioTemplates = templatesEnabled
        }));
}
