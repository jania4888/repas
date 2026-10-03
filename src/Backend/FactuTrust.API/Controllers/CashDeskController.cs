using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.CashDesk;
using FactuTrust.Application.Features.CashDesk.Commands;
using FactuTrust.Application.Features.CashDesk.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Controller for cash desk operations management (debit and credit).
/// </summary>
[ApiController]
[Route("api/cash-desk")]
[Authorize]
public class CashDeskController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<CashDeskController> _logger;

    public CashDeskController(IMediator mediator, ILogger<CashDeskController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    [HttpGet("feature-flags")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<CashDeskFeatureFlagsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetFeatureFlags(CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetCashDeskFeatureFlagsQuery(), cancellationToken);
        return Ok(ApiResponse<CashDeskFeatureFlagsDto>.Ok(result));
    }

    [HttpPost("operations")]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ProducesResponseType(typeof(ApiResponse<CashOperationListItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateOperation(
        [FromBody] CreateCashOperationRequest request,
        CancellationToken cancellationToken = default)
    {
        var command = new CreateCashOperationCommand(request);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            _logger.LogWarning("Cash operation creation failed: {Code} - {Description}", result.Error.Code, result.Error.Description);
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        return Ok(ApiResponse<CashOperationListItemDto>.Ok(result.Value, "Opération caisse enregistrée."));
    }

    /// <summary>
    /// Backward-compatible alias for CreateOperation.
    /// </summary>
    [HttpPost("expenses")]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ApiExplorerSettings(IgnoreApi = true)]
    public Task<IActionResult> CreateExpense(
        [FromBody] CreateCashOperationRequest request,
        CancellationToken cancellationToken = default)
        => CreateOperation(request, cancellationToken);

    [HttpGet("operations")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<CashOperationListItemDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOperations(
        [FromQuery] int year,
        [FromQuery] int month,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var query = new GetCashOperationListQuery(year, month, page, pageSize);
        var result = await _mediator.Send(query, cancellationToken);
        return Ok(ApiResponse<PagedResult<CashOperationListItemDto>>.Ok(result));
    }

    /// <summary>
    /// Backward-compatible alias for GetOperations.
    /// </summary>
    [HttpGet("expenses")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ApiExplorerSettings(IgnoreApi = true)]
    public Task<IActionResult> GetExpenses(
        [FromQuery] int year,
        [FromQuery] int month,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
        => GetOperations(year, month, page, pageSize, cancellationToken);

    [HttpGet("balances")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<CashDeskBalancesDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetBalances(
        [FromQuery] int year,
        [FromQuery] int month,
        CancellationToken cancellationToken = default)
    {
        var query = new GetCashDeskBalancesQuery(year, month);
        var result = await _mediator.Send(query, cancellationToken);
        return Ok(ApiResponse<CashDeskBalancesDto>.Ok(result));
    }

    [HttpGet("journal")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<TreasuryJournalResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetJournal(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int? method,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = TreasuryJournalConstants.DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        if (!TryReadJournalFilters(from, to, method, out var parsedMethod, out var error))
            return error!;

        var result = await _mediator.Send(
            new GetTreasuryJournalQuery(from!.Value, to!.Value, parsedMethod, page, pageSize),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        return Ok(ApiResponse<TreasuryJournalResultDto>.Ok(result.Value));
    }

    [HttpGet("journal/pdf")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ExportJournalPdf(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int? method,
        CancellationToken cancellationToken = default)
    {
        if (!TryReadJournalFilters(from, to, method, out var parsedMethod, out var error))
            return error!;

        var result = await _mediator.Send(
            new ExportTreasuryJournalPdfQuery(from!.Value, to!.Value, parsedMethod),
            cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description, result.Error.Code));

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    private bool TryReadJournalFilters(
        DateTime? from,
        DateTime? to,
        int? method,
        out PaymentMethod? parsedMethod,
        out IActionResult? error)
    {
        parsedMethod = null;
        error = null;

        if (!from.HasValue || !to.HasValue)
        {
            error = BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis (format: yyyy-MM-dd)."));
            return false;
        }

        if (from.Value.Date > to.Value.Date)
        {
            error = BadRequest(ApiResponse<object>.Fail("La date de début ne peut pas être après la date de fin."));
            return false;
        }

        if (!method.HasValue)
            return true;

        if (!Enum.IsDefined(typeof(PaymentMethod), method.Value))
        {
            error = BadRequest(ApiResponse<object>.Fail(TreasuryJournalConstants.InvalidMethodMessage));
            return false;
        }

        parsedMethod = (PaymentMethod)method.Value;
        return true;
    }

    [HttpPost("operations/{id:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.PaymentsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CancelOperation(
        [FromRoute] Guid id,
        [FromBody] CancelCashOperationRequest request,
        CancellationToken cancellationToken = default)
    {
        var command = new CancelCashOperationCommand(id, request);
        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
        {
            if (result.Error.Code == "NotFound")
                return NotFound(ApiResponse<object>.Fail(result.Error.Description));

            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }

        _logger.LogInformation("Cash operation {OperationId} cancelled", id);
        return Ok(ApiResponse<object>.Ok(null!, "Opération caisse annulée."));
    }

    /// <summary>
    /// Backward-compatible alias for CancelOperation.
    /// </summary>
    [HttpPost("expenses/{id:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.PaymentsUpdate)]
    [ApiExplorerSettings(IgnoreApi = true)]
    public Task<IActionResult> CancelExpense(
        [FromRoute] Guid id,
        [FromBody] CancelCashOperationRequest request,
        CancellationToken cancellationToken = default)
        => CancelOperation(id, request, cancellationToken);
}
