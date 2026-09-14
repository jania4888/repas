using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers.Studio;

/// <summary>
/// Design-time management of the fields of a custom entity. Requires <c>studio:design_entities</c>.
/// </summary>
[ApiController]
[Route("api/studio/entities/{entityId:guid}/fields")]
[Authorize(Policy = PermissionPolicies.StudioDesignEntities)]
public sealed class StudioFieldsController : ControllerBase
{
    private readonly IMediator _mediator;

    public StudioFieldsController(IMediator mediator) => _mediator = mediator;

    [HttpGet]
    public async Task<IActionResult> List(Guid entityId, [FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ListCustomFieldsQuery(entityId, includeInactive), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<IReadOnlyList<CustomFieldDto>>.Ok(result.Value));
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid entityId, [FromBody] CreateCustomFieldRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new CreateCustomFieldCommand(entityId, request), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomFieldDto>.Ok(result.Value));
    }

    [HttpPut("{fieldId:guid}")]
    public async Task<IActionResult> Update(Guid entityId, Guid fieldId, [FromBody] UpdateCustomFieldRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new UpdateCustomFieldCommand(fieldId, request), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomFieldDto>.Ok(result.Value));
    }

    [HttpDelete("{fieldId:guid}")]
    public async Task<IActionResult> Delete(Guid entityId, Guid fieldId, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeleteCustomFieldCommand(fieldId), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<object>.Ok(new { }, "Champ supprimé."));
    }

    [HttpPut("reorder")]
    public async Task<IActionResult> Reorder(Guid entityId, [FromBody] ReorderCustomFieldsRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ReorderCustomFieldsCommand(entityId, request), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<object>.Ok(new { }, "Ordre mis à jour."));
    }

    // ---- Changement de type (PR 3.1) : hors flag, sous la même policy StudioDesignEntities ----

    [HttpGet("{fieldId:guid}/type-check")]
    public async Task<IActionResult> TypeCheck(Guid entityId, Guid fieldId, [FromQuery] string? to, CancellationToken cancellationToken)
    {
        // Analysé par NOM d'énumération uniquement (jamais par valeur numérique, même définie :
        // « to=3 » est rejeté au même titre que « to=42 »).
        var type = ParseFieldTypeByName(to);
        if (type is null)
            return StudioErrorMapping.Map(this, Error.Validation("to", "Type de champ cible invalide ou absent."));

        var result = await _mediator.Send(new CheckCustomFieldTypeChangeQuery(entityId, fieldId, type.Value), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, value => Ok(ApiResponse<FieldTypeChangeCheckDto>.Ok(value)));
    }

    [HttpPatch("{fieldId:guid}/type")]
    public async Task<IActionResult> ChangeType(Guid entityId, Guid fieldId, [FromBody] ChangeCustomFieldTypeRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ChangeCustomFieldTypeCommand(entityId, fieldId, request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, value => Ok(ApiResponse<CustomFieldDto>.Ok(value)));
    }

    /// <summary>Correspondance stricte sur les noms de <see cref="CustomFieldType"/> (insensible à la casse) ; les valeurs numériques sont refusées.</summary>
    internal static CustomFieldType? ParseFieldTypeByName(string? to)
    {
        if (string.IsNullOrWhiteSpace(to))
            return null;

        var name = Enum.GetNames<CustomFieldType>()
            .FirstOrDefault(n => string.Equals(n, to.Trim(), StringComparison.OrdinalIgnoreCase));
        return name is null ? null : Enum.Parse<CustomFieldType>(name);
    }
}
