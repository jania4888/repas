using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat des douze routes de conception de <see cref="StudioWorkflowsController"/> (PR 4.1, tranche
/// 4.1k) : politique de classe <c>studio:design_entities</c> sans affaiblissement par action, table
/// de routes figée, garde de drapeau (404 à message fixe AVANT tout appel au médiateur), 201 +
/// Location vers <c>Get</c>, mappage 409 / 404 / 400 et transmission brute de <c>max</c>.
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans
/// le namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioWorkflowsControllerContractTests
{
    private static readonly Guid EntityId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkflowId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid InstanceId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTime Now = new(2026, 9, 17, 8, 0, 0, DateTimeKind.Utc);

    /// <summary>Table de routes figée : nom d'action ⇒ (verbe HTTP, gabarit relatif à <c>api/studio</c>).</summary>
    private static readonly IReadOnlyDictionary<string, (string Method, string Template)> FrozenRoutes =
        new Dictionary<string, (string, string)>
        {
            [nameof(StudioWorkflowsController.StepCatalog)] = ("GET", "workflows/step-catalog"),
            [nameof(StudioWorkflowsController.ListAll)] = ("GET", "workflows"),
            [nameof(StudioWorkflowsController.List)] = ("GET", "entities/{entityId:guid}/workflows"),
            [nameof(StudioWorkflowsController.Get)] = ("GET", "workflows/{id:guid}"),
            [nameof(StudioWorkflowsController.Create)] = ("POST", "entities/{entityId:guid}/workflows"),
            [nameof(StudioWorkflowsController.Update)] = ("PUT", "workflows/{id:guid}"),
            [nameof(StudioWorkflowsController.Toggle)] = ("POST", "workflows/{id:guid}/toggle"),
            [nameof(StudioWorkflowsController.Delete)] = ("DELETE", "workflows/{id:guid}"),
            [nameof(StudioWorkflowsController.Duplicate)] = ("POST", "workflows/{id:guid}/duplicate"),
            [nameof(StudioWorkflowsController.Validate)] = ("POST", "entities/{entityId:guid}/workflows/validate"),
            [nameof(StudioWorkflowsController.ListInstances)] = ("GET", "workflows/{id:guid}/instances"),
            [nameof(StudioWorkflowsController.GetInstance)] = ("GET", "workflows/instances/{instanceId:guid}"),
            [nameof(StudioWorkflowsController.Test)] = ("POST", "workflows/{id:guid}/test"),
        };

    // ---- Politique, routes, drapeau ----

    [Fact]
    public void Controller_route_and_policy_are_unchanged()
    {
        var route = typeof(StudioWorkflowsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio", route.Template);

        var policies = typeof(StudioWorkflowsController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Select(a => a.Policy)
            .ToList();
        Assert.Equal(new[] { PermissionPolicies.StudioDesignEntities }, policies);
        Assert.Empty(typeof(StudioWorkflowsController).GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
    }

    [Fact]
    public void Route_table_matches_the_frozen_contract()
    {
        var actions = typeof(StudioWorkflowsController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .ToList();

        Assert.Equal(FrozenRoutes.Count, actions.Count);
        foreach (var action in actions)
        {
            Assert.True(FrozenRoutes.TryGetValue(action.Name, out var expected),
                $"Action publique hors contrat : {action.Name}");
            var http = Assert.Single(action.GetCustomAttributes<HttpMethodAttribute>(inherit: true));
            Assert.Equal(expected.Method, Assert.Single(http.HttpMethods));
            Assert.Equal(expected.Template, http.Template);
        }
    }

    [Fact]
    public void No_action_carries_a_weaker_authorize_attribute()
    {
        foreach (var name in FrozenRoutes.Keys)
        {
            var method = typeof(StudioWorkflowsController).GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
            Assert.NotNull(method);
            Assert.Empty(method!.GetCustomAttributes<AuthorizeAttribute>(inherit: true));
            Assert.Empty(method.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        }
    }

    [Fact]
    public async Task Every_route_returns_404_and_calls_nothing_when_the_flag_is_off()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, enabled: false);
        var ct = CancellationToken.None;

        var results = new[]
        {
            await controller.StepCatalog(ct),
            await controller.ListAll(cancellationToken: ct),
            await controller.List(EntityId, ct),
            await controller.Get(WorkflowId, ct),
            await controller.Create(EntityId, Save(), ct),
            await controller.Update(WorkflowId, Save(rowVersion: "AAAAAAAAB9E="), ct),
            await controller.Toggle(WorkflowId, new ToggleWorkflowRequest(true), ct),
            await controller.Delete(WorkflowId, ct),
            await controller.Duplicate(WorkflowId, ct),
            await controller.Validate(EntityId, Save(), ct),
            await controller.ListInstances(WorkflowId, cancellationToken: ct),
            await controller.GetInstance(InstanceId, ct),
            await controller.Test(WorkflowId, new WorkflowTestRequest(Guid.NewGuid()), ct),
        };

        Assert.Equal(FrozenRoutes.Count, results.Length);
        foreach (var result in results)
        {
            var notFound = Assert.IsType<NotFoundObjectResult>(result);
            var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
            Assert.False(body.Success);
            Assert.Equal("Les workflows Studio ne sont pas activés.", body.Error);
        }
        mediator.VerifyNoOtherCalls();
    }

    // ---- 201 + Location ----

    [Fact]
    public async Task Create_returns_201_with_a_location_to_get()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        CreateWorkflowCommand? captured = null;
        mediator.Setup(m => m.Send(It.IsAny<CreateWorkflowCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<WorkflowDefinitionDto>>, CancellationToken>((c, _) => captured = (CreateWorkflowCommand)c)
            .ReturnsAsync(Result.Success(Definition()));

        var result = await CreateController(mediator).Create(EntityId, Save(), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(201, created.StatusCode);
        Assert.Equal(nameof(StudioWorkflowsController.Get), created.ActionName);
        Assert.Equal(WorkflowId, created.RouteValues!["id"]);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowDefinitionDto>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal(WorkflowId, body.Data!.Id);
        Assert.NotNull(captured);
        Assert.Equal(EntityId, captured!.EntityId);
        Assert.Equal("relance", captured.Request.Key);
    }

    [Fact]
    public async Task Duplicate_returns_201_with_the_inactive_copy()
    {
        var copyId = Guid.NewGuid();
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<DuplicateWorkflowCommand>(c => c.Id == WorkflowId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Definition(copyId, key: "relance_copie", name: "Relance (copie)", isActive: false)));

        var result = await CreateController(mediator).Duplicate(WorkflowId, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(201, created.StatusCode);
        Assert.Equal(nameof(StudioWorkflowsController.Get), created.ActionName);
        Assert.Equal(copyId, created.RouteValues!["id"]);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowDefinitionDto>>(created.Value);
        Assert.Equal("relance_copie", body.Data!.Key);
        Assert.Equal("Relance (copie)", body.Data.Name);
        Assert.False(body.Data.IsActive);
    }

    // ---- Mappage des erreurs ----

    [Fact]
    public async Task Create_maps_conflict_to_409_and_validation_to_400()
    {
        const string conflictMessage = "Un workflow avec la clé « relance » existe déjà pour cette table.";
        const string validationMessage = "Type d'étape inconnu : « teleport ».";

        var conflict = await CreateFailingWith(Error.Conflict(conflictMessage));
        var conflictResult = Assert.IsType<ConflictObjectResult>(conflict);
        var conflictBody = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflictResult.Value);
        Assert.False(conflictBody.Success);
        Assert.Equal(conflictMessage, conflictBody.Error);

        var validation = await CreateFailingWith(Error.Validation("steps[0].type", validationMessage));
        var validationResult = Assert.IsType<BadRequestObjectResult>(validation);
        var validationBody = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(validationResult.Value);
        Assert.False(validationBody.Success);
        Assert.Equal(validationMessage, validationBody.Error);

        var quota = await CreateFailingWith(Error.Validation("Plan", "Votre plan autorise 20 workflows par table."));
        Assert.IsType<BadRequestObjectResult>(quota);
    }

    [Fact]
    public async Task Update_returns_409_when_the_row_version_is_stale()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<UpdateWorkflowCommand>(c => c.Id == WorkflowId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowDefinitionDto>(
                Error.Conflict("Le workflow a été modifié entre-temps. Rechargez-le avant de réessayer.")));

        var result = await CreateController(mediator).Update(WorkflowId, Save(rowVersion: "AAAAAAAAB9E="), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal(409, conflict.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflict.Value);
        Assert.Equal("Le workflow a été modifié entre-temps. Rechargez-le avant de réessayer.", body.Error);
    }

    [Fact]
    public async Task Get_get_instance_and_list_return_404_for_unknown_ids()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetWorkflowQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowDefinitionDto>(Error.NotFound("StudioWorkflowDefinition", WorkflowId)));
        mediator.Setup(m => m.Send(It.IsAny<GetWorkflowInstanceQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDetailDto>(Error.NotFound("StudioWorkflowInstance", InstanceId)));
        mediator.Setup(m => m.Send(It.IsAny<ListWorkflowsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<IReadOnlyList<WorkflowDefinitionDto>>(Error.NotFound("CustomEntity", EntityId)));
        var controller = CreateController(mediator);

        Assert.IsType<NotFoundObjectResult>(await controller.Get(WorkflowId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.GetInstance(InstanceId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.List(EntityId, CancellationToken.None));
    }

    // ---- Simulation « Tester sur un enregistrement » (4.7c1) ----

    [Fact]
    public async Task Test_sends_the_query_and_returns_200_with_the_trace()
    {
        var recordId = Guid.NewGuid();
        var trace = new WorkflowTestResultDto(
            recordId, "clients", 2, true,
            new[]
            {
                new WorkflowTestStepTraceDto("si", "condition", "Montant élevé", WorkflowTestVerdicts.WouldRun, "Condition remplie (match = all).", null),
                new WorkflowTestStepTraceDto("valide", "approval", null, WorkflowTestVerdicts.WouldSuspend, "Approbation assignée au rôle « Admin ».", null)
            },
            new[] { "Sorties fictives : « _results.fact.* » ne sera renseigné qu'à l'exécution réelle." });
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        TestWorkflowQuery? captured = null;
        mediator.Setup(m => m.Send(It.IsAny<TestWorkflowQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<WorkflowTestResultDto>>, CancellationToken>((q, _) => captured = (TestWorkflowQuery)q)
            .ReturnsAsync(Result.Success(trace));

        var result = await CreateController(mediator).Test(WorkflowId, new WorkflowTestRequest(recordId), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowTestResultDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(recordId, body.Data!.RecordId);
        Assert.True(body.Data.Suspended);
        Assert.Equal("would_suspend", body.Data.Steps[1].Verdict);
        Assert.NotNull(captured);
        Assert.Equal(WorkflowId, captured!.WorkflowId);
        Assert.Equal(recordId, captured.RecordId);
    }

    [Fact]
    public async Task Test_maps_not_found_to_404_and_invalid_definition_to_400()
    {
        var notFoundMediator = new Mock<IMediator>(MockBehavior.Strict);
        notFoundMediator.Setup(m => m.Send(It.IsAny<TestWorkflowQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowTestResultDto>(Error.NotFound("CustomRecord", Guid.NewGuid())));
        var notFound = await CreateController(notFoundMediator).Test(WorkflowId, new WorkflowTestRequest(Guid.NewGuid()), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(notFound);

        var invalidMediator = new Mock<IMediator>(MockBehavior.Strict);
        invalidMediator.Setup(m => m.Send(It.IsAny<TestWorkflowQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowTestResultDto>(Error.Validation("steps", "Définition invalide.")));
        var invalid = await CreateController(invalidMediator).Test(WorkflowId, new WorkflowTestRequest(Guid.NewGuid()), CancellationToken.None);
        var badRequest = Assert.IsType<BadRequestObjectResult>(invalid);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(badRequest.Value);
        Assert.Equal("Définition invalide.", body.Error);
    }

    // ---- Suppression, instances, validation, catalogue ----

    [Fact]
    public async Task Delete_returns_200_with_the_cancelled_instances_count()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<DeleteWorkflowCommand>(c => c.Id == WorkflowId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new WorkflowDeletionResultDto(2)));

        var result = await CreateController(mediator).Delete(WorkflowId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowDeletionResultDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(2, body.Data!.CancelledInstances);
    }

    // 4.7a1 / D-47-B01 — la route est paginée : ?page=&pageSize= ⇒ enveloppe PagedResult (remplace ?max=).
    [Fact]
    public async Task List_instances_defaults_page_1_size_50_clamps_size_to_1_200_and_returns_paged_envelope()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var seen = new List<ListWorkflowInstancesQuery>();
        mediator.Setup(m => m.Send(It.IsAny<ListWorkflowInstancesQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<PagedResult<WorkflowInstanceDto>>>, CancellationToken>((q, _) => seen.Add((ListWorkflowInstancesQuery)q))
            .ReturnsAsync(Result.Success(PagedResult<WorkflowInstanceDto>.Create(new[] { Instance() }, 1, 50, 1)));
        var controller = CreateController(mediator);
        var ct = CancellationToken.None;

        var byDefault = await controller.ListInstances(WorkflowId, cancellationToken: ct);
        Assert.IsType<OkObjectResult>(await controller.ListInstances(WorkflowId, page: 3, pageSize: 500, cancellationToken: ct));
        Assert.IsType<OkObjectResult>(await controller.ListInstances(WorkflowId, page: 1, pageSize: 0, cancellationToken: ct));

        var ok = Assert.IsType<OkObjectResult>(byDefault);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PagedResult<WorkflowInstanceDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(1, body.Data!.TotalCount);
        Assert.Equal(InstanceId, Assert.Single(body.Data.Items).Id);

        Assert.Equal(3, seen.Count);
        Assert.All(seen, q => Assert.Equal(WorkflowId, q.WorkflowId));
        Assert.Equal((1, 50), (seen[0].Page, seen[0].PageSize));
        Assert.Equal((3, 200), (seen[1].Page, seen[1].PageSize));
        Assert.Equal((1, 1), (seen[2].Page, seen[2].PageSize));
    }

    [Fact]
    public async Task ListAll_defaults_page_1_size_50_clamps_size_to_1_200_and_returns_paged_envelope()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var seen = new List<ListTenantWorkflowsQuery>();
        mediator.Setup(m => m.Send(It.IsAny<ListTenantWorkflowsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<PagedResult<WorkflowDefinitionListItemDto>>>, CancellationToken>((q, _) => seen.Add((ListTenantWorkflowsQuery)q))
            .ReturnsAsync(Result.Success(PagedResult<WorkflowDefinitionListItemDto>.Create(
                new[] { new WorkflowDefinitionListItemDto(Definition(), "devis", "Devis") }, 1, 50, 1)));
        var controller = CreateController(mediator);
        var ct = CancellationToken.None;

        var byDefault = await controller.ListAll(cancellationToken: ct);
        Assert.IsType<OkObjectResult>(await controller.ListAll("rel", 2, 999, ct));
        Assert.IsType<OkObjectResult>(await controller.ListAll(null, 1, 0, ct));

        var ok = Assert.IsType<OkObjectResult>(byDefault);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PagedResult<WorkflowDefinitionListItemDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(1, body.Data!.TotalCount);
        Assert.Equal("devis", Assert.Single(body.Data.Items).EntityKey);

        Assert.Equal(3, seen.Count);
        Assert.Equal((null, 1, 50), (seen[0].Search, seen[0].Page, seen[0].PageSize));
        Assert.Equal(("rel", 2, 200), (seen[1].Search, seen[1].Page, seen[1].PageSize));
        Assert.Equal((null, 1, 1), (seen[2].Search, seen[2].Page, seen[2].PageSize));
    }

    [Fact]
    public void ListAll_item_serializes_workflow_entityKey_and_entityDisplayName_in_camelCase()
    {
        var item = new WorkflowDefinitionListItemDto(Definition(), "devis", "Devis");

        var json = JsonSerializer.Serialize(item, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Contains("\"workflow\":{", json);
        Assert.Contains("\"entityKey\":\"devis\"", json);
        Assert.Contains("\"entityDisplayName\":\"Devis\"", json);
        Assert.Contains("\"openInstances\":", json);
        Assert.Contains("\"stepCount\":", json);
    }

    [Fact]
    public async Task Validate_and_step_catalog_return_200_envelopes()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var issue = new WorkflowValidationIssueDto("steps[0].type", "Type d'étape inconnu : « teleport ».");
        mediator.Setup(m => m.Send(It.Is<ValidateWorkflowQuery>(q => q.EntityId == EntityId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new WorkflowValidationResultDto(false, new[] { issue }, Array.Empty<WorkflowValidationIssueDto>(), 1)));
        mediator.Setup(m => m.Send(It.IsAny<GetWorkflowStepCatalogQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new WorkflowStepCatalogDto(new[]
            {
                new StepCatalogEntryDto("condition", "Condition", "Branche selon une règle.", Array.Empty<StepCatalogPropertyDto>()),
            })));
        var controller = CreateController(mediator);

        var validation = Assert.IsType<OkObjectResult>(await controller.Validate(EntityId, Save(), CancellationToken.None));
        var validationBody = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowValidationResultDto>>(validation.Value);
        Assert.True(validationBody.Success);
        Assert.False(validationBody.Data!.IsValid);
        Assert.Equal("steps[0].type", Assert.Single(validationBody.Data.Errors).Path);
        Assert.Equal(1, validationBody.Data.StepCount);

        var catalog = Assert.IsType<OkObjectResult>(await controller.StepCatalog(CancellationToken.None));
        var catalogBody = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowStepCatalogDto>>(catalog.Value);
        Assert.True(catalogBody.Success);
        Assert.Equal("condition", Assert.Single(catalogBody.Data!.Entries).Type);
    }

    // ---- Aides ----

    private static async Task<IActionResult> CreateFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<CreateWorkflowCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowDefinitionDto>(error));
        return await CreateController(mediator).Create(EntityId, Save(), CancellationToken.None);
    }

    private static SaveWorkflowRequest Save(string? rowVersion = null) => new(
        Key: "relance",
        Name: "Relance",
        Description: null,
        Trigger: "manual",
        TriggerConfig: null,
        Steps: JsonNode.Parse("""{ "version": 1, "steps": [ { "key": "verif", "type": "condition", "field": "statut", "operator": "equals", "value": "brouillon" } ] }""")!.AsObject(),
        IsActive: true,
        RowVersion: rowVersion);

    private static WorkflowDefinitionDto Definition(Guid? id = null, string key = "relance", string name = "Relance", bool isActive = true) => new(
        Id: id ?? WorkflowId,
        EntityDefinitionId: EntityId,
        Key: key,
        Name: name,
        Description: null,
        Trigger: "manual",
        TriggerConfig: new JsonObject(),
        Steps: JsonNode.Parse("""{ "version": 1, "steps": [] }""")!.AsObject(),
        StepCount: 1,
        Version: 1,
        IsActive: isActive,
        OpenInstances: 0,
        CreatedAt: Now,
        UpdatedAt: Now,
        RowVersion: "AAAAAAAAB9E=");

    private static WorkflowInstanceDto Instance() => new(
        Id: InstanceId,
        WorkflowDefinitionId: WorkflowId,
        WorkflowKey: "relance",
        WorkflowName: "Relance",
        DefinitionVersion: 1,
        EntityDefinitionId: EntityId,
        RecordId: Guid.NewGuid(),
        Trigger: "manual",
        Status: "completed",
        CurrentStepIndex: 1,
        CurrentStepKey: null,
        DueAt: null,
        StartedBy: null,
        StartedAt: Now,
        CompletedAt: Now.AddSeconds(2),
        Depth: 0,
        OriginInstanceId: null,
        Error: null);

    private static StudioWorkflowsController CreateController(Mock<IMediator> mediator, bool enabled = true) =>
        new(mediator.Object, Options.Create(new OllamaSettings { EnableStudioWorkflows = enabled }));
}
