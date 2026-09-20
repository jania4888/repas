using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.RecordViews;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// Vues enregistrées (PR 2.3) d'une table Studio : CRUD + « par défaut » + exécution serveur
/// (liste paginée, kanban groupé, calendrier borné). Distinct de <c>StudioViewsController</c>
/// (fenêtres SQL en lecture sur tables ERP existantes). Lecture :
/// <c>custom_records:read</c> ; conception : <c>studio:design_forms</c>. Le tout est gardé par le
/// drapeau <c>Ollama:EnableStudioRecordViews</c> : coupé ⇒ 404 sur chaque route, sans appel MediatR.
/// </summary>
[ApiController]
[Route("api/studio/records/{entityKey}/views")]
[Authorize]
public sealed class StudioRecordViewsController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;

    public StudioRecordViewsController(IMediator mediator, IOptions<OllamaSettings> settings)
    {
        _mediator = mediator;
        _settings = settings.Value;
    }

    /// <summary>Liste des vues de la table (actives et inactives), vue par défaut en tête.</summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> List(string entityKey, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new ListCustomRecordViewsQuery(entityKey), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            views => Ok(ApiResponse<IReadOnlyList<CustomRecordViewDto>>.Ok(views)));
    }

    /// <summary>Détail d'une vue.</summary>
    [HttpGet("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> Get(string entityKey, Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new GetCustomRecordViewQuery(entityKey, id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            view => Ok(ApiResponse<CustomRecordViewDto>.Ok(view)));
    }

    /// <summary>Crée une vue (clé unique par table, quota plan). 201.</summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.StudioDesignForms)]
    public async Task<IActionResult> Create(string entityKey, [FromBody] SaveCustomRecordViewRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new CreateCustomRecordViewCommand(entityKey, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            view => CreatedAtAction(nameof(Get), new { entityKey, id = view.Id }, ApiResponse<CustomRecordViewDto>.Ok(view)));
    }

    /// <summary>Met à jour une vue (RowVersion obligatoire ⇒ 409 si périmée). La clé est immuable.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.StudioDesignForms)]
    public async Task<IActionResult> Update(string entityKey, Guid id, [FromBody] SaveCustomRecordViewRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new UpdateCustomRecordViewCommand(entityKey, id, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            view => Ok(ApiResponse<CustomRecordViewDto>.Ok(view)));
    }

    /// <summary>Suppression logique (R12 : aucune promotion automatique si la vue était par défaut). 204.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.StudioDesignForms)]
    public async Task<IActionResult> Delete(string entityKey, Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new DeleteCustomRecordViewCommand(entityKey, id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, _ => NoContent());
    }

    /// <summary>Définit la vue par défaut (exclusif : les autres perdent le drapeau). 204.</summary>
    [HttpPost("{id:guid}/default")]
    [Authorize(Policy = PermissionPolicies.StudioDesignForms)]
    public async Task<IActionResult> SetDefault(string entityKey, Guid id, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new SetDefaultCustomRecordViewCommand(entityKey, id), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, _ => NoContent());
    }

    /// <summary>
    /// Exécute la vue côté serveur : liste paginée (items), kanban (groups ordonnés, « Sans valeur »,
    /// truncated &gt; 500) ou calendrier (events sur une fenêtre ≤ 92 jours, truncated &gt; 1000).
    /// </summary>
    [HttpPost("{id:guid}/run")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> Run(string entityKey, Guid id, [FromBody] RunRecordViewRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new RunCustomRecordViewQuery(entityKey, id, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            run => Ok(ApiResponse<RecordViewRunResultDto>.Ok(run)));
    }

    /// <summary>
    /// Exécute une définition non enregistrée (aperçu du concepteur, R3 / 4.7v1) : rien n'est
    /// persisté, ni quota ni audit ; mêmes bornes que <c>run</c>. Réservée aux concepteurs.
    /// </summary>
    [HttpPost("preview")]
    [Authorize(Policy = PermissionPolicies.StudioDesignForms)]
    public async Task<IActionResult> Preview(string entityKey, [FromBody] PreviewRecordViewRequest request, CancellationToken cancellationToken)
    {
        if (Unavailable() is { } unavailable) return unavailable;
        var result = await _mediator.Send(new PreviewCustomRecordViewQuery(entityKey, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            run => Ok(ApiResponse<RecordViewRunResultDto>.Ok(run)));
    }

    // ---- helpers ----

    /// <summary>Renvoie 404 tant que le drapeau est coupé (avant tout appel MediatR) ; sinon null.</summary>
    private IActionResult? Unavailable() =>
        _settings.EnableStudioRecordViews
            ? null
            : NotFound(ApiResponse<object>.Fail("Les vues enregistrées ne sont pas activées.", "NotFound"));
}
