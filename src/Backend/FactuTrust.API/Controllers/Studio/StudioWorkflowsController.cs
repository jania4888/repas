using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Workflows;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// API de conception des workflows Studio (PR 4.1, tranche 4.1k) : catalogue des types d'étapes,
/// CRUD des définitions par table, activation, duplication, validation à blanc, lecture des
/// instances et catalogue tenant paginé <c>GET workflows</c> (4.5c3). Toutes les routes exigent <c>studio:design_entities</c> (politique de classe, aucune
/// politique plus faible par action) et sont gardées par le drapeau
/// <c>Ollama:EnableStudioWorkflows</c> : coupé ⇒ 404 à message fixe sur chaque route, AVANT tout
/// appel au médiateur. Les erreurs métier passent par <see cref="StudioErrorMapping"/> (409
/// <c>Conflict</c>, 404 <c>*.NotFound</c>, 400 pour le reste dont <c>Validation.*</c>). Les routes
/// d'exécution (<c>run</c>, <c>approve</c>, <c>reject</c>, <c>remind</c>, <c>cancel</c>…) relèvent de
/// la PR 4.2 et ne sont pas exposées ici.
/// </summary>
[ApiController]
[Route("api/studio")]
[Authorize(Policy = PermissionPolicies.StudioDesignEntities)]
public sealed class StudioWorkflowsController : ControllerBase
{
    /// <summary>Message figé du 404 « drapeau coupé » (A-41 D-41-12).</summary>
    public const string UnavailableMessage = "Les workflows Studio ne sont pas activés.";

    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;

    public StudioWorkflowsController(IMediator mediator, IOptions<OllamaSettings> settings)
    {
        _mediator = mediator;
        _settings = settings.Value;
    }

    /// <summary>Catalogue des sept types d'étapes et de leurs propriétés typées.</summary>
    [HttpGet("workflows/step-catalog")]
    public async Task<IActionResult> StepCatalog(CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetWorkflowStepCatalogQuery(), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            catalog => Ok(ApiResponse<WorkflowStepCatalogDto>.Ok(catalog)));
    }

    /// <summary>
    /// Catalogue tenant paginé des workflows de toutes les tables actives non-jonction (4.5c3 / D-44-20) ; remplace l'agrégation
    /// client bornée à 25 tables du hub. <paramref name="search"/> filtre nom ou clé ; <paramref name="pageSize"/> borné à 1..200.
    /// </summary>
    [HttpGet("workflows")]
    public async Task<IActionResult> ListAll(
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        pageSize = Math.Clamp(pageSize, 1, ListTenantWorkflowsQueryHandler.MaxPageSize);
        var result = await _mediator.Send(new ListTenantWorkflowsQuery(search, page, pageSize), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflows => Ok(ApiResponse<PagedResult<WorkflowDefinitionListItemDto>>.Ok(workflows)));
    }

    /// <summary>Liste des workflows (actifs et inactifs) d'une table Studio, avec le nombre d'instances ouvertes.</summary>
    [HttpGet("entities/{entityId:guid}/workflows")]
    public async Task<IActionResult> List(Guid entityId, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ListWorkflowsQuery(entityId), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflows => Ok(ApiResponse<IReadOnlyList<WorkflowDefinitionDto>>.Ok(workflows)));
    }

    /// <summary>Détail d'une définition (déclencheur, étapes, version, jeton de concurrence).</summary>
    [HttpGet("workflows/{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetWorkflowQuery(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflow => Ok(ApiResponse<WorkflowDefinitionDto>.Ok(workflow)));
    }

    /// <summary>Crée un workflow (clé unique par table, quota plan, étapes validées). 201 + Location vers <see cref="Get"/>.</summary>
    [HttpPost("entities/{entityId:guid}/workflows")]
    [ProducesResponseType(typeof(ApiResponse<WorkflowDefinitionDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create(Guid entityId, [FromBody] SaveWorkflowRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new CreateWorkflowCommand(entityId, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, workflow => CreatedAtAction(
            nameof(Get), new { id = workflow.Id }, ApiResponse<WorkflowDefinitionDto>.Ok(workflow)));
    }

    /// <summary>Met à jour un workflow (clé immuable, <c>rowVersion</c> obligatoire ; périmé ⇒ 409).</summary>
    [HttpPut("workflows/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveWorkflowRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new UpdateWorkflowCommand(id, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflow => Ok(ApiResponse<WorkflowDefinitionDto>.Ok(workflow)));
    }

    /// <summary>Active ou désactive un workflow (idempotent, sans jeton de concurrence — A-41 D-41-05).</summary>
    [HttpPost("workflows/{id:guid}/toggle")]
    public async Task<IActionResult> Toggle(Guid id, [FromBody] ToggleWorkflowRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ToggleWorkflowCommand(id, request.IsActive), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            workflow => Ok(ApiResponse<WorkflowDefinitionDto>.Ok(workflow)));
    }

    /// <summary>Supprime (soft) un workflow et annule ses instances ouvertes. 200 avec le décompte (A-41 D-41-11).</summary>
    [HttpDelete("workflows/{id:guid}")]
    [ProducesResponseType(typeof(ApiResponse<WorkflowDeletionResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new DeleteWorkflowCommand(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            deletion => Ok(ApiResponse<WorkflowDeletionResultDto>.Ok(deletion)));
    }

    /// <summary>Duplique un workflow en copie inactive « &lt;clé&gt;_copie » (A-41 D-41-06). 201 + Location vers <see cref="Get"/>.</summary>
    [HttpPost("workflows/{id:guid}/duplicate")]
    [ProducesResponseType(typeof(ApiResponse<WorkflowDefinitionDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> Duplicate(Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new DuplicateWorkflowCommand(id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, workflow => CreatedAtAction(
            nameof(Get), new { id = workflow.Id }, ApiResponse<WorkflowDefinitionDto>.Ok(workflow)));
    }

    /// <summary>Validation à blanc d'une définition : 200 même invalide, liste complète des erreurs et avertissements.</summary>
    [HttpPost("entities/{entityId:guid}/workflows/validate")]
    public async Task<IActionResult> Validate(Guid entityId, [FromBody] SaveWorkflowRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ValidateWorkflowQuery(entityId, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            validation => Ok(ApiResponse<WorkflowValidationResultDto>.Ok(validation)));
    }

    /// <summary>Instances d'un workflow, paginées (<c>page</c> ≥ 1, <c>pageSize</c> 50 par défaut, borné 1..200 — 4.7a1, D-47-B01).</summary>
    [HttpGet("workflows/{id:guid}/instances")]
    public async Task<IActionResult> ListInstances(
        Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        pageSize = Math.Clamp(pageSize, 1, ListWorkflowInstancesQueryHandler.MaxPageSize);
        var result = await _mediator.Send(new ListWorkflowInstancesQuery(id, page, pageSize), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            instances => Ok(ApiResponse<PagedResult<WorkflowInstanceDto>>.Ok(instances)));
    }

    /// <summary>Détail d'une instance : résumé, journal des étapes, approbations et contexte (« previous » masqué).</summary>
    [HttpGet("workflows/instances/{instanceId:guid}")]
    public async Task<IActionResult> GetInstance(Guid instanceId, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetWorkflowInstanceQuery(instanceId), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            detail => Ok(ApiResponse<WorkflowInstanceDetailDto>.Ok(detail)));
    }

    /// <summary>
    /// Simulation PURE du premier segment sur un enregistrement réel (4.7c1 / R17) : trace pas à pas
    /// (verdicts <c>would_run</c>/<c>skipped</c>/<c>would_suspend</c>/<c>would_fail</c>, gabarits rendus)
    /// — <b>aucune écriture</b> (ni instance, ni notification, ni audit). Route de conception, policy de classe.
    /// </summary>
    [HttpPost("workflows/{id:guid}/test")]
    public async Task<IActionResult> Test(Guid id, [FromBody] WorkflowTestRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new TestWorkflowQuery(id, request.RecordId), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            trace => Ok(ApiResponse<WorkflowTestResultDto>.Ok(trace)));
    }

    /// <summary>404 à message fixe lorsque <c>Ollama:EnableStudioWorkflows</c> est coupé ; appelé avant tout <c>Send</c>.</summary>
    private IActionResult? Unavailable() =>
        _settings.EnableStudioWorkflows
            ? null
            : NotFound(ApiResponse<object>.Fail(UnavailableMessage, "NotFound"));
}
