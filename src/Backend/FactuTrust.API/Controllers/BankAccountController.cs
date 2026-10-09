using FactuTrust.API.Authorization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.BankAccounts.Commands;
using FactuTrust.Application.Features.BankAccounts.Queries;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Treasury bank accounts (Tunisian RIB / IBAN).
/// </summary>
[ApiController]
[Route("api/bank-accounts")]
[Authorize]
public class BankAccountController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<BankAccountController> _logger;

    public BankAccountController(IMediator mediator, ILogger<BankAccountController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    /// <summary>
    /// Tunisian banks reference list (dropdown).
    /// </summary>
    [HttpGet("reference/banks")]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<TunisianBankReferenceDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTunisianBanks(CancellationToken cancellationToken = default)
    {
        var list = await _mediator.Send(new GetTunisianBanksQuery(), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<TunisianBankReferenceDto>>.Ok(list));
    }

    [HttpGet]
    [Authorize(Policy = PermissionPolicies.PaymentsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<BankAccountDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetAccounts(CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new GetBankAccountsQuery(), cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<IReadOnlyList<BankAccountDto>>.Ok(result.Value));
    }

    [HttpPost]
    [Authorize(Policy = PermissionPolicies.PaymentsCreate)]
    [ProducesResponseType(typeof(ApiResponse<BankAccountDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create(
        [FromBody] CreateBankAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new CreateBankAccountCommand(request), cancellationToken);
        if (result.IsFailure)
        {
            return MapFailure(result.Error);
        }

        var message = result.Value.LinkedExistingChartProjection
            ? $"Coordonnées enregistrées sur le compte {result.Value.ChartOfAccountNumber}."
            : "Compte bancaire créé.";
        return Ok(ApiResponse<BankAccountDto>.Ok(result.Value, message));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.PaymentsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<BankAccountDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(
        [FromRoute] Guid id,
        [FromBody] UpdateBankAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new UpdateBankAccountCommand(id, request), cancellationToken);
        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<BankAccountDto>.Ok(result.Value, "Compte bancaire mis à jour."));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.PaymentsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete([FromRoute] Guid id, CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new DeleteBankAccountCommand(id), cancellationToken);
        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Compte bancaire supprimé."));
    }

    [HttpPost("{id:guid}/set-default")]
    [Authorize(Policy = PermissionPolicies.PaymentsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SetDefault([FromRoute] Guid id, CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new SetDefaultBankAccountCommand(id), cancellationToken);
        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Compte bancaire défini par défaut."));
    }

    private IActionResult MapFailure(Error error)
    {
        _logger.LogWarning("Bank account operation failed: {Code} - {Description}", error.Code, error.Description);
        if (error.Code.Contains("NotFound", StringComparison.OrdinalIgnoreCase))
            return NotFound(ApiResponse<object>.Fail(error.Description));

        if (error.Code.Equals("Conflict", StringComparison.OrdinalIgnoreCase))
            return Conflict(ApiResponse<object>.Fail(error.Description));

        return BadRequest(ApiResponse<object>.Fail(error.Description));
    }
}
