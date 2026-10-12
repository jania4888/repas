using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices;
using FactuTrust.Application.Features.Invoices.Commands;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class InvoicesController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<InvoicesController> _logger;

    public InvoicesController(IMediator mediator, ILogger<InvoicesController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    /// <summary>
    /// Get paginated list of invoices with optional filtering.
    /// </summary>
    /// <remarks>
    /// <paramref name="realizedRevenueOnly"/> combines with <paramref name="status"/> and
    /// <paramref name="unpaidOnly"/> as an AND: e.g. realizedRevenueOnly + unpaidOnly only returns
    /// Validated documents, and realizedRevenueOnly + status=Signed returns an empty list.
    /// </remarks>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<InvoiceListDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetInvoices(
        [FromQuery] string? search,
        [FromQuery] InvoiceStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] bool unpaidOnly = false,
        [FromQuery] string? type = null,
        [FromQuery] bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveInvoiceType(type, out var parsedType, out var errorResult))
            return errorResult!;

        var query = new GetInvoicesQuery(search, status, fromDate, toDate, clientId, page, pageSize, unpaidOnly, parsedType, realizedRevenueOnly);
        var result = await _mediator.Send(query, cancellationToken);

        return Ok(ApiResponse<PagedResult<InvoiceListDto>>.Ok(result));
    }

    /// <summary>
    /// Get aggregated totals for the invoice list. Accepts the same filters as the list and
    /// computes totals over the ENTIRE filtered set (not just the current page) for the totals zone.
    /// </summary>
    [HttpGet("summary")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(ApiResponse<InvoiceListSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetInvoicesSummary(
        [FromQuery] string? search,
        [FromQuery] InvoiceStatus? status,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] bool unpaidOnly = false,
        [FromQuery] string? type = null,
        [FromQuery] bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveInvoiceType(type, out var parsedType, out var errorResult))
            return errorResult!;

        var query = new GetInvoicesSummaryQuery(search, status, fromDate, toDate, clientId, unpaidOnly, parsedType, realizedRevenueOnly);
        var result = await _mediator.Send(query, cancellationToken);

        return Ok(ApiResponse<InvoiceListSummaryDto>.Ok(result));
    }

    /// <summary>
    /// Export sales invoices report as PDF for a given period and optional client.
    /// </summary>
    [HttpGet("report/pdf")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportReportPdf(
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] Guid? clientId,
        [FromQuery] string? type = null,
        [FromQuery] bool realizedRevenueOnly = false,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveInvoiceType(type, out var parsedType, out var errorResult))
            return errorResult!;

        var query = new ExportInvoiceReportPdfQuery(fromDate, toDate, clientId, parsedType, realizedRevenueOnly);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NoInvoices" || result.Error.Code == "TooManyInvoices")
                return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
            if (result.Error.Code.StartsWith("Validation"))
                return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));
        }

        var pdf = result.Value;
        return File(pdf.Content, pdf.ContentType, pdf.FileName);
    }

    /// <summary>
    /// Get invoice details by ID.
    /// </summary>
    [HttpGet("{id:guid}", Name = "GetInvoice")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(ApiResponse<InvoiceDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetInvoice(Guid id, CancellationToken cancellationToken)
    {
        var query = new GetInvoiceByIdQuery(id);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<InvoiceDetailDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<InvoiceDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Create a new invoice.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.InvoicesCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateInvoice(
        [FromBody] CreateInvoiceDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation(
                "Creating invoice for client {ClientId} with {LineCount} lines",
                dto.ClientId, dto.Lines?.Count ?? 0);

            var command = new CreateInvoiceCommand(dto);
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                _logger.LogWarning(
                    "Failed to create invoice: {ErrorCode} - {ErrorMessage}",
                    result.Error.Code, result.Error.Description);
                
                return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description, result.Error.Code));
            }

            _logger.LogInformation("Invoice created successfully with ID {InvoiceId}", result.Value);
            
            return CreatedAtAction(
                nameof(GetInvoice), 
                new { id = result.Value }, 
                ApiResponse<Guid>.Ok(result.Value, "Facture créée avec succès"));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, 
                "Unexpected error creating invoice for client {ClientId}",
                dto.ClientId);
            
            // Re-throw to let ExceptionHandlingMiddleware handle it
            throw;
        }
    }

    /// <summary>
    /// Validate an invoice (finalize draft).
    /// </summary>
    [HttpPost("{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.InvoicesUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ValidateInvoice(
        Guid id,
        [FromBody] ValidateInvoiceRequest? request,
        CancellationToken cancellationToken)
    {
        var command = new ValidateInvoiceCommand(id, request?.LineAllocations);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Facture validée avec succès"));
    }

    /// <summary>
    /// Sign an invoice electronically.
    /// </summary>
    [HttpPost("{id:guid}/sign")]
    [Authorize(Policy = PermissionPolicies.InvoicesSign)]
    [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SignInvoice(Guid id, CancellationToken cancellationToken)
    {
        var command = new SignInvoiceCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<string>.Fail(result.Error.Description));

        return Ok(ApiResponse<string>.Ok(result.Value, "Facture signée avec succès"));
    }

    /// <summary>
    /// Export invoice as PDF.
    /// </summary>
    [HttpGet("{id:guid}/pdf")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportPdf(Guid id, [FromQuery] string? templateKey, CancellationToken cancellationToken)
    {
        var query = new ExportInvoicePdfQuery(id, templateKey);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<object>.Fail(result.Error.Description));

        var pdf = result.Value;
        return File(pdf.Content, pdf.ContentType, pdf.FileName);
    }

    /// <summary>
    /// Send an invoice by email to the client.
    /// </summary>
    [HttpPost("{id:guid}/send-email")]
    [Authorize(Policy = PermissionPolicies.InvoicesSend)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SendEmail(Guid id, CancellationToken cancellationToken)
    {
        var command = new SendInvoiceEmailCommand(id);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Facture envoyée avec succès"));
    }

    /// <summary>
    /// Get all payments for an invoice.
    /// </summary>
    [HttpGet("{id:guid}/payments")]
    [Authorize(Policy = PermissionPolicies.InvoicesRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<PaymentDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetInvoicePayments(Guid id, CancellationToken cancellationToken)
    {
        var query = new GetInvoicePaymentsQuery(id);
        var result = await _mediator.Send(query, cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<IReadOnlyList<PaymentDto>>.Fail(result.Error.Description));

        return Ok(ApiResponse<IReadOnlyList<PaymentDto>>.Ok(result.Value));
    }

    /// <summary>
    /// Record a payment on a client invoice.
    /// </summary>
    [HttpPost("{id:guid}/record-payment")]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RecordPayment(Guid id, [FromBody] RecordInvoicePaymentRequest request, CancellationToken cancellationToken)
    {
        var command = new RecordInvoicePaymentCommand(id, request);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "POS_SESSION_CLOSED")
                return Conflict(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));
            if (result.Error.Code == "NotFound" || result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<object>.Ok(null!, "Paiement enregistré avec succès"));
    }

    /// <summary>
    /// Enregistre plusieurs règlements sur une même facture, de façon atomique.
    /// Destiné à l'encaissement fractionné du point de vente : un règlement par mode
    /// (espèces, carte, chèque…), chacun donnant lieu à sa propre ligne Payment.
    /// Les N lignes et le statut de la facture sont écrits dans une seule transaction.
    /// </summary>
    [HttpPost("{id:guid}/record-payments")]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RecordPayments(
        Guid id,
        [FromBody] IReadOnlyList<RecordInvoicePaymentRequest> requests,
        CancellationToken cancellationToken)
    {
        var command = new RecordInvoicePaymentsBatchCommand(id, requests);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "POS_SESSION_CLOSED")
                return Conflict(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));
            if (result.Error.Code == "NotFound" || result.Error.Code.Contains("NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<object>.Ok(null!, "Règlements enregistrés avec succès"));
    }

    /// <summary>
    /// Règle un effet de commerce (traite) client à échéance : encaissé ou impayé.
    /// </summary>
    [HttpPost("{id:guid}/payments/{paymentId:guid}/settle-effet")]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SettleEffet(Guid id, Guid paymentId, [FromBody] SettleEffetRequest request, CancellationToken cancellationToken)
    {
        var command = new SettleClientEffetCommand(paymentId, request);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NotFound")
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<object>.Ok(null!, "Effet réglé avec succès"));
    }

    private bool TryResolveInvoiceType(string? type, out InvoiceType? parsedType, out IActionResult? errorResult)
    {
        if (InvoiceListTypeParser.TryParse(type, out parsedType, out var error))
        {
            errorResult = null;
            return true;
        }

        errorResult = BadRequest(ApiResponse<object>.Fail(error!));
        return false;
    }
}
