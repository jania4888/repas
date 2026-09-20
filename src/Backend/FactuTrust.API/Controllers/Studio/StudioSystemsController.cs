using System.Text;
using System.Text.Json;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Systems;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Studio;

[ApiController]
[Route("api/studio/systems")]
[Authorize(Policy = PermissionPolicies.StudioDesignEntities)]
public sealed class StudioSystemsController : ControllerBase
{
    /// <summary>Borne du corps d'import (512 Ko) ; le handler borne lui-même la spec à 256 Ko.</summary>
    private const int ImportMaxBodyBytes = 512 * 1024;

    /// <summary>Fichier téléchargé : indenté et accents lisibles (pièce jointe JSON, jamais rendue en HTML).</summary>
    private static readonly JsonSerializerOptions IndentedJson = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly IMediator _mediator;
    private readonly OllamaSettings _ollamaSettings;

    public StudioSystemsController(IMediator mediator, IOptions<OllamaSettings> ollamaSettings)
    {
        _mediator = mediator;
        _ollamaSettings = ollamaSettings.Value;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ListCustomSystemsQuery(includeInactive), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<IReadOnlyList<CustomSystemDto>>.Ok(result.Value));
    }

    [HttpGet("{key}")]
    [Authorize(Policy = PermissionPolicies.CustomRecordsRead)]
    public async Task<IActionResult> GetByKey(string key, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetCustomSystemByKeyQuery(key), cancellationToken);
        return result.IsFailure
            ? NotFound(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomSystemDetailDto>.Ok(result.Value));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCustomSystemRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new CreateCustomSystemCommand(request), cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code))
            : Ok(ApiResponse<CustomSystemDto>.Ok(result.Value));
    }

    // ---- Export / duplication / import (PR 3.3, tranche 3.3d) : gardés par EnableStudioSystemExport
    // (et EnableStudioAiPlanPreview pour les deux routes qui créent un plan) — flag off ⇒ 404 AVANT
    // tout appel au médiateur. Policy de classe StudioDesignEntities (P3), aucune policy plus faible.

    /// <summary>
    /// Export d'un système du tenant : 200 + enveloppe <see cref="StudioSystemExportDto"/>, ou avec
    /// <c>download=true</c> un fichier JSON indenté contenant la spec seule (sans enveloppe).
    /// </summary>
    [HttpGet("{key}/export")]
    [ProducesResponseType(typeof(ApiResponse<StudioSystemExportDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Export(
        string key,
        [FromQuery] bool includeSeed = false,
        [FromQuery] bool download = false,
        CancellationToken cancellationToken = default)
    {
        if (SystemExportUnavailableOrNull() is { } unavailable)
            return unavailable;

        var result = await _mediator.Send(new ExportCustomSystemQuery(key, includeSeed), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, value => download
            ? File(
                Encoding.UTF8.GetBytes(value.Spec.ToJsonString(IndentedJson)),
                "application/json",
                $"studio-system-{value.SystemKey}.json")
            : Ok(ApiResponse<StudioSystemExportDto>.Ok(value)));
    }

    /// <summary>Duplication « (copie) » : plan <c>CreateSystem</c> Pending ⇒ 201 + Location du plan (P9).</summary>
    [HttpPost("{key}/duplicate")]
    [ProducesResponseType(typeof(ApiResponse<StudioAiPlanCreationResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Duplicate(
        string key,
        [FromBody] DuplicateCustomSystemRequest? request,
        CancellationToken cancellationToken)
    {
        if (SystemExportUnavailableOrNull() is { } unavailable)
            return unavailable;
        if (PlanPreviewUnavailableOrNull() is { } previewUnavailable)
            return previewUnavailable;

        var result = await _mediator.Send(new DuplicateCustomSystemCommand(key, request?.DisplayName), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, value => Created(
            $"/api/studio/ai/plans/{value.Plan.Id}",
            ApiResponse<StudioAiPlanCreationResponse>.Ok(value)));
    }

    /// <summary>Import d'une spec exportée : plan <c>CreateSystem</c> Pending ⇒ 201 / 400 / 413.</summary>
    [HttpPost("import")]
    [RequestSizeLimit(ImportMaxBodyBytes)]
    [ProducesResponseType(typeof(ApiResponse<StudioAiPlanCreationResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    public async Task<IActionResult> Import(
        [FromBody] ImportCustomSystemRequest request,
        CancellationToken cancellationToken)
    {
        if (SystemExportUnavailableOrNull() is { } unavailable)
            return unavailable;
        if (PlanPreviewUnavailableOrNull() is { } previewUnavailable)
            return previewUnavailable;

        var result = await _mediator.Send(new ImportCustomSystemCommand(request), cancellationToken);
        return StudioErrorMapping.ToActionResult(this, result, value => Created(
            $"/api/studio/ai/plans/{value.Plan.Id}",
            ApiResponse<StudioAiPlanCreationResponse>.Ok(value)));
    }

    /// <summary>Garde de l'export : 404 à message fixe tant que <c>EnableStudioSystemExport</c> est coupé.</summary>
    private IActionResult? SystemExportUnavailableOrNull() =>
        _ollamaSettings.EnableStudioSystemExport
            ? null
            : NotFound(ApiResponse<object>.Fail("L'export de systèmes Studio n'est pas activé."));

    /// <summary>Garde du flux d'aperçu : même libellé que <c>StudioAiPlansController</c> (D-d-1).</summary>
    private IActionResult? PlanPreviewUnavailableOrNull() =>
        _ollamaSettings.EnableStudioAiPlanPreview
            ? null
            : NotFound(ApiResponse<object>.Fail("Le flux d'aperçu Studio n'est pas activé."));
}
