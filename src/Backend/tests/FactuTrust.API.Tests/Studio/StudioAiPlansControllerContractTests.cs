using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat des endpoints « workbench » des plans Studio IA (B-P0-08) : garde du flag
/// <c>EnableStudioAiWorkbench</c> (404 tant qu'il est coupé), politique d'autorisation, et
/// mappage des erreurs Result → codes HTTP (409 conflit de RowVersion, 401 permission révoquée,
/// 404 plan d'un autre utilisateur, 400 spec invalide).
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme
/// dans le namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioAiPlansControllerContractTests
{
    [Fact]
    public void Controller_stays_routed_under_studio_ai_plans_with_design_policy()
    {
        var route = typeof(StudioAiPlansController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/ai/plans", route.Template);

        var policies = typeof(StudioAiPlansController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(a => a.Policy);
        Assert.Contains(PermissionPolicies.StudioDesignEntities, policies);
    }

    [Fact]
    public async Task List_returns_404_and_calls_nothing_when_plan_preview_disabled()
    {
        // PR 3.2 : l'historique relève du flux d'aperçu, même avec le workbench activé.
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: false);

        var result = await controller.List(null, null, 1, 20, CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal("Le flux d'aperçu Studio n'est pas activé.", body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task CancelPending_returns_404_and_calls_nothing_when_plan_preview_disabled()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: false);

        var result = await controller.CancelPending(CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal("Le flux d'aperçu Studio n'est pas activé.", body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task List_and_cancel_pending_work_when_workbench_disabled_but_plan_preview_enabled()
    {
        // La bascule 3.2 ne lie plus l'historique au workbench : le workbench peut être coupé seul.
        var paged = PagedResult<StudioAiPlanListItemDto>.Create(
            Array.Empty<StudioAiPlanListItemDto>(), page: 1, pageSize: 20, totalCount: 0);
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ListStudioAiPlansQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(paged));
        mediator.Setup(m => m.Send(It.IsAny<CancelPendingStudioAiPlansCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(0));
        var controller = CreateController(mediator, workbenchEnabled: false, planPreviewEnabled: true);

        Assert.IsType<OkObjectResult>(await controller.List(null, null, 1, 20, CancellationToken.None));
        Assert.IsType<OkObjectResult>(await controller.CancelPending(CancellationToken.None));
        mediator.Verify(
            m => m.Send(It.IsAny<ListStudioAiPlansQuery>(), It.IsAny<CancellationToken>()), Times.Once);
        mediator.Verify(
            m => m.Send(It.IsAny<CancelPendingStudioAiPlansCommand>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Spec_and_creation_endpoints_return_404_when_workbench_disabled()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workbenchEnabled: false);
        var id = Guid.NewGuid();

        Assert.IsType<NotFoundObjectResult>(await controller.GetSpec(id, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.UpdateSpec(id, new UpdateStudioAiPlanSpecRequest("{}", ""), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.ValidateSpec(new ValidateStudioAiSpecRequest("CreateSystem", "{}"), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.CreateFromSpec(new CreatePlanFromSpecRequest("CreateSystem", "{}"), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.CreateFromTemplate(new CreatePlanFromTemplateRequest("gestion-conges", null, null), CancellationToken.None));
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task List_success_returns_paged_result_in_envelope()
    {
        var paged = PagedResult<StudioAiPlanListItemDto>.Create(
            new[]
            {
                new StudioAiPlanListItemDto(Guid.NewGuid(), "CreateSystem", "Pending", "Congés", 4,
                    DateTime.UtcNow, DateTime.UtcNow.AddMinutes(60), null, null)
            }, page: 1, pageSize: 20, totalCount: 1);
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListStudioAiPlansQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(paged));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);

        var result = await controller.List("Pending", null, 1, 20, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PagedResult<StudioAiPlanListItemDto>>>(ok.Value);
        Assert.True(body.Success);
        var item = Assert.Single(body.Data!.Items);
        // PR 3.2 : les 5 champs ajoutés en fin ont leurs défauts (null/null/0/0/false) quand le
        // constructeur est appelé avec les 9 positionnels historiques ; viewCount est omis du JSON à 0.
        Assert.Null(item.ErrorMessage);
        Assert.Null(item.OpenUrl);
        Assert.Equal(0, item.RelationCount);
        Assert.Equal(0, item.ViewCount);
        Assert.False(item.Replayable);
        Assert.DoesNotContain("viewCount",
            JsonSerializer.Serialize(item, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Put_spec_returns_409_on_rowversion_conflict()
    {
        var result = await PutSpecFailingWith(Error.Conflict("Le plan a été modifié entre-temps. Rechargez-le."));

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Contains("modifié entre-temps", body.Error!);
    }

    [Fact]
    public async Task Put_spec_returns_400_on_invalid_spec()
    {
        var result = await PutSpecFailingWith(Error.Validation("specJson", "La spec dépasse 256 Ko."));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Put_spec_returns_401_when_permission_revoked()
    {
        var result = await PutSpecFailingWith(Error.Unauthorized("Permission de conception Studio requise."));

        var unauthorized = Assert.IsType<ObjectResult>(result);
        Assert.Equal(401, unauthorized.StatusCode);
    }

    [Fact]
    public async Task Put_spec_returns_404_for_another_users_plan()
    {
        var result = await PutSpecFailingWith(Error.NotFound("StudioAiBuildPlan", Guid.NewGuid()));

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Put_spec_maps_free_text_not_found_to_404()
    {
        // Overload Error.NotFound(message) (code « NotFound » nu) utilisé par les handlers B-P0-05.
        var result = await PutSpecFailingWith(Error.NotFound("Fonctionnalité non disponible."));

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Validate_success_returns_canonical_and_summary()
    {
        var validation = new StudioAiSpecValidationDto(
            Valid: true, Summary: null, CanonicalJson: null, Warnings: Array.Empty<string>());
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ValidateStudioAiSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(validation));
        var controller = CreateController(mediator, workbenchEnabled: true);

        var result = await controller.ValidateSpec(
            new ValidateStudioAiSpecRequest("CreateSystem", "{}"), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiSpecValidationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data!.Valid);
    }

    [Fact]
    public void Plan_summary_shape_has_duplicates_present_but_empty_by_default()
    {
        // Contrat d'aperçu (PR 1.3) : « duplicates » est TOUJOURS sérialisé (tableau vide par
        // défaut, jamais null) — le bandeau doublon du frontend s'appuie sur cette forme stable.
        const string json = """
        { "system": { "displayName": "T" }, "entities": [
          { "ref": "tickets", "displayName": "Tickets", "fields": [ { "label": "Nom" } ] } ] }
        """;
        Assert.True(StudioAiSystemSpec.TryParse(json, out var spec, out var error), error);

        var summary = JsonNode.Parse(StudioAiPlanSummary.ForSystem(spec!))!;

        Assert.Equal(JsonValueKind.Array, summary["duplicates"]!.GetValueKind());
        Assert.Empty(summary["duplicates"]!.AsArray());
        Assert.NotNull(summary["warnings"]);
    }

    // ---------- PR 2.4 — kind « RecordView » sur validate / from-spec ----------

    private const string RecordViewSpec = """{ "entity": "interventions", "name": "Kanban", "mode": "kanban", "groupBy": "statut" }""";

    [Fact]
    public async Task Validate_record_view_reaches_mediator_and_returns_200_when_valid()
    {
        var validation = new StudioAiSpecValidationDto(
            Valid: true,
            Summary: JsonNode.Parse("""{"kind":"RecordView"}"""),
            CanonicalJson: JsonNode.Parse(RecordViewSpec),
            Warnings: Array.Empty<string>());
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ValidateStudioAiSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(validation));
        var controller = CreateController(mediator, workbenchEnabled: true);

        var result = await controller.ValidateSpec(
            new ValidateStudioAiSpecRequest("RecordView", RecordViewSpec), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiSpecValidationDto>>(ok.Value);
        Assert.True(body.Data!.Valid);
        // La nature est transmise telle quelle au handler (le parse est insensible à la casse).
        mediator.Verify(m => m.Send(
            It.Is<ValidateStudioAiSpecCommand>(cmd => cmd.Kind == "RecordView" && cmd.SpecJson == RecordViewSpec),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Validate_record_view_maps_flag_off_to_400()
    {
        // Le rejet « vues enregistrées par l'IA non activées » est un Error.Validation("kind") du
        // handler — mappé 400 par le contrôleur, jamais un 200 { valid = false }.
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ValidateStudioAiSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiSpecValidationDto>(
                Error.Validation("kind", "Les vues enregistrées par l'IA ne sont pas activées.")));
        var controller = CreateController(mediator, workbenchEnabled: true);

        var result = await controller.ValidateSpec(
            new ValidateStudioAiSpecRequest("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Create_from_spec_record_view_returns_200_when_flag_on()
    {
        var now = DateTime.UtcNow;
        var response = new StudioAiPlanCreationResponse(
            new StudioAiPlanDto(Guid.NewGuid(), "RecordView", "Pending", "{}", null, null, now, now.AddMinutes(15), null),
            new StudioAiPlanSpecDto(Guid.NewGuid(), "RecordView", "Pending", now.AddMinutes(15), "AAAA",
                JsonNode.Parse(RecordViewSpec)!));
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanFromSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(response));
        var controller = CreateController(mediator, workbenchEnabled: true);

        var result = await controller.CreateFromSpec(
            new CreatePlanFromSpecRequest("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        mediator.Verify(m => m.Send(
            It.Is<CreateStudioAiPlanFromSpecCommand>(cmd => cmd.Kind == "RecordView"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Create_from_spec_record_view_maps_flag_off_to_400()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanFromSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("kind", "Les vues enregistrées par l'IA ne sont pas activées.")));
        var controller = CreateController(mediator, workbenchEnabled: true);

        var result = await controller.CreateFromSpec(
            new CreatePlanFromSpecRequest("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ---------- PR 3.2 — aperçu structuré (GET {id}/preview) et rejeu (POST {id}/replay) ----------

    [Fact]
    public async Task Preview_returns_404_and_calls_nothing_when_plan_preview_disabled()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: false);

        var result = await controller.Preview(Guid.NewGuid(), CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal("Le flux d'aperçu Studio n'est pas activé.", body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Preview_success_returns_dto_in_envelope()
    {
        var planId = Guid.NewGuid();
        var preview = new StudioAiPlanPreviewDto(
            planId, "CreateSystem", "Pending", "Congés",
            Array.Empty<PreviewEntity>(), Array.Empty<PreviewRelation>(), null,
            Array.Empty<object>(), Array.Empty<string>(), Array.Empty<DuplicateHint>());
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetStudioAiPlanPreviewQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(preview));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);

        var result = await controller.Preview(planId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiPlanPreviewDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(planId, body.Data!.PlanId);
        // Contrat §12 : « workflows » est toujours sérialisé, vide en 3.x (4.4 lira summary.workflows[]).
        Assert.Empty(body.Data.Workflows);
        mediator.Verify(m => m.Send(
            It.Is<GetStudioAiPlanPreviewQuery>(q => q.PlanId == planId),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Preview_maps_validation_error_to_400()
    {
        // Spec persistée incanonisable : le handler renvoie Validation.spec, mappée 400 (jamais 500).
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetStudioAiPlanPreviewQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiPlanPreviewDto>(
                Error.Validation("spec", "La spec est invalide.")));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);

        var result = await controller.Preview(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Replay_returns_404_and_calls_nothing_when_plan_preview_disabled()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: false);

        var result = await controller.Replay(Guid.NewGuid(), CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal("Le flux d'aperçu Studio n'est pas activé.", body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Replay_success_returns_201_with_location_header()
    {
        // E5 : première 201 du contrôleur — Location absolue vers la ressource NEUVE créée.
        var now = DateTime.UtcNow;
        var newPlanId = Guid.NewGuid();
        var response = new StudioAiPlanCreationResponse(
            new StudioAiPlanDto(newPlanId, "CreateSystem", "Pending", "{}", null, null,
                now, now.AddMinutes(60), null),
            new StudioAiPlanSpecDto(newPlanId, "CreateSystem", "Pending", now.AddMinutes(60), "AAAA",
                JsonNode.Parse("""{ "system": { "displayName": "Congés" } }""")!));
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ReplayStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(response));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);
        var sourceId = Guid.NewGuid();

        var result = await controller.Replay(sourceId, CancellationToken.None);

        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal($"/api/studio/ai/plans/{newPlanId}", created.Location);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiPlanCreationResponse>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal(newPlanId, body.Data!.Plan.Id);
        mediator.Verify(m => m.Send(
            It.Is<ReplayStudioAiPlanCommand>(cmd => cmd.PlanId == sourceId),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Replay_maps_conflict_to_409_with_fixed_message()
    {
        // Plan non rejouable (en attente non échu, en cours) : 409 au message figé (3.2c).
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ReplayStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiPlanCreationResponse>(
                Error.Conflict("Seul un plan terminé, échoué, annulé ou expiré peut être rejoué.")));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);

        var result = await controller.Replay(Guid.NewGuid(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Equal("Seul un plan terminé, échoué, annulé ou expiré peut être rejoué.", body.Error);
    }

    [Fact]
    public async Task Replay_maps_validation_error_to_400()
    {
        // Re-canonicalisation impossible (spec stockée devenue invalide) : Validation.spec ⇒ 400.
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ReplayStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("spec", "La spec est invalide.")));
        var controller = CreateController(mediator, workbenchEnabled: true, planPreviewEnabled: true);

        var result = await controller.Replay(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    private static async Task<IActionResult> PutSpecFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<UpdateStudioAiPlanSpecCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UpdateStudioAiPlanSpecResponse>(error));
        var controller = CreateController(mediator, workbenchEnabled: true);

        return await controller.UpdateSpec(
            Guid.NewGuid(), new UpdateStudioAiPlanSpecRequest("{\"system\":{}}", "AAAA"), CancellationToken.None);
    }

    private static StudioAiPlansController CreateController(
        Mock<IMediator> mediator, bool workbenchEnabled, bool planPreviewEnabled = false) =>
        new(mediator.Object, Options.Create(new OllamaSettings
        {
            EnableStudioAiWorkbench = workbenchEnabled,
            EnableStudioAiPlanPreview = planPreviewEnabled
        }));
}
