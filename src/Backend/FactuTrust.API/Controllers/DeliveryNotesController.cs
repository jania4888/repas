using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.DeliveryNotes.Commands;
using FactuTrust.Application.Features.DeliveryNotes.Queries;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

/// <summary>
/// API controller for managing Delivery Notes (Bons de Livraison).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DeliveryNotesController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<DeliveryNotesController> _logger;

    public DeliveryNotesController(IMediator mediator, ILogger<DeliveryNotesController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    /// <summary>
    /// Get paginated list of delivery notes with optional filtering.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<DeliveryNoteListDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDeliveryNotes(
        [FromQuery] string? search,
        [FromQuery] DeliveryNoteStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var query = new GetDeliveryNotesListQuery(page, pageSize, clientId, status, fromDate, toDate, search);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<PagedResult<DeliveryNoteListDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Get aggregated totals for the delivery note list (same filters, computed over the entire
    /// filtered set — not just the current page) for the totals zone.
    /// </summary>
    [HttpGet("summary")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(ApiResponse<DeliveryNoteListSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDeliveryNotesSummary(
        [FromQuery] string? search,
        [FromQuery] DeliveryNoteStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        CancellationToken cancellationToken = default)
    {
        var query = new GetDeliveryNotesSummaryQuery(clientId, status, fromDate, toDate, search);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<DeliveryNoteListSummaryDto>.Ok(result.Value));
    }

    /// <summary>
    /// Export delivery notes report as PDF for a given period and optional client.
    /// </summary>
    [HttpGet("report/pdf")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportReportPdf(
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        CancellationToken cancellationToken = default)
    {
        var query = new ExportDeliveryNoteReportPdfQuery(fromDate, toDate, clientId);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NoDeliveryNotes" || result.Error.Code == "TooManyDeliveryNotes")
                return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
            if (result.Error.Code.StartsWith("Validation"))
                return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        var pdf = result.Value;
        return File(pdf.Content, pdf.ContentType, pdf.FileName);
    }

    /// <summary>
    /// Get delivery note details by ID.
    /// </summary>
    [HttpGet("{id:guid}", Name = "GetDeliveryNote")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(ApiResponse<DeliveryNoteDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetDeliveryNote(Guid id, CancellationToken cancellationToken)
    {
        var query = new GetDeliveryNoteByIdQuery(id);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<DeliveryNoteDetailDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<DeliveryNoteDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Export an individual delivery note as PDF.
    /// </summary>
    [HttpGet("{id:guid}/pdf")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportPdf(Guid id, [FromQuery] string? templateKey, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ExportDeliveryNotePdfQuery(id, templateKey), cancellationToken);
        if (result.IsFailure)
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));

        var pdf = result.Value;
        return File(pdf.Content, pdf.ContentType, pdf.FileName);
    }

    /// <summary>
    /// Create a new delivery note.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateDeliveryNote(
        [FromBody] CreateDeliveryNoteDto dto,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Creating delivery note for client {ClientId} with {LineCount} lines",
            dto.ClientId, dto.Lines?.Count ?? 0);

        var command = new CreateDeliveryNoteCommand(dto);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            _logger.LogWarning(
                "Failed to create delivery note: {ErrorCode} - {ErrorMessage}",
                result.Error.Code, result.Error.Description);

            return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        }

        _logger.LogInformation("Delivery note created successfully with ID {DeliveryNoteId}", result.Value);

        return CreatedAtAction(
            nameof(GetDeliveryNote),
            new { id = result.Value },
            ApiResponse<Guid>.Ok(result.Value, "Bon de livraison créé avec succès"));
    }

    /// <summary>
    /// Confirm a delivery note, making it ready for delivery.
    /// </summary>
    [HttpPost("{id:guid}/confirm")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ConfirmDeliveryNote(Guid id, CancellationToken cancellationToken)
    {
        var command = new ConfirmDeliveryNoteCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        // Validation.Status (déjà confirmé / non confirmable) est lu par le client : le message peut être traduit.
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.FailWithCode(result.Error.Description, result.Error.Code));

        return Ok(ApiResponse<object>.Ok(null!, "Bon de livraison confirmé avec succès"));
    }

    /// <summary>
    /// Start delivery (transition from Confirmed to InTransit).
    /// </summary>
    [HttpPost("{id:guid}/start-delivery")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> StartDelivery(Guid id, CancellationToken cancellationToken)
    {
        var command = new StartDeliveryCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Livraison démarrée avec succès"));
    }

    /// <summary>
    /// Record delivery completion with recipient signature.
    /// </summary>
    [HttpPost("{id:guid}/deliver")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> RecordDelivery(
        Guid id,
        [FromBody] RecordDeliveryDto dto,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Recording delivery for note {DeliveryNoteId} with recipient {RecipientName}",
            id, dto.RecipientName);

        var command = new RecordDeliveryCommand(id, dto, dto.LineAllocations);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Livraison enregistrée avec succès"));
    }

    /// <summary>
    /// Cancel a delivery note.
    /// </summary>
    [HttpPost("{id:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CancelDeliveryNote(
        Guid id,
        [FromBody] CancelDeliveryNoteRequest request,
        CancellationToken cancellationToken)
    {
        var command = new CancelDeliveryNoteCommand(id, request.Reason);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Bon de livraison annulé"));
    }

    /// <summary>
    /// Generate an invoice from a delivery note (uses delivered quantities and snapshot prices).
    /// </summary>
    [HttpPost("{id:guid}/generate-invoice")]
    [Authorize(Policy = PermissionPolicies.InvoicesCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GenerateInvoice(
        Guid id,
        [FromBody] GenerateInvoiceFromDeliveryNoteDto? dto,
        CancellationToken cancellationToken)
    {
        var command = new GenerateInvoiceFromDeliveryNoteCommand(
            id,
            dto ?? new GenerateInvoiceFromDeliveryNoteDto(null, null, null, null));
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<Guid>.Ok(result.Value, "Facture générée avec succès"));
    }

    /// <summary>
    /// Facturation groupée : agrège plusieurs bons de livraison d'un même client en une seule
    /// facture — la facturation périodique du B2B. Le stock ayant déjà été sorti à chaque
    /// livraison, la facture produite ne le redéduit pas.
    /// </summary>
    [HttpPost("generate-grouped-invoice")]
    [Authorize(Policy = PermissionPolicies.InvoicesCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GenerateGroupedInvoice(
        [FromBody] GenerateInvoiceFromDeliveryNotesDto dto,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new GenerateInvoiceFromDeliveryNotesCommand(dto), cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<Guid>.Ok(result.Value, "Facture groupée générée avec succès"));
    }

    /// <summary>
    /// Get uninvoiced delivery notes for a client (for grouping into invoice).
    /// </summary>
    [HttpGet("uninvoiced/{clientId:guid}")]
    [Authorize(Policy = PermissionPolicies.DeliveryNotesRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<DeliveryNoteListDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUninvoicedByClient(
        Guid clientId,
        CancellationToken cancellationToken)
    {
        var query = new GetDeliveryNotesListQuery(
            Page: 1,
            PageSize: 100,
            ClientId: clientId,
            Status: DeliveryNoteStatus.Delivered);

        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        // Filter to uninvoiced only
        var uninvoiced = result.Value.Items
            .Where(d => d.InvoiceId == null)
            .ToList();

        return Ok(ApiResponse<IReadOnlyList<DeliveryNoteListDto>>.Ok(uninvoiced));
    }
}

/// <summary>
/// Request model for cancellation.
/// </summary>
public record CancelDeliveryNoteRequest(string Reason);

