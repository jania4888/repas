using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat du contrôleur runtime des workflows (PR 4.2, tranche 4.2g) : 9 routes sous
/// <c>api/studio</c>, policies lecture <c>custom_records:read</c> (GET) / écriture
/// <c>custom_records:write</c> (POST), garde du drapeau <c>Ollama:EnableStudioWorkflows</c> (404 sans
/// AUCUN appel MediatR tant qu'il est coupé) et mappage Result → HTTP (400 validation, 404 introuvable
/// — approbation non assignée incluse, 409 conflit). <c>run</c> ⇒ 201 vers
/// <see cref="StudioWorkflowsController.GetInstance"/>.
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans le
/// namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioWorkflowRuntimeControllerContractTests
{
    private const string EntityKey = "clients";
    private static readonly Guid ApprovalId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid InstanceId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid RecordId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");

    private static readonly WorkflowInstanceDto InstanceDto = new(
        InstanceId, Guid.NewGuid(), "wf-manuel", "Relance manuelle", 1, Guid.NewGuid(), RecordId,
        "manual", "running", 0, null, null, Guid.NewGuid(), DateTime.UtcNow, null, 0, null, null);

    [Fact]
    public void Controller_is_routed_under_api_studio_with_read_policies_on_GET_and_write_policies_on_POST()
    {
        var type = typeof(StudioWorkflowRuntimeController);
        var route = type.GetCustomAttributes(typeof(RouteAttribute), true).Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio", route.Template);
        // La classe exige l'authentification, sans policy de conception (R15).
        Assert.Contains(type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>(), a => a.Policy is null);

        static string PolicyOf(string method) => typeof(StudioWorkflowRuntimeController).GetMethod(method)!
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single(a => a.Policy is not null).Policy!;
        static string TemplateOf<T>(string method) where T : HttpMethodAttribute =>
            typeof(StudioWorkflowRuntimeController).GetMethod(method)!
                .GetCustomAttributes(typeof(T), true).Cast<T>().Single().Template!;

        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.ListMyApprovals)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.ListMyApprovalHistory)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.CountMyApprovals)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.ListRecordInstances)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.GetRecordInstance)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioWorkflowRuntimeController.ListRunnable)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioWorkflowRuntimeController.Approve)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioWorkflowRuntimeController.Reject)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioWorkflowRuntimeController.Run)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioWorkflowRuntimeController.Cancel)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioWorkflowRuntimeController.Remind)));

        Assert.Equal("workflows/approvals/mine", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.ListMyApprovals)));
        Assert.Equal("workflows/approvals/mine/history", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.ListMyApprovalHistory)));
        Assert.Equal("workflows/approvals/mine/count", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.CountMyApprovals)));
        Assert.Equal("workflows/approvals/{approvalId:guid}/approve", TemplateOf<HttpPostAttribute>(nameof(StudioWorkflowRuntimeController.Approve)));
        Assert.Equal("workflows/approvals/{approvalId:guid}/reject", TemplateOf<HttpPostAttribute>(nameof(StudioWorkflowRuntimeController.Reject)));
        Assert.Equal("records/{entityKey}/{recordId:guid}/workflow-instances", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.ListRecordInstances)));
        Assert.Equal("records/{entityKey}/{recordId:guid}/workflow-instances/{instanceId:guid}", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.GetRecordInstance)));
        Assert.Equal("records/{entityKey}/workflows", TemplateOf<HttpGetAttribute>(nameof(StudioWorkflowRuntimeController.ListRunnable)));
        Assert.Equal("records/{entityKey}/{recordId:guid}/workflows/{workflowKey}/run", TemplateOf<HttpPostAttribute>(nameof(StudioWorkflowRuntimeController.Run)));
        Assert.Equal("workflows/instances/{instanceId:guid}/cancel", TemplateOf<HttpPostAttribute>(nameof(StudioWorkflowRuntimeController.Cancel)));
        Assert.Equal("workflows/instances/{instanceId:guid}/remind", TemplateOf<HttpPostAttribute>(nameof(StudioWorkflowRuntimeController.Remind)));
    }

    [Fact]
    public async Task Every_route_returns_404_and_calls_nothing_when_the_flag_is_off()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, workflowsEnabled: false);

        Assert.IsType<NotFoundObjectResult>(await controller.ListMyApprovals(cancellationToken: CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.ListMyApprovalHistory(cancellationToken: CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.CountMyApprovals(CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Approve(ApprovalId, null, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.Reject(ApprovalId, new ApprovalDecisionRequest("Non"), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(
            await controller.ListRecordInstances(EntityKey, RecordId, cancellationToken: CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.GetRecordInstance(EntityKey, RecordId, InstanceId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.ListRunnable(EntityKey, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Run(EntityKey, RecordId, "wf-manuel", CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Cancel(InstanceId, null, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Remind(InstanceId, CancellationToken.None));

        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Run_returns_201_created_at_GetInstance_of_StudioWorkflowsController()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<RunWorkflowCommand>(c =>
                    c.EntityKey == EntityKey && c.RecordId == RecordId && c.WorkflowKey == "wf-manuel"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(InstanceDto));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .Run(EntityKey, RecordId, "wf-manuel", CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(201, created.StatusCode);
        Assert.Equal(nameof(StudioWorkflowsController.GetInstance), created.ActionName);
        Assert.Equal("StudioWorkflows", created.ControllerName);
        Assert.Equal(InstanceId, created.RouteValues!["instanceId"]);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowInstanceDto>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal(InstanceId, body.Data!.Id);
    }

    // 4.5b2 / D11 — 10e route : détail d'instance borné à la fiche, enveloppe ApiResponse<WorkflowInstanceDetailDto>.
    [Fact]
    public async Task GetRecordInstance_returns_200_detail_envelope_and_forwards_entity_record_and_instance()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<GetRecordWorkflowInstanceQuery>(q =>
                    q.EntityKey == EntityKey && q.RecordId == RecordId && q.InstanceId == InstanceId),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new WorkflowInstanceDetailDto(
                InstanceDto, Array.Empty<WorkflowStepRunDto>(), Array.Empty<WorkflowApprovalDto>(), new JsonObject())));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .GetRecordInstance(EntityKey, RecordId, InstanceId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowInstanceDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(InstanceId, body.Data!.Instance.Id);
    }

    // 4.6b1 / D-46-B01 — « startedByName » en fin de contrat de WorkflowInstanceDto, camelCase, null par défaut
    // (forme à 18 positionnels intacte — même motif que l'inbox 4.5a2 ci-dessus).
    [Fact]
    public async Task GetRecordInstance_serializes_startedByName_in_camelCase_with_null_default()
    {
        var named = InstanceDto with { StartedByName = "Alice Martin" };
        var legacy = InstanceDto;
        Assert.Null(legacy.StartedByName);
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Contains("\"startedByName\":\"Alice Martin\"", JsonSerializer.Serialize(named, web));
        Assert.Contains("\"startedByName\":null", JsonSerializer.Serialize(legacy, web));

        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetRecordWorkflowInstanceQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new WorkflowInstanceDetailDto(
                named, Array.Empty<WorkflowStepRunDto>(), Array.Empty<WorkflowApprovalDto>(), new JsonObject())));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .GetRecordInstance(EntityKey, RecordId, InstanceId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<WorkflowInstanceDetailDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Alice Martin", body.Data!.Instance.StartedByName);
    }

    // 4.5b2 / D-45-04 — mêmes mappages d'erreurs que les autres routes runtime.
    [Fact]
    public async Task GetRecordInstance_maps_NotFound_to_404_and_unknown_entity_Validation_to_400()
    {
        var notFound = new Mock<IMediator>();
        notFound.Setup(m => m.Send(It.IsAny<GetRecordWorkflowInstanceQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDetailDto>(Error.NotFound("StudioWorkflowInstance", InstanceId)));
        var invalid = new Mock<IMediator>();
        invalid.Setup(m => m.Send(It.IsAny<GetRecordWorkflowInstanceQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDetailDto>(Error.Validation("entityKey", "Table « clients » introuvable ou inactive.")));

        Assert.IsType<NotFoundObjectResult>(await CreateController(notFound, workflowsEnabled: true)
            .GetRecordInstance(EntityKey, RecordId, InstanceId, CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await CreateController(invalid, workflowsEnabled: true)
            .GetRecordInstance(EntityKey, RecordId, InstanceId, CancellationToken.None));
    }

    // 4.5a2 / D-44-79 — « startedByName » en fin de contrat, camelCase, null par défaut (forme à 10 positionnels intacte).
    [Fact]
    public async Task ListMyApprovals_returns_200_and_serializes_startedByName_in_camelCase_with_null_default()
    {
        var approval = new WorkflowApprovalDto(ApprovalId, InstanceId, "approve", null, "SalesRep", "Accord ?", null,
            "pending", null, null, null, null, DateTime.UtcNow, "AAAAAAAAB9E=");
        var named = new WorkflowApprovalInboxItemDto(approval, InstanceId, "wf", "Relance", EntityKey, "Clients", RecordId,
            "Dossier A", Guid.NewGuid(), DateTime.UtcNow, "Amine Zorgati");
        var legacy = new WorkflowApprovalInboxItemDto(approval, InstanceId, "wf", "Relance", EntityKey, "Clients", RecordId,
            null, null, DateTime.UtcNow);
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListMyApprovalsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<WorkflowApprovalInboxItemDto>>(new[] { named, legacy }));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .ListMyApprovals(cancellationToken: CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<WorkflowApprovalInboxItemDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(2, body.Data!.Count);
        Assert.Null(legacy.StartedByName);
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Contains("\"startedByName\":\"Amine Zorgati\"", JsonSerializer.Serialize(named, web));
        Assert.Contains("\"startedByName\":null", JsonSerializer.Serialize(legacy, web));
    }

    // 4.7 « v1.1 » (D-47-60) — historique de mes décisions : même forme de DTO que l'inbox, max par défaut 50.
    [Fact]
    public async Task ListMyApprovalHistory_returns_200_with_the_inbox_item_shape_and_default_max_50()
    {
        var approval = new WorkflowApprovalDto(ApprovalId, InstanceId, "approve", null, "SalesRep", "Accord ?", null,
            "approved", ApprovalId, DateTime.UtcNow, "Vu.", null, DateTime.UtcNow, "AAAAAAAAB9E=");
        var item = new WorkflowApprovalInboxItemDto(approval, InstanceId, "wf", "Relance", EntityKey, "Clients", RecordId,
            "Dossier A", Guid.NewGuid(), DateTime.UtcNow, "Amine Zorgati");
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<ListMyApprovalHistoryQuery>(q => q.Max == 50), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<WorkflowApprovalInboxItemDto>>(new[] { item }));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .ListMyApprovalHistory(cancellationToken: CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<WorkflowApprovalInboxItemDto>>>(ok.Value);
        Assert.True(body.Success);
        var single = Assert.Single(body.Data!);
        Assert.Equal("approved", single.Approval.Status);
        Assert.Equal("Vu.", single.Approval.Comment);
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Contains("\"startedByName\":\"Amine Zorgati\"", JsonSerializer.Serialize(single, web));
    }

    [Fact]
    public async Task Reject_without_comment_maps_Validation_to_400()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<DecideApprovalCommand>(c =>
                    c.ApprovalId == ApprovalId && !c.Approve && c.Comment == null),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDto>(
                Error.Validation("comment", "Un commentaire est requis pour refuser.")));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .Reject(ApprovalId, new ApprovalDecisionRequest(null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Unassigned_approval_maps_NotFound_to_404_and_decided_maps_Conflict_to_409()
    {
        var unassigned = new Mock<IMediator>();
        unassigned.Setup(m => m.Send(It.IsAny<DecideApprovalCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDto>(Error.NotFound("StudioWorkflowApproval", ApprovalId)));
        var decided = new Mock<IMediator>();
        decided.Setup(m => m.Send(It.IsAny<DecideApprovalCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDto>(Error.Conflict("Cette approbation a déjà été traitée.")));

        var notFound = await CreateController(unassigned, workflowsEnabled: true)
            .Approve(ApprovalId, null, CancellationToken.None);
        var conflict = await CreateController(decided, workflowsEnabled: true)
            .Approve(ApprovalId, null, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(notFound);
        Assert.IsType<ConflictObjectResult>(conflict);
    }

    [Fact]
    public async Task Remind_within_24_hours_maps_Conflict_to_409()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<RemindInstanceCommand>(c => c.InstanceId == InstanceId),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkflowInstanceDto>(
                Error.Conflict("Les approbateurs ont déjà été relancés il y a moins de 24 h.")));

        var result = await CreateController(mediator, workflowsEnabled: true)
            .Remind(InstanceId, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
    }

    private static StudioWorkflowRuntimeController CreateController(Mock<IMediator> mediator, bool workflowsEnabled) =>
        new(mediator.Object, Options.Create(new OllamaSettings { EnableStudioWorkflows = workflowsEnabled }));
}
