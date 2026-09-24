using System.Security.Claims;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/accounting-firms")]
[Authorize]
[Filters.RequireAccountingFirmsFeature]
public sealed class AccountingFirmsController : ControllerBase
{
    private readonly IFirmAssignmentService _assignmentService;

    public AccountingFirmsController(IFirmAssignmentService assignmentService)
    {
        _assignmentService = assignmentService;
    }

    [HttpGet("directory")]
    [Authorize(Roles = nameof(UserRole.Administrator))]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AccountingFirmDirectoryItemDto>>>> GetDirectory(
        [FromQuery] string? search,
        [FromQuery] string? governorate,
        [FromQuery] string? practiceArea,
        [FromQuery] string? language,
        [FromQuery] string? clientSegment,
        [FromQuery] bool? remote,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _assignmentService.SearchDirectoryAsync(new AccountingFirmDirectoryQuery
        {
            Search = search,
            Governorate = governorate,
            PracticeArea = practiceArea,
            Language = language,
            ClientSegment = clientSegment,
            Remote = remote,
            Page = page,
            PageSize = pageSize
        }, tenantId.Value, cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<IReadOnlyList<AccountingFirmDirectoryItemDto>>.Fail(result.Error.Description));

        Response.Headers["X-Total-Count"] = result.Value.TotalCount.ToString();
        Response.Headers["X-Page"] = result.Value.Page.ToString();
        if (!string.IsNullOrEmpty(result.Value.CompanyGovernorate))
            Response.Headers["X-Company-Governorate"] = Uri.EscapeDataString(result.Value.CompanyGovernorate);

        return Ok(ApiResponse<IReadOnlyList<AccountingFirmDirectoryItemDto>>.Ok(result.Value.Items));
    }

    [HttpGet("me/profile")]
    [Authorize(Roles = nameof(UserRole.FirmManager))]
    public async Task<ActionResult<ApiResponse<AccountingFirmProfileDto>>> GetMyProfile(CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var profile = await _assignmentService.GetFirmProfileAsync(tenantId.Value, cancellationToken);
        if (profile is null)
            return NotFound(ApiResponse<AccountingFirmProfileDto>.Fail("Profil cabinet introuvable"));

        return Ok(ApiResponse<AccountingFirmProfileDto>.Ok(profile));
    }

    [HttpPut("me/profile")]
    [Authorize(Roles = nameof(UserRole.FirmManager))]
    public async Task<ActionResult<ApiResponse<object>>> UpdateMyProfile(
        [FromBody] UpdateAccountingFirmProfileDto dto,
        CancellationToken cancellationToken)
    {
        var tenantId = GetHomeTenantId();
        if (tenantId is null)
            return Unauthorized();

        var result = await _assignmentService.UpdateFirmProfileAsync(tenantId.Value, dto, cancellationToken);
        if (result.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(result.Error.Description));

        return Ok(ApiResponse<object>.Ok(null!, "Profil mis à jour"));
    }

    private Guid? GetHomeTenantId()
    {
        var claim = User.FindFirstValue("tenant_id");
        return Guid.TryParse(claim, out var id) ? id : null;
    }
}
