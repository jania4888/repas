using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Workflows;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// API runtime des workflows Studio (PR 4.2, tranche 4.2g) : boîte de réception des approbations,
/// décision (approve/reject), instances d'un enregistrement et détail d'une instance (4.5b2), workflows
/// lançables, lancement manuel, annulation et relance des approbateurs. Les GET exigent <c>custom_records:read</c>, les POST
/// <c>custom_records:write</c> (R15 : pas de <c>studio:design_entities</c> pour le runtime lecteur).
/// Toutes les routes sont gardées par le drapeau <c>Ollama:EnableStudioWorkflows</c> : coupé ⇒ 404 à
/// message fixe AVANT tout appel au médiateur. Erreurs via <see cref="StudioErrorMapping"/> (409
/// <c>Conflict</c>, 404 <c>*.NotFound</c> — approbation non assignée incluse, 400 <c>Validation.*</c>).
/// </summary>
[ApiController]
[Route("api/studio")]
[Authorize]
public sealed class StudioWorkflowRuntimeController : ControllerBase
{
    /// <summary>Message figé du 404 « drapeau coupé » (motif A-41 §0.5).</summary>
    public const string UnavailableMessage = StudioWorkflowsController.UnavailableMessage;

    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;

    public StudioWorkflowRuntimeController(IMediator mediator, IOptions<OllamaSettings> settings)
    {
        _mediator = mediator;
        _settings = settings.Value;
    }

    /// <summary>Approbations en attente de l'utilisateur courant (directes ou via son rôle).</summary>
    [HttpGet("workflows/approvals/mine")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> ListMyApprovals([FromQuery] int max = 100, CancellationToken cancellationToken = default)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ListMyApprovalsQuery(max), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            items => Ok(ApiResponse<IReadOnlyList<WorkflowApprovalInboxItemDto>>.Ok(items)));
    }

    /// <summary>Mes décisions d'approbation passées (approuvées/refusées), triées de la plus récente (4.7 « v1.1 »).</summary>
    [HttpGet("workflows/approvals/mine/history")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> ListMyApprovalHistory([FromQuery] int max = 50, CancellationToken cancellationToken = default)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ListMyApprovalHistoryQuery(max), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            items => Ok(ApiResponse<IReadOnlyList<WorkflowApprovalInboxItemDto>>.Ok(items)));
    }

    /// <summary>Nombre d'approbations en attente (badge ; appel fréquent, une seule requête SQL).</summary>
    [HttpGet("workflows/approvals/mine/count")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> CountMyApprovals(CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new CountMyApprovalsQuery(), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            count => Ok(ApiResponse<ApprovalCountDto>.Ok(count)));
    }

    /// <summary>Approuve une approbation (commentaire optionnel) puis reprend le workflow inline.</summary>
    [HttpPost("workflows/approvals/{approvalId:guid}/approve")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Approve(
        Guid approvalId, [FromBody] ApprovalDecisionRequest? body, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new DecideApprovalCommand(approvalId, true, body?.Comment), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instance => Ok(ApiResponse<WorkflowInstanceDto>.Ok(instance)));
    }

    /// <summary>Refuse une approbation (commentaire obligatoire — 400 <c>Validation.comment</c> sinon).</summary>
    [HttpPost("workflows/approvals/{approvalId:guid}/reject")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Reject(
        Guid approvalId, [FromBody] ApprovalDecisionRequest? body, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new DecideApprovalCommand(approvalId, false, body?.Comment), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instance => Ok(ApiResponse<WorkflowInstanceDto>.Ok(instance)));
    }

    /// <summary>Instances de workflow d'un enregistrement (onglet « Workflows » de la fiche).</summary>
    [HttpGet("records/{entityKey}/{recordId:guid}/workflow-instances")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> ListRecordInstances(
        string entityKey, Guid recordId, [FromQuery] int max = 50, CancellationToken cancellationToken = default)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ListRecordWorkflowInstancesQuery(entityKey, recordId, max), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instances => Ok(ApiResponse<IReadOnlyList<WorkflowInstanceDto>>.Ok(instances)));
    }

    /// <summary>
    /// Détail d'une instance de l'enregistrement (résumé, étapes, approbations, contexte sans « previous ») pour les lecteurs
    /// (<c>custom_records:read</c>, 4.5b2 / D11) — même corps que <see cref="StudioWorkflowsController.GetInstance"/>, mais borné à la fiche.
    /// </summary>
    [HttpGet("records/{entityKey}/{recordId:guid}/workflow-instances/{instanceId:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> GetRecordInstance(
        string entityKey, Guid recordId, Guid instanceId, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetRecordWorkflowInstanceQuery(entityKey, recordId, instanceId), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            detail => Ok(ApiResponse<WorkflowInstanceDetailDto>.Ok(detail)));
    }

    /// <summary>Workflows manuels actifs de la table (bouton « Lancer » de la fiche).</summary>
    [HttpGet("records/{entityKey}/workflows")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> ListRunnable(string entityKey, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetRecordWorkflowsQuery(entityKey), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflows => Ok(ApiResponse<IReadOnlyList<RunnableWorkflowDto>>.Ok(workflows)));
    }

    /// <summary>
    /// Lance un workflow manuel sur l'enregistrement. 201 + <c>Location</c> vers
    /// <see cref="StudioWorkflowsController.GetInstance"/> ; quota atteint ⇒ 400 <c>Validation.Plan</c>.
    /// </summary>
    [HttpPost("records/{entityKey}/{recordId:guid}/workflows/{workflowKey}/run")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    [ProducesResponseType(typeof(ApiResponse<WorkflowInstanceDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> Run(
        string entityKey, Guid recordId, string workflowKey, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new RunWorkflowCommand(entityKey, recordId, workflowKey), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, instance => CreatedAtAction(
            nameof(StudioWorkflowsController.GetInstance), "StudioWorkflows", new { instanceId = instance.Id },
            ApiResponse<WorkflowInstanceDto>.Ok(instance)));
    }

    /// <summary>Annule une instance ouverte (le moteur annule aussi les approbations en attente).</summary>
    [HttpPost("workflows/instances/{instanceId:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Cancel(
        Guid instanceId, [FromBody] CancelInstanceRequest? body, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new CancelInstanceCommand(instanceId, body?.Reason), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instance => Ok(ApiResponse<WorkflowInstanceDto>.Ok(instance)));
    }

    /// <summary>Relance les approbateurs (1 relance / 24 h — 409 en deçà).</summary>
    [HttpPost("workflows/instances/{instanceId:guid}/remind")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Remind(Guid instanceId, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new RemindInstanceCommand(instanceId), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instance => Ok(ApiResponse<WorkflowInstanceDto>.Ok(instance)));
    }

    /// <summary>404 figé tant que <c>Ollama:EnableStudioWorkflows</c> est coupé (avant tout <c>Send</c>).</summary>
    private IActionResult? Unavailable() =>
        _settings.EnableStudioWorkflows
            ? null
            : NotFound(ApiResponse<object>.Fail(UnavailableMessage, "NotFound"));
}
