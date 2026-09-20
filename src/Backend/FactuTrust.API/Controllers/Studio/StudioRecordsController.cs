using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// Runtime CRUD over the records of a custom entity, resolved by entity key. Reading requires
/// <c>custom_records:read</c>; writing requires <c>custom_records:write</c>. These are end-user
/// permissions (separate from the design-time studio:* permissions).
/// </summary>
[ApiController]
[Route("api/studio/records/{entityKey}")]
[Authorize]
public sealed class StudioRecordsController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly OllamaSettings _settings;

    public StudioRecordsController(IMediator mediator, IOptions<OllamaSettings> settings)
    {
        _mediator = mediator;
        _settings = settings.Value;
    }

    /// <summary>Entity + active fields, for the runtime form/table renderer.</summary>
    [HttpGet("schema")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> Schema(string entityKey, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetCustomEntitySchemaQuery(entityKey), cancellationToken);
        return result.IsFailure
            ? NotFound(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomEntitySchemaDto>.Ok(result.Value));
    }

    /// <summary>
    /// Paged list. <paramref name="filterField"/>/<paramref name="filterValue"/> (PR 2.1) add an exact
    /// server-side filter on one active field (e.g. junction rows of the current record for the « Liés »
    /// tab); cumulative with <paramref name="search"/>. <paramref name="pageSize"/> is clamped to 1..200.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> List(
        string entityKey,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? filterField = null,
        [FromQuery] string? filterValue = null,
        CancellationToken cancellationToken = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);
        var result = await _mediator.Send(
            new ListCustomRecordsQuery(entityKey, search, page, pageSize, filterField, filterValue), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<PagedResult<CustomRecordDto>>.Ok(result.Value));
    }

    [HttpGet("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> Get(string entityKey, Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetCustomRecordQuery(entityKey, id), cancellationToken);
        return result.IsFailure
            ? NotFound(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomRecordDto>.Ok(result.Value));
    }

    /// <summary>Create. <c>record.duplicate_link</c> (junction pair already linked) ⇒ 409 ; any other error ⇒ 400 (historical).</summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Create(string entityKey, [FromBody] SaveCustomRecordRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new CreateCustomRecordCommand(entityKey, request), cancellationToken);
        return result.IsFailure
            ? MapWriteError(result.Error)
            : Ok(ApiResponse<CustomRecordDto>.Ok(result.Value));
    }

    /// <summary>Update. <c>record.duplicate_link</c> ⇒ 409 ; any other error ⇒ 400 (historical).</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Update(string entityKey, Guid id, [FromBody] SaveCustomRecordRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new UpdateCustomRecordCommand(entityKey, id, request), cancellationToken);
        return result.IsFailure
            ? MapWriteError(result.Error)
            : Ok(ApiResponse<CustomRecordDto>.Ok(result.Value));
    }

    /// <summary>
    /// PR 2.1 : seul <see cref="StudioErrorCodes.RecordDuplicateLink"/> passe par <see cref="StudioErrorMapping"/>
    /// (409) ; tous les autres codes conservent le 400 historique de ce contrôleur (y compris <c>Conflict</c>
    /// d'unicité de champ et <c>*.NotFound</c>, pour ne pas changer le contrat existant du frontend).
    /// </summary>
    private IActionResult MapWriteError(Error error) =>
        error.Code == StudioErrorCodes.RecordDuplicateLink
            ? StudioErrorMapping.Map(this, error)
            : BadRequest(ApiResponse<object>.Fail(error.Description, error.Code));

    /// <summary>
    /// PATCH partiel (PR 2.3, R5) : fusion des seules clés fournies (<c>null</c> = effacement), RowVersion
    /// OBLIGATOIRE (400 <c>Validation.rowVersion</c> absent, 409 <c>Conflict</c> périmé). Gardé par
    /// <c>Ollama:EnableStudioRecordViews</c> (off ⇒ 404, sans appel MediatR). Contrairement au PUT, le
    /// PATCH mappe <c>Conflict</c> et <c>*.NotFound</c> via <see cref="StudioErrorMapping"/> (409/404).
    /// </summary>
    [HttpPatch("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Patch(string entityKey, Guid id, [FromBody] PatchCustomRecordRequest request, CancellationToken cancellationToken)
    {
        if (!_settings.EnableStudioRecordViews)
            return NotFound(ApiResponse<object>.Fail("Les vues enregistrées ne sont pas activées.", "NotFound"));

        var result = await _mediator.Send(new PatchCustomRecordCommand(entityKey, id, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            record => Ok(ApiResponse<CustomRecordDto>.Ok(record)));
    }

    /// <summary>
    /// Historique paginé de l'enregistrement (Studio 4.7 « v1.1 » — D5), le plus récent d'abord,
    /// alimenté par le journal d'audit (4.7h1). AUCUN drapeau de fonctionnalité. Entité
    /// introuvable/inactive ⇒ 400 ; enregistrement inconnu ⇒ 404 (via <see cref="StudioErrorMapping"/>).
    /// </summary>
    [HttpGet("{id:guid}/history")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> History(
        string entityKey, Guid id,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(
            new ListCustomRecordHistoryQuery(entityKey, id, page, pageSize), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result,
            history => Ok(ApiResponse<PagedResult<RecordHistoryEntryDto>>.Ok(history)));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsWrite)]
    public async Task<IActionResult> Delete(string entityKey, Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeleteCustomRecordCommand(entityKey, id), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<object>.Ok(new { }, "Enregistrement supprimé."));
    }
}
